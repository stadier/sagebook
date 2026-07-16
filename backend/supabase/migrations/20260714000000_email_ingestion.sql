-- =============================================================================
-- Sagebook · Email ingestion
-- -----------------------------------------------------------------------------
-- Per-user unique forwarding addresses and an audit log for inbound emails.
-- The extraction pipeline reuses media_ingestions + commitParsedTransactions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ingest_addresses — one unique slug per user
-- ---------------------------------------------------------------------------
create table public.ingest_addresses (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    slug       text not null,
    is_active  boolean not null default true,
    created_at timestamptz not null default now(),

    constraint uq_ingest_address_user unique (user_id),
    constraint uq_ingest_address_slug unique (slug)
);

alter table public.ingest_addresses enable row level security;

create policy "owner_select" on public.ingest_addresses
    for select using (auth.uid() = user_id);

create policy "owner_update" on public.ingest_addresses
    for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. ingest_emails — raw email audit log
-- ---------------------------------------------------------------------------
create table public.ingest_emails (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    ingestion_id     uuid references public.media_ingestions(id),
    from_address     text not null,
    subject          text,
    body_text        text,
    body_html        text,
    attachment_paths text[] default '{}',
    raw_headers      jsonb default '{}',
    status           text not null default 'received'
                     check (status in ('received','processing','done','failed')),
    error            text,
    received_at      timestamptz not null default now()
);

alter table public.ingest_emails enable row level security;

create policy "owner_select" on public.ingest_emails
    for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Slug generation helper
-- ---------------------------------------------------------------------------
create or replace function public.generate_ingest_slug()
returns text language plpgsql as $$
declare
    slug text;
    attempts int := 0;
begin
    loop
        slug := lower(substr(md5(gen_random_uuid()::text), 1, 8));
        begin
            return slug;
        end;
        attempts := attempts + 1;
        if attempts > 10 then
            raise exception 'could not generate unique slug after 10 attempts';
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Update signup trigger to also create an ingest address
-- ---------------------------------------------------------------------------
create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id) values (new.id)
    on conflict (id) do nothing;

    insert into public.ingest_addresses (user_id, slug)
    values (new.id, public.generate_ingest_slug())
    on conflict (user_id) do nothing;

    return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Backfill: create ingest addresses for existing users
-- ---------------------------------------------------------------------------
insert into public.ingest_addresses (user_id, slug)
select u.id, public.generate_ingest_slug()
from auth.users u
where not exists (
    select 1 from public.ingest_addresses ia where ia.user_id = u.id
);
