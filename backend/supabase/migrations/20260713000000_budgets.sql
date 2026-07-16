-- =============================================================================
-- Sagebook · Budgets & Plans
-- -----------------------------------------------------------------------------
-- A budget is a spending/income plan for a time period. Each budget contains
-- budget_categories (envelopes) that map to the existing category taxonomy.
-- Transactions auto-reconcile against budget lines via their category_id.
--
-- For multi-month budgets (quarterly/yearly), optional budget_allocations let
-- the user spread an envelope across months unevenly.
-- =============================================================================

-- Period kind enum
do $$ begin
    create type public.budget_period as enum ('monthly','quarterly','yearly','custom');
exception when duplicate_object then null;
end $$;

-- Budget line kind
do $$ begin
    create type public.budget_line_kind as enum ('income','expense','saving','transfer');
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- budgets — the top-level container
-- =============================================================================

create table if not exists public.budgets (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    name          text not null,
    period_kind   budget_period not null default 'monthly',
    starts_on     date not null,
    ends_on       date not null,
    currency      char(3) not null references public.currencies(code),
    is_template   boolean not null default false,
    cloned_from   uuid references public.budgets(id) on delete set null,
    notes         text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint budget_dates check (ends_on >= starts_on)
);

create index if not exists budgets_user_period_idx
    on public.budgets(user_id, starts_on, ends_on);

alter table public.budgets enable row level security;

create policy owner_select on public.budgets
    for select using (auth.uid() = user_id);
create policy owner_modify on public.budgets
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists touch_updated_at on public.budgets;
create trigger touch_updated_at
    before update on public.budgets
    for each row execute function public.tg_touch_updated_at();

grant select, insert, update, delete on public.budgets to authenticated;

-- =============================================================================
-- budget_categories — individual envelopes / line items
-- =============================================================================

