-- =============================================================================
-- Sagebook · Rules point at a category by id, not by name
-- -----------------------------------------------------------------------------
-- `rules.set_category_name` stored the category as free text, resolved at ingest
-- with a lowercased name lookup. Renaming a category therefore broke every rule
-- aimed at it, silently: the rule still matched, still won first-match-wins, and
-- then applied nothing — shadowing every lower-priority rule underneath it.
--
-- This adds the foreign key that makes a rename a non-event. The old column is
-- left in place for one deploy so running edge functions keep working; a
-- follow-up migration drops it.
-- =============================================================================

alter table public.rules
    add column if not exists set_category_id uuid
        references public.categories(id) on delete set null;

-- Backfill using exactly the lookup the matcher used, so a rule that worked
-- yesterday points at the same category today.
update public.rules r
set    set_category_id = c.id
from   public.categories c
where  r.set_category_id is null
  and  r.set_category_name is not null
  and  c.user_id = r.user_id
  and  lower(c.name) = lower(r.set_category_name);

create index if not exists rules_category_idx
    on public.rules(set_category_id)
    where set_category_id is not null;

-- Any rule left unmatched was already broken before this migration — its target
-- category does not exist under that name. Name them in the log rather than
-- letting them stay quietly inert.
do $$
declare
    orphan record;
    found_any boolean := false;
begin
    for orphan in
        select r.id, r.name, r.set_category_name
        from   public.rules r
        where  r.set_category_name is not null
          and  r.set_category_id is null
    loop
        found_any := true;
        raise notice 'rule "%" (%) targets category "%", which no longer exists — it will now be skipped rather than shadowing lower-priority rules',
            orphan.name, orphan.id, orphan.set_category_name;
    end loop;

    if not found_any then
        raise notice 'all rules with a category target resolved cleanly';
    end if;
end $$;
