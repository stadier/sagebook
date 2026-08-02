-- =============================================================================
-- Sagebook · Skip one occurrence of a recurring schedule
-- -----------------------------------------------------------------------------
-- Pausing is the wrong tool for "no rent this month" — it stops the schedule
-- indefinitely and has to be remembered and undone. Skipping advances the
-- cadence by exactly one step and posts nothing, so the item stays live and the
-- next date is the one you actually expect.
--
-- Recurring only. A one-off has no next occurrence to skip; pausing or deleting
-- it is the honest answer, and the UI offers those instead.
-- =============================================================================

create or replace function public.skip_scheduled_occurrence(p_id uuid)
returns date language plpgsql security definer set search_path = public as $$
declare
    s        public.scheduled_transactions;
    v_next   date;
begin
    select * into s from public.scheduled_transactions
    where id = p_id and user_id = auth.uid();
    if not found then
        raise exception 'scheduled item not found';
    end if;

    if s.schedule_kind <> 'recurring' then
        raise exception 'only a recurring item has an occurrence to skip';
    end if;

    -- From today when the item is overdue, so skipping a schedule that missed
    -- several runs lands on the next date ahead rather than another past one.
    v_next := public.advance_due(greatest(s.next_due, current_date), s.recurrence);

    update public.scheduled_transactions
    set next_due = v_next
    where id = s.id;

    return v_next;
end $$;

grant execute on function public.skip_scheduled_occurrence(uuid) to authenticated;
