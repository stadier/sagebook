-- =============================================================================
-- Sagebook · Balance recalc on transaction edits
-- -----------------------------------------------------------------------------
-- The inferred-opening recalc only considered the row's NEW accounts, so
-- moving a transaction between accounts (or un-accepting one) left the old
-- account's inferred opening balance stale. Recalculate every account the row
-- touched, before or after the change.
-- =============================================================================

create or replace function public.tg_recalc_inferred_opening()
returns trigger language plpgsql as $$
declare
    v_id uuid;
begin
    if new.review_status = 'accepted'
       or (tg_op = 'UPDATE' and old.review_status = 'accepted') then
        for v_id in
            select distinct e from unnest(array_remove(array[
                new.account_id,
                new.counter_account,
                case when tg_op = 'UPDATE' then old.account_id end,
                case when tg_op = 'UPDATE' then old.counter_account end
            ], null)) e
        loop
            perform public.recalc_inferred_opening(v_id);
        end loop;
    end if;
    return new;
end $$;
