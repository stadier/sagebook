-- =============================================================================
-- Sagebook · Inbox, Rules, Dedup & Summary Views
-- =============================================================================

-- -----------------------------------------------------------------------------
-- review_status enum
-- -----------------------------------------------------------------------------

do $$ begin
    create type review_status as enum ('pending_review', 'accepted', 'rejected');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Extend transactions for inbox workflow
-- -----------------------------------------------------------------------------

-- Allow account_id to be null (inbox items haven't been assigned yet)
alter table public.transactions
    alter column account_id drop not null;

alter table public.transactions
    add column if not exists review_status      review_status not null default 'pending_review',
    add column if not exists reviewed_at        timestamptz,
    add column if not exists original_ai_data   jsonb,
    add column if not exists duplicate_group_id uuid;

-- Extra indexes for inbox + dedup queries
create index if not exists tx_review_status_idx
    on public.transactions(user_id, review_status, occurred_at desc);

create index if not exists tx_dedup_idx
    on public.transactions(user_id, lower(payee), occurred_at, amount);

-- -----------------------------------------------------------------------------
-- Rules table
-- -----------------------------------------------------------------------------

create table if not exists public.rules (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    name            text not null,
    priority        int  not null default 0,
    active          boolean not null default true,
    -- field to match: payee | memo | kind
    match_field     text not null check (match_field in ('payee', 'memo', 'kind')),
    -- operator: contains | equals | starts_with | regex
    match_op        text not null check (match_op in ('contains', 'equals', 'starts_with', 'regex')),
    match_value     text not null,
    -- actions applied when rule matches
    set_category_name text,
    set_tags          text[]  not null default '{}',
    set_memo          text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists rules_user_priority_idx
    on public.rules(user_id, priority desc)
    where active;

alter table public.rules enable row level security;

drop policy if exists owner_select on public.rules;
drop policy if exists owner_modify on public.rules;

create policy owner_select on public.rules
    for select using (auth.uid() = user_id);

create policy owner_modify on public.rules
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists touch_updated_at on public.rules;
create trigger touch_updated_at
    before update on public.rules
    for each row execute function public.tg_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Default category seeding
-- -----------------------------------------------------------------------------

create or replace function public.seed_default_categories(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
    insert into public.categories (user_id, name, icon, color) values
        (p_user_id, 'Food & Dining',     '🍽',  '#ef4444'),
        (p_user_id, 'Groceries',         '🛒',  '#f97316'),
        (p_user_id, 'Transport',         '🚗',  '#3b82f6'),
        (p_user_id, 'Housing',           '🏠',  '#8b5cf6'),
        (p_user_id, 'Health',            '💊',  '#ec4899'),
        (p_user_id, 'Entertainment',     '🎬',  '#14b8a6'),
        (p_user_id, 'Shopping',          '🛍',  '#f59e0b'),
        (p_user_id, 'Utilities',         '💡',  '#6366f1'),
        (p_user_id, 'Travel',            '✈️',  '#0ea5e9'),
        (p_user_id, 'Personal Care',     '💅',  '#d946ef'),
        (p_user_id, 'Education',         '📚',  '#84cc16'),
        (p_user_id, 'Subscriptions',     '📺',  '#06b6d4'),
        (p_user_id, 'Income',            '💰',  '#22c55e'),
        (p_user_id, 'Transfer',          '↔️',  '#64748b'),
        (p_user_id, 'Uncategorized',     '❓',  '#94a3b8')
    on conflict (user_id, parent_id, name) do nothing;
end $$;

-- Auto-seed on new profile creation
create or replace function public.tg_seed_user_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    perform public.seed_default_categories(new.id);
    return new;
end $$;

drop trigger if exists seed_defaults on public.profiles;
create trigger seed_defaults
    after insert on public.profiles
    for each row execute function public.tg_seed_user_defaults();

-- Seed for any existing users that don't yet have categories
do $$
declare
    uid uuid;
begin
    for uid in
        select id from auth.users
        where id not in (select distinct user_id from public.categories)
    loop
        perform public.seed_default_categories(uid);
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Duplicate detection helper
-- -----------------------------------------------------------------------------

create or replace function public.find_duplicate(
    p_user_id     uuid,
    p_payee       text,
    p_amount      numeric,
    p_occurred_at timestamptz,
    p_exclude_id  uuid default null
)
returns uuid
language sql stable security definer set search_path = public as $$
    select id
    from public.transactions
    where user_id = p_user_id
      and review_status <> 'rejected'
      and abs(amount - p_amount) < 0.01
      and abs(extract(epoch from (occurred_at - p_occurred_at))) < 259200 -- 3 days
      and (
          p_payee is null
          or lower(coalesce(payee, '')) = lower(coalesce(p_payee, ''))
      )
      and (p_exclude_id is null or id <> p_exclude_id)
    order by occurred_at desc
    limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Summary views
-- -----------------------------------------------------------------------------

create or replace view public.v_pending_review
with (security_invoker = true) as
select
    t.*,
    c.name  as category_name,
    c.color as category_color,
    c.icon  as category_icon,
    i.media_kind,
    i.model as ingestion_model
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.media_ingestions i on i.id = t.ingestion_id
where t.review_status = 'pending_review';

create or replace view public.v_monthly_summary
with (security_invoker = true) as
select
    user_id,
    date_trunc('month', occurred_at)::date as month,
    kind,
    currency,
    sum(amount)  as total_amount,
    count(*)     as tx_count
from public.transactions
where review_status = 'accepted'
group by 1, 2, 3, 4;

create or replace view public.v_category_summary
with (security_invoker = true) as
select
    t.user_id,
    date_trunc('month', t.occurred_at)::date as month,
    coalesce(c.name, 'Uncategorized') as category,
    c.color,
    c.icon,
    t.currency,
    sum(t.amount)  as total_amount,
    count(*)       as tx_count
from public.transactions t
left join public.categories c on c.id = t.category_id
where t.review_status = 'accepted'
group by 1, 2, 3, 4, 5, 6;