create table if not exists public.budget_categories (
    id              uuid primary key default gen_random_uuid(),
    budget_id       uuid not null references public.budgets(id) on delete cascade,
    category_id     uuid references public.categories(id) on delete set null,
    group_id        uuid references public.category_groups(id) on delete set null,
    label           text,
    kind            budget_line_kind not null default 'expense',
    planned_amount  numeric(20, 4) not null default 0,
    rollover        boolean not null default false,
    sort_order      int not null default 0,
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists budget_cats_budget_idx
    on public.budget_categories(budget_id);
create index if not exists budget_cats_category_idx
    on public.budget_categories(category_id);

alter table public.budget_categories enable row level security;

create policy owner_select on public.budget_categories
    for select using (
        exists (select 1 from public.budgets b where b.id = budget_id and b.user_id = auth.uid())
    );
create policy owner_modify on public.budget_categories
    for all using (
        exists (select 1 from public.budgets b where b.id = budget_id and b.user_id = auth.uid())
    )
    with check (
        exists (select 1 from public.budgets b where b.id = budget_id and b.user_id = auth.uid())
    );

drop trigger if exists touch_updated_at on public.budget_categories;
create trigger touch_updated_at
    before update on public.budget_categories
    for each row execute function public.tg_touch_updated_at();

grant select, insert, update, delete on public.budget_categories to authenticated;

-- =============================================================================
-- budget_allocations — monthly spread for multi-month budgets
-- =============================================================================

create table if not exists public.budget_allocations (
    id                   uuid primary key default gen_random_uuid(),
    budget_category_id   uuid not null references public.budget_categories(id) on delete cascade,
    month                date not null,
    amount               numeric(20, 4) not null default 0,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    constraint unique_alloc_per_month unique (budget_category_id, month)
);

alter table public.budget_allocations enable row level security;

create policy owner_select on public.budget_allocations
    for select using (
        exists (
            select 1 from public.budget_categories bc
            join public.budgets b on b.id = bc.budget_id
            where bc.id = budget_category_id and b.user_id = auth.uid()
        )
    );
create policy owner_modify on public.budget_allocations
    for all using (
        exists (
            select 1 from public.budget_categories bc
            join public.budgets b on b.id = bc.budget_id
            where bc.id = budget_category_id and b.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.budget_categories bc
            join public.budgets b on b.id = bc.budget_id
            where bc.id = budget_category_id and b.user_id = auth.uid()
        )
    );

drop trigger if exists touch_updated_at on public.budget_allocations;
create trigger touch_updated_at
    before update on public.budget_allocations
    for each row execute function public.tg_touch_updated_at();

grant select, insert, update, delete on public.budget_allocations to authenticated;

-- =============================================================================
-- v_budget_progress — reconciliation view
-- =============================================================================
-- Joins budget categories to matching accepted transactions in the budget's
-- date range. Matches by: exact category_id, parent category, or group.

create or replace view public.v_budget_progress as
with budget_periods as (
    select b.id as budget_id, b.user_id, b.starts_on, b.ends_on, b.currency
    from public.budgets b
    where not b.is_template
),
matched_tx as (
    select
        bc.id as budget_category_id,
        t.id as transaction_id,
        t.amount,
        t.currency as tx_currency,
        t.fx_rate,
        t.base_amount
    from public.budget_categories bc
    join public.budgets b on b.id = bc.budget_id
    join public.transactions t on t.user_id = b.user_id
        and t.review_status = 'accepted'
        and t.occurred_at::date between b.starts_on and b.ends_on
        and (
            -- Exact category match
            (bc.category_id is not null and t.category_id = bc.category_id)
            -- Parent category match (transaction is in a subcategory of budgeted category)
            or (bc.category_id is not null and t.category_id in (
                select c.id from public.categories c where c.parent_id = bc.category_id
            ))
            -- Group-level match (no specific category, but group matches)
            or (bc.category_id is null and bc.group_id is not null and t.category_id in (
                select c.id from public.categories c where c.group_id = bc.group_id
            ))
        )
    where not b.is_template
)
select
    bc.id as budget_category_id,
    bc.budget_id,
    bc.category_id,
    bc.group_id,
    coalesce(bc.label, c.name, cg.name, 'Unlinked') as label,
    bc.kind,
    bc.planned_amount,
    bc.rollover,
    bc.sort_order,
    coalesce(sum(abs(mt.amount)), 0) as actual_amount,
    bc.planned_amount - coalesce(sum(abs(mt.amount)), 0) as remaining,
    case when bc.planned_amount > 0
        then round(coalesce(sum(abs(mt.amount)), 0) / bc.planned_amount * 100, 1)
        else 0
    end as pct_used,
    count(mt.transaction_id) as tx_count
from public.budget_categories bc
join public.budgets b on b.id = bc.budget_id
left join public.categories c on c.id = bc.category_id
left join public.category_groups cg on cg.id = bc.group_id
left join matched_tx mt on mt.budget_category_id = bc.id
where not b.is_template
group by bc.id, bc.budget_id, bc.category_id, bc.group_id,
         bc.label, bc.kind, bc.planned_amount, bc.rollover, bc.sort_order,
         c.name, cg.name;

grant select on public.v_budget_progress to authenticated;

-- =============================================================================
-- clone_budget — deep-copy a budget (template or prior period) into a new period
-- =============================================================================

create or replace function public.clone_budget(
    p_source_id uuid,
    p_name text,
    p_starts_on date,
    p_ends_on date,
    p_apply_rollover boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid;
    v_new_id  uuid;
    v_src     public.budgets;
    v_bc      record;
    v_rollover_amount numeric;
begin
    if auth.uid() is null then raise exception 'not authenticated'; end if;

    select * into v_src from public.budgets
    where id = p_source_id and user_id = auth.uid();
    if not found then raise exception 'budget not found'; end if;

    v_user_id := auth.uid();

    insert into public.budgets (user_id, name, period_kind, starts_on, ends_on, currency, cloned_from)
    values (v_user_id, p_name, v_src.period_kind, p_starts_on, p_ends_on, v_src.currency, p_source_id)
    returning id into v_new_id;

    for v_bc in
        select * from public.budget_categories where budget_id = p_source_id order by sort_order
    loop
        v_rollover_amount := 0;
        if p_apply_rollover and v_bc.rollover and not v_src.is_template then
            select v_bc.planned_amount - coalesce(sum(abs(t.amount)), 0)
            into v_rollover_amount
            from public.transactions t
            where t.user_id = v_user_id
              and t.review_status = 'accepted'
              and t.occurred_at::date between v_src.starts_on and v_src.ends_on
              and (
                  (v_bc.category_id is not null and t.category_id = v_bc.category_id)
                  or (v_bc.category_id is not null and t.category_id in (
                      select c.id from categories c where c.parent_id = v_bc.category_id))
                  or (v_bc.category_id is null and v_bc.group_id is not null and t.category_id in (
                      select c.id from categories c where c.group_id = v_bc.group_id))
              );
            if v_rollover_amount < 0 then v_rollover_amount := 0; end if;
        end if;

        insert into public.budget_categories
            (budget_id, category_id, group_id, label, kind, planned_amount, rollover, sort_order, notes)
        values
            (v_new_id, v_bc.category_id, v_bc.group_id, v_bc.label, v_bc.kind,
             v_bc.planned_amount + v_rollover_amount, v_bc.rollover, v_bc.sort_order, v_bc.notes);
    end loop;

    return v_new_id;
end $$;

grant execute on function public.clone_budget(uuid, text, date, date, boolean) to authenticated;
