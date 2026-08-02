-- =============================================================================
-- Sagebook · Category ordering
-- -----------------------------------------------------------------------------
-- The Categories board lets a card be dragged to an exact position inside its
-- group, and the gap it opens promises that is where it will land. Without a
-- stored order that promise breaks on the next load — the list would fall back
-- to alphabetical. `category_groups` already carries `sort_order`; this gives
-- categories the same.
-- =============================================================================

alter table public.categories
    add column if not exists sort_order int not null default 0;

create index if not exists categories_sort_idx
    on public.categories(user_id, group_id, sort_order);

-- Seed the order from what users are already looking at: name, within a group,
-- parents and children numbered independently. Rows added later default to 0
-- and so sort to the top of their group, which is where a new category belongs.
with ordered as (
    select
        id,
        row_number() over (
            partition by user_id, group_id, parent_id
            order by name
        ) as position
    from public.categories
)
update public.categories c
set sort_order = ordered.position
from ordered
where ordered.id = c.id
  and c.sort_order = 0;
