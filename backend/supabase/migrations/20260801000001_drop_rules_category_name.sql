-- =============================================================================
-- Sagebook · Drop the legacy rules.set_category_name column
-- -----------------------------------------------------------------------------
-- Second half of 20260801000000. That migration added `set_category_id` and
-- backfilled it; every reader — the four ingest paths, apply-rules, and the web
-- app's rule form and table — has since been deployed against the new column.
--
-- Leaving the text column in place would be the worse outcome: two ways to say
-- where a rule points, one of which silently rots on rename. It goes.
-- =============================================================================

-- Guard rather than assume: if anything still holds a name that never resolved
-- to an id, stop and let a human look rather than dropping the only record of
-- what that rule meant.
do $$
declare
    stranded int;
begin
    select count(*) into stranded
    from   public.rules
    where  set_category_name is not null
      and  set_category_id is null;

    if stranded > 0 then
        raise exception
            'refusing to drop set_category_name: % rule(s) still have a name that resolves to no category. Fix or clear those rules first.',
            stranded;
    end if;
end $$;

alter table public.rules drop column if exists set_category_name;
