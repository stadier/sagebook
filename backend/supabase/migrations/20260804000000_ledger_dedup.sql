-- =============================================================================
-- Sagebook · Ledger deduplication
-- -----------------------------------------------------------------------------
-- A scan of the accepted ledger that flags "undeniable" duplicate entries:
-- two or more accepted rows sharing the exact same calendar day, amount,
-- payee, currency, account and kind. When every one of those fields matches
-- exactly, the same charge almost certainly got into the ledger twice (a
-- double import, a retried capture, a statement parsed twice).
--
-- The Duplicates page reviews these groups. It can either merge every member
-- into a single row (folding line items, references and receipts through the
-- existing review-transaction merge) or dismiss the group, which records the
-- dismissal here so the scan stops reporting it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- dedup_dismissals — groups the user has looked at and said "not duplicates".
-- The scan excludes any key present here, so a dismissed group stays
-- dismissed. user_id defaults to the caller so the client only sends dup_key.
-- -----------------------------------------------------------------------------

create table if not exists public.dedup_dismissals (
    user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
    dup_key text not null,
    created_at timestamptz not null default now (),
    primary key (user_id, dup_key)
);

alter table public.dedup_dismissals enable row level security;

create policy owner_select on public.dedup_dismissals for
select using (auth.uid () = user_id);

create policy owner_insert on public.dedup_dismissals for insert
with
    check (auth.uid () = user_id);

create policy owner_delete on public.dedup_dismissals for delete using (auth.uid () = user_id);

grant
select, insert, delete on public.dedup_dismissals to authenticated;

-- -----------------------------------------------------------------------------
-- find_duplicate_groups — every group of accepted, unlinked transactions where
-- day + amount + payee + currency + account + kind all match exactly.
--
--   p_tz  the caller's IANA timezone ("America/Los_Angeles", …) so "same day"
--         is the user's own calendar day rather than UTC's.
--
-- Returns one row per member transaction, carrying the group's shared key and
-- a human-readable reason. The client groups rows by dup_key.
-- -----------------------------------------------------------------------------

create or replace function public.find_duplicate_groups(p_tz text default 'UTC')
returns table (
    dup_key            text,
    id                 uuid,
    occurred_at        timestamptz,
    amount             numeric,
    currency           text,
    payee              text,
    kind               text,
    account_id         uuid,
    account_name       text,
    category_id        uuid,
    category_name      text,
    duplicate_group_id uuid,
    match_reason       text
)
language sql stable security definer set search_path = public as $$
    with candidates as (
        select
            t.id,
            t.occurred_at,
            t.amount,
            t.currency,
            t.payee,
            t.kind,
            t.account_id,
            t.category_id,
            t.duplicate_group_id,
            -- Same calendar day in the reviewer's own timezone.
            (t.occurred_at at time zone p_tz)::date as day,
            -- Null or blank payees group under a sentinel; two missing payees
            -- on the same day/amount is too weak a signal on its own.
            lower(coalesce(nullif(btrim(t.payee), ''), '(none)'))
        from public.transactions t
        where t.user_id = auth.uid()
          and t.review_status = 'accepted'
          and t.duplicate_group_id is null
    ),
    keyed as (
        select
            c.*,
            md5(
                c.day::text || '|' ||
                c.amount::text || '|' ||
                lower(coalesce(nullif(btrim(c.payee), ''), '(none)')) || '|' ||
                c.currency || '|' ||
                coalesce(c.account_id::text, '(none)') || '|' ||
                c.kind
            ) as dup_key
        from candidates c
    ),
    groups as (
        select dup_key
        from keyed
        group by dup_key
        having count(*) >= 2
    ),
    members as (
        select k.*
        from keyed k
        join groups g on g.dup_key = k.dup_key
        where not exists (
            select 1 from public.dedup_dismissals d
            where d.user_id = auth.uid()
              and d.dup_key = k.dup_key
        )
    )
    select
        m.dup_key,
        m.id,
        m.occurred_at,
        m.amount,
        m.currency,
        m.payee,
        m.kind,
        m.account_id,
        a.name as account_name,
        m.category_id,
        c.name as category_name,
        m.duplicate_group_id,
        'Same day, same amount, same payee, same account' as match_reason
    from members m
    left join public.accounts a on a.id = m.account_id
    left join public.categories c on c.id = m.category_id
    order by m.day desc, m.dup_key, m.occurred_at;
$$;

grant execute on function public.find_duplicate_groups (text) to authenticated;