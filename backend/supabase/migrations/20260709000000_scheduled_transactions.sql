-- =============================================================================
-- Sagebook · Scheduled Transactions (expected money in/out)
-- -----------------------------------------------------------------------------
-- Models money you expect to move but that hasn't happened yet:
--   • recurring     — salary, rent, subscriptions (repeat on a cadence)
--   • one_off + income  = a RECEIVABLE (someone will pay you)
--   • one_off + expense = a PAYABLE   (you owe someone)
-- When an item comes due, a nightly job posts it into the review inbox as a
-- pending_review transaction — you confirm it actually happened (and on what
-- date) exactly like any capture. Recurring items then advance to the next
-- date; one-off debts close out.
-- =============================================================================

create table if not exists public.scheduled_transactions (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    name          text not null,
    kind          transaction_kind not null default 'income',
    -- 'recurring' repeats on `recurrence`; 'one_off' fires once then closes.
    schedule_kind text not null check (schedule_kind in ('recurring', 'one_off')),
    recurrence    text check (recurrence in ('weekly','biweekly','monthly','quarterly','yearly')),
    amount        numeric(20, 4) not null check (amount > 0),
    currency      char(3) not null references public.currencies(code),
    account_id    uuid references public.accounts(id) on delete set null,
    category_id   uuid references public.categories(id) on delete set null,
    payee         text,
    memo          text,
    next_due      date not null,
    active        boolean not null default true,
    auto_post     boolean not null default true,
    last_posted_at timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint recurring_needs_recurrence
        check (schedule_kind <> 'recurring' or recurrence is not null)
);

create index if not exists scheduled_user_due_idx
    on public.scheduled_transactions(user_id, active, next_due);

alter table public.scheduled_transactions enable row level security;

drop policy if exists owner_select on public.scheduled_transactions;
drop policy if exists owner_modify on public.scheduled_transactions;

create policy owner_select on public.scheduled_transactions
    for select using (auth.uid() = user_id);
create policy owner_modify on public.scheduled_transactions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists touch_updated_at on public.scheduled_transactions;
create trigger touch_updated_at
    before update on public.scheduled_transactions
    for each row execute function public.tg_touch_updated_at();

grant select, insert, update, delete on public.scheduled_transactions to authenticated;

-- -----------------------------------------------------------------------------
-- Advance a recurrence by one step
-- -----------------------------------------------------------------------------

create or replace function public.advance_due(p_from date, p_recurrence text)
returns date language sql immutable as $$
    select case p_recurrence
        when 'weekly'    then p_from + interval '7 days'
        when 'biweekly'  then p_from + interval '14 days'
        when 'monthly'   then p_from + interval '1 month'
        when 'quarterly' then p_from + interval '3 months'
        when 'yearly'    then p_from + interval '1 year'
        else p_from + interval '1 month'
    end::date;
$$;

-- -----------------------------------------------------------------------------
-- Materialize everything due up to today into the review inbox
-- -----------------------------------------------------------------------------

create or replace function public.materialize_due_scheduled(p_user_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
    s        public.scheduled_transactions;
    v_count  integer := 0;
    v_guard  integer;
begin
    for s in
        select * from public.scheduled_transactions
        where active
          and auto_post
          and next_due <= current_date
          and (p_user_id is null or user_id = p_user_id)
    loop
        v_guard := 0;

        -- Post one pending transaction per missed occurrence, then advance.
        while s.active and s.next_due <= current_date and v_guard < 366 loop
            insert into public.transactions (
                user_id, account_id, category_id, kind, occurred_at, amount,
                currency, payee, memo, review_status, metadata
            ) values (
                s.user_id, s.account_id, s.category_id, s.kind,
                (s.next_due + time '12:00')::timestamptz,
                s.amount, s.currency, s.payee,
                coalesce(s.memo, '') ||
                    case when s.memo is null or s.memo = '' then '' else ' · ' end ||
                    'scheduled: ' || s.name,
                'pending_review',
                jsonb_build_object('source', 'schedule', 'scheduled_id', s.id)
            );
            v_count := v_count + 1;
            v_guard := v_guard + 1;

            if s.schedule_kind = 'recurring' then
                s.next_due := public.advance_due(s.next_due, s.recurrence);
            else
                s.active := false;  -- one-off debt is now recorded
            end if;
        end loop;

        update public.scheduled_transactions
        set next_due = s.next_due, active = s.active, last_posted_at = now()
        where id = s.id;
    end loop;

    return v_count;
end $$;

-- User-triggered "check now" (materialize just my own due items).
create or replace function public.run_my_scheduled()
returns integer language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    return public.materialize_due_scheduled(auth.uid());
end $$;

-- Force a single scheduled item into the inbox immediately (ownership checked).
create or replace function public.post_scheduled_now(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
    s public.scheduled_transactions;
begin
    select * into s from public.scheduled_transactions
    where id = p_id and user_id = auth.uid();
    if not found then
        raise exception 'scheduled item not found';
    end if;

    insert into public.transactions (
        user_id, account_id, category_id, kind, occurred_at, amount,
        currency, payee, memo, review_status, metadata
    ) values (
        s.user_id, s.account_id, s.category_id, s.kind, now(),
        s.amount, s.currency, s.payee,
        coalesce(s.memo, '') ||
            case when s.memo is null or s.memo = '' then '' else ' · ' end ||
            'scheduled: ' || s.name,
        'pending_review',
        jsonb_build_object('source', 'schedule', 'scheduled_id', s.id, 'manual', true)
    );

    if s.schedule_kind = 'recurring' then
        update public.scheduled_transactions
        set next_due = public.advance_due(greatest(next_due, current_date), recurrence),
            last_posted_at = now()
        where id = s.id;
    else
        update public.scheduled_transactions
        set active = false, last_posted_at = now()
        where id = s.id;
    end if;
end $$;

grant execute on function public.advance_due(date, text)               to authenticated;
grant execute on function public.run_my_scheduled()                    to authenticated;
grant execute on function public.post_scheduled_now(uuid)              to authenticated;
grant execute on function public.materialize_due_scheduled(uuid)       to service_role;

-- -----------------------------------------------------------------------------
-- Nightly cron: post due items for everyone (best-effort where pg_cron exists)
-- -----------------------------------------------------------------------------

do $outer$
begin
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron unavailable, skipping scheduled-transactions job: %', sqlerrm;
        return;
    end;

    if exists (select 1 from cron.job where jobname = 'sagebook-scheduled-post') then
        perform cron.unschedule('sagebook-scheduled-post');
    end if;

    perform cron.schedule(
        'sagebook-scheduled-post',
        '30 1 * * *',
        $job$select public.materialize_due_scheduled();$job$
    );
end $outer$;
