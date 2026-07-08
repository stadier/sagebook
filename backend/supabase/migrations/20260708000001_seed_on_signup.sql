-- =============================================================================
-- Sagebook · Seed defaults at signup
-- -----------------------------------------------------------------------------
-- Nothing ever created public.profiles rows: the app signs users up via
-- Supabase Auth only, and the category-seed trigger hangs off profiles inserts
-- — so real users ended up with no profile, no groups, and no categories
-- (breaking taxonomy-aware extraction and base-currency lookups).
-- Create the profile (and thereby the seeded taxonomy) on auth.users insert,
-- and backfill every existing user.
-- =============================================================================

create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    -- The seed_defaults trigger on profiles populates groups + categories.
    insert into public.profiles (id) values (new.id)
    on conflict (id) do nothing;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.tg_handle_new_user();

-- Backfill: a profile for every existing user (fires the seed trigger).
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- Belt and braces: users who somehow have a profile but no categories.
do $$
declare
    uid uuid;
begin
    for uid in
        select u.id from auth.users u
        where not exists (select 1 from public.categories c where c.user_id = u.id)
    loop
        perform public.seed_default_categories(uid);
    end loop;
end $$;
