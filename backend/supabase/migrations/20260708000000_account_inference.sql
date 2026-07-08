-- =============================================================================
-- Sagebook · Account Inference & Balances
-- -----------------------------------------------------------------------------
-- 1. Inferred opening balances: accounts flagged metadata.auto_balance=true
--    (created from capture inferences) get their opening_balance recomputed so
--    the running balance never goes negative — a ₦4m debit implies the account
--    held at least ₦4m. Recalculated on every accepted transaction until the
--    user sets a balance manually (clears the flag).
-- 2. v_account_balances: accounts + live balance for the Accounts page.
-- 3. find_duplicate: bank reference IDs (e.g. "LTRF|...") are a strong
--    duplicate signal — same reference means same transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Inferred opening balance
-- -----------------------------------------------------------------------------

create or replace function public.recalc_inferred_opening(p_account uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_auto boolean;
    v_min  numeric;
begin
    select coalesce((metadata->>'auto_balance')::boolean, false) into v_auto
    from public.accounts where id = p_account;
    if not coalesce(v_auto, false) then
        return;
    end if;

    -- Minimum of the running balance computed with opening = 0. The inferred
    -- opening is whatever keeps that minimum at or above zero.
    select coalesce(min(running), 0) into v_min
    from (
        select sum(delta) over (order by occurred_at, id) as running
        from (
            select t.id, t.occurred_at,
                   case
                       when t.kind = 'income'     then t.amount
                       when t.kind = 'expense'    then -t.amount
                       when t.kind = 'transfer'   then -t.amount
                       when t.kind = 'adjustment' then t.amount
                       else 0
                   end as delta
            from public.transactions t
            where t.account_id = p_account and t.review_status = 'accepted'
            union all
            select t2.id, t2.occurred_at, t2.amount
            from public.transactions t2
            where t2.counter_account = p_account
              and t2.kind = 'transfer'
              and t2.review_status = 'accepted'
        ) deltas
    ) running_balances;

    update public.accounts
    set opening_balance = greatest(0, -v_min)
    where id = p_account;
end $$;

create or replace function public.tg_recalc_inferred_opening()
returns trigger language plpgsql as $$
begin
    if new.review_status = 'accepted' then
        if new.account_id is not null then
            perform public.recalc_inferred_opening(new.account_id);
        end if;
        if new.counter_account is not null then
            perform public.recalc_inferred_opening(new.counter_account);
        end if;
    end if;
    return new;
end $$;

drop trigger if exists recalc_inferred_opening on public.transactions;
create trigger recalc_inferred_opening
    after insert or update on public.transactions
    for each row execute function public.tg_recalc_inferred_opening();

grant execute on function public.recalc_inferred_opening(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Live balances per account
-- -----------------------------------------------------------------------------

create or replace view public.v_account_balances
with (security_invoker = true) as
select
    a.id, a.user_id, a.name, a.type, a.currency, a.institution,
    a.opening_balance, a.is_archived, a.metadata, a.created_at,
    a.opening_balance
    + coalesce((
        select sum(case
            when t.kind = 'income'     then t.amount
            when t.kind = 'expense'    then -t.amount
            when t.kind = 'transfer'   then -t.amount
            when t.kind = 'adjustment' then t.amount
            else 0 end)
        from public.transactions t
        where t.account_id = a.id and t.review_status = 'accepted'
    ), 0)
    + coalesce((
        select sum(t2.amount)
        from public.transactions t2
        where t2.counter_account = a.id
          and t2.kind = 'transfer'
          and t2.review_status = 'accepted'
    ), 0) as current_balance
from public.accounts a;

grant select on public.v_account_balances to authenticated;

-- -----------------------------------------------------------------------------
-- Reference-aware duplicate detection
-- -----------------------------------------------------------------------------
-- Drop the old signature first so named-argument RPC calls stay unambiguous.

drop function if exists public.find_duplicate(uuid, text, numeric, timestamptz, uuid);

create or replace function public.find_duplicate(
    p_user_id     uuid,
    p_payee       text,
    p_amount      numeric,
    p_occurred_at timestamptz,
    p_exclude_id  uuid default null,
    p_reference   text default null
)
returns uuid
language sql stable security definer set search_path = public as $$
    select id
    from public.transactions
    where user_id = p_user_id
      and review_status <> 'rejected'
      and (p_exclude_id is null or id <> p_exclude_id)
      and (
          (p_reference is not null and p_reference <> ''
           and metadata->>'reference' = p_reference)
          or (
              abs(amount - p_amount) < 0.01
              and abs(extract(epoch from (occurred_at - p_occurred_at))) < 259200
              and (
                  p_payee is null
                  or lower(coalesce(payee, '')) = lower(coalesce(p_payee, ''))
              )
          )
      )
    order by occurred_at desc
    limit 1;
$$;

grant execute on function public.find_duplicate(uuid, text, numeric, timestamptz, uuid, text)
    to authenticated;
