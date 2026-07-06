-- =============================================================================
-- Sagebook · Category Groups & Custom Investment Taxonomy
-- -----------------------------------------------------------------------------
-- Adds a "group" layer above categories so spending/income rolls up into
-- user-defined buckets (Income, Essentials, Lifestyle, Investments, Business,
-- Transfers & Other). Seeds an investment taxonomy including a
-- "Real Estate Investment" category with land-purchase style subcategories.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- category_groups table
-- -----------------------------------------------------------------------------

create table if not exists public.category_groups (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    name        text not null,
    icon        text,
    color       text,
    sort_order  int  not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, name)
);

create index if not exists category_groups_user_idx
    on public.category_groups(user_id, sort_order);

alter table public.category_groups enable row level security;

drop policy if exists owner_select on public.category_groups;
drop policy if exists owner_modify on public.category_groups;

create policy owner_select on public.category_groups
    for select using (auth.uid() = user_id);

create policy owner_modify on public.category_groups
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists touch_updated_at on public.category_groups;
create trigger touch_updated_at
    before update on public.category_groups
    for each row execute function public.tg_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Link categories to groups
-- -----------------------------------------------------------------------------

alter table public.categories
    add column if not exists group_id uuid references public.category_groups(id) on delete set null;

create index if not exists categories_group_idx on public.categories(group_id);

-- -----------------------------------------------------------------------------
-- Seeding helpers
-- -----------------------------------------------------------------------------

