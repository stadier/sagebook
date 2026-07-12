-- =============================================================================
-- Sagebook · Merge accounts
-- -----------------------------------------------------------------------------
-- When inference creates two accounts that turn out to be the same (e.g. a
-- receipt-inferred placeholder and a later properly-named one), fold the source
-- into the target: every transaction, transfer leg, and scheduled item moves
-- over, then the source account is deleted. Both must belong to the caller.
-- =============================================================================

create or replace function public.merge_accounts(p_source uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'not authenticated';
    end if;
    if p_source = p_target then
        raise exception 'cannot merge an account into itself';
    end if;

    -- Ownership check on both sides.
    if not exists (select 1 from public.accounts where id = p_source and user_id = v_uid) then
        raise exception 'source account not found';
    end if;
    if not exists (select 1 from public.accounts where id = p_target and user_id = v_uid) then
        raise exception 'target account not found';
    end if;

    update public.transactions set account_id = p_target
        where account_id = p_source and user_id = v_uid;
    update public.transactions set counter_account = p_target
        where counter_account = p_source and user_id = v_uid;
    update public.scheduled_transactions set account_id = p_target
        where account_id = p_source and user_id = v_uid;

    delete from public.accounts where id = p_source and user_id = v_uid;

    -- Refresh the target's inferred opening balance (if it is auto).
    perform public.recalc_inferred_opening(p_target);
end $$;

grant execute on function public.merge_accounts(uuid, uuid) to authenticated;