-- Idempotent single-category upsert that returns the category id.
-- (The (user_id, parent_id, name) unique constraint treats NULL parents as
-- distinct rows, so a plain ON CONFLICT does not protect top-level inserts.)
create or replace function public.ensure_category(
    p_user_id  uuid,
    p_name     text,
    p_icon     text default null,
    p_color    text default null,
    p_group_id uuid default null,
    p_parent   uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
    v_id uuid;
begin
    select id into v_id
    from public.categories
    where user_id = p_user_id
      and name = p_name
      and parent_id is not distinct from p_parent;

    if v_id is null then
        insert into public.categories (user_id, name, icon, color, group_id, parent_id)
        values (p_user_id, p_name, p_icon, p_color, p_group_id, p_parent)
        returning id into v_id;
    elsif p_group_id is not null then
        update public.categories
        set group_id = coalesce(group_id, p_group_id)
        where id = v_id;
    end if;

    return v_id;
end $$;

create or replace function public.ensure_category_group(
    p_user_id uuid,
    p_name    text,
    p_icon    text default null,
    p_color   text default null,
    p_sort    int  default 0
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
    v_id uuid;
begin
    insert into public.category_groups (user_id, name, icon, color, sort_order)
    values (p_user_id, p_name, p_icon, p_color, p_sort)
    on conflict (user_id, name) do nothing;

    select id into v_id
    from public.category_groups
    where user_id = p_user_id and name = p_name;

    return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Default groups + categories (replaces earlier seed_default_categories)
-- -----------------------------------------------------------------------------

create or replace function public.seed_default_categories(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
    g_income      uuid;
    g_essentials  uuid;
    g_lifestyle   uuid;
    g_investments uuid;
    g_business    uuid;
    g_other       uuid;
    c_realestate  uuid;
begin
    g_income      := public.ensure_category_group(p_user_id, 'Income',            '💰', '#22c55e', 0);
    g_essentials  := public.ensure_category_group(p_user_id, 'Essentials',        '🏠', '#8b5cf6', 1);
    g_lifestyle   := public.ensure_category_group(p_user_id, 'Lifestyle',         '🎬', '#14b8a6', 2);
    g_investments := public.ensure_category_group(p_user_id, 'Investments',       '📈', '#0ea5e9', 3);
    g_business    := public.ensure_category_group(p_user_id, 'Business',          '💼', '#f59e0b', 4);
    g_other       := public.ensure_category_group(p_user_id, 'Transfers & Other', '↔️', '#64748b', 5);

    -- Income
    perform public.ensure_category(p_user_id, 'Income',           '💰', '#22c55e', g_income);
    perform public.ensure_category(p_user_id, 'Salary',           '💵', '#16a34a', g_income);
    perform public.ensure_category(p_user_id, 'Rental Income',    '🏘',  '#15803d', g_income);
    perform public.ensure_category(p_user_id, 'Gifts Received',   '🎁', '#4ade80', g_income);

    -- Essentials
    perform public.ensure_category(p_user_id, 'Food & Dining', '🍽',  '#ef4444', g_essentials);
    perform public.ensure_category(p_user_id, 'Groceries',     '🛒',  '#f97316', g_essentials);
    perform public.ensure_category(p_user_id, 'Transport',     '🚗',  '#3b82f6', g_essentials);
    perform public.ensure_category(p_user_id, 'Housing',       '🏠',  '#8b5cf6', g_essentials);
    perform public.ensure_category(p_user_id, 'Health',        '💊',  '#ec4899', g_essentials);
    perform public.ensure_category(p_user_id, 'Utilities',     '💡',  '#6366f1', g_essentials);
    perform public.ensure_category(p_user_id, 'Education',     '📚',  '#84cc16', g_essentials);

    -- Lifestyle
    perform public.ensure_category(p_user_id, 'Entertainment', '🎬', '#14b8a6', g_lifestyle);
    perform public.ensure_category(p_user_id, 'Shopping',      '🛍',  '#f59e0b', g_lifestyle);
    perform public.ensure_category(p_user_id, 'Travel',        '✈️', '#0ea5e9', g_lifestyle);
    perform public.ensure_category(p_user_id, 'Personal Care', '💅', '#d946ef', g_lifestyle);
    perform public.ensure_category(p_user_id, 'Subscriptions', '📺', '#06b6d4', g_lifestyle);

    -- Investments — includes the real-estate taxonomy for land/property deals
    c_realestate := public.ensure_category(p_user_id, 'Real Estate Investment', '🏗', '#b45309', g_investments);
    perform public.ensure_category(p_user_id, 'Land Purchase',             '🌍', '#92400e', g_investments, c_realestate);
    perform public.ensure_category(p_user_id, 'Construction & Development','🧱', '#a16207', g_investments, c_realestate);
    perform public.ensure_category(p_user_id, 'Surveying & Valuation',     '📐', '#ca8a04', g_investments, c_realestate);
    perform public.ensure_category(p_user_id, 'Legal & Documentation',     '📜', '#854d0e', g_investments, c_realestate);
    perform public.ensure_category(p_user_id, 'Agent & Broker Fees',       '🤝', '#78350f', g_investments, c_realestate);
    perform public.ensure_category(p_user_id, 'Property Taxes & Levies',   '🏛',  '#713f12', g_investments, c_realestate);
    perform public.ensure_category(p_user_id, 'Stocks & Securities', '📊', '#0284c7', g_investments);
    perform public.ensure_category(p_user_id, 'Crypto',             '₿',  '#7c3aed', g_investments);
    perform public.ensure_category(p_user_id, 'Savings & Deposits', '🏦', '#0369a1', g_investments);

    -- Business
    perform public.ensure_category(p_user_id, 'Business Income',   '💼', '#d97706', g_business);
    perform public.ensure_category(p_user_id, 'Business Expenses', '🧾', '#b45309', g_business);

    -- Transfers & Other
    perform public.ensure_category(p_user_id, 'Transfer',      '↔️', '#64748b', g_other);
    perform public.ensure_category(p_user_id, 'Fees & Charges','🏷',  '#475569', g_other);
    perform public.ensure_category(p_user_id, 'Uncategorized', '❓', '#94a3b8', g_other);
end $$;

-- -----------------------------------------------------------------------------
-- Backfill existing users: create groups, attach their current categories,
-- and add the new investment taxonomy.
-- -----------------------------------------------------------------------------

do $$
declare
    uid uuid;
begin
    for uid in select distinct user_id from public.categories
    loop
        perform public.seed_default_categories(uid);
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Category summary view now exposes the group.
-- Column list changes (category_group inserted), so drop + recreate + re-grant.
-- -----------------------------------------------------------------------------

drop view if exists public.v_category_summary;

create view public.v_category_summary
with (security_invoker = true) as
select
    t.user_id,
    date_trunc('month', t.occurred_at)::date as month,
    coalesce(g.name, 'Ungrouped')      as category_group,
    coalesce(c.name, 'Uncategorized')  as category,
    c.color,
    c.icon,
    t.currency,
    sum(t.amount)  as total_amount,
    count(*)       as tx_count
from public.transactions t
left join public.categories c      on c.id = t.category_id
left join public.category_groups g on g.id = c.group_id
where t.review_status = 'accepted'
group by 1, 2, 3, 4, 5, 6, 7;

grant select on public.v_category_summary to authenticated;
grant select on public.category_groups    to authenticated;
grant execute on function public.ensure_category(uuid, text, text, text, uuid, uuid) to service_role;
grant execute on function public.ensure_category_group(uuid, text, text, text, int)  to service_role;
