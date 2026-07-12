-- =============================================================================
-- Sagebook · Application Event Log
-- -----------------------------------------------------------------------------
-- User-scoped log of capture/import/review successes and failures. The web app
-- writes client-side events here (upload failures, edge-fn errors, results);
-- together with media_ingestions it powers the Activity page, so every attempt
-- is reviewable and referenceable after the fact.
-- =============================================================================

create table if not exists public.app_logs (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    level       text not null check (level in ('info', 'warn', 'error')),
    source      text not null,          -- capture | import | inbox | networth | ...
    message     text not null,
    context     jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists app_logs_user_time_idx
    on public.app_logs(user_id, created_at desc);

create index if not exists app_logs_user_level_idx
    on public.app_logs(user_id, level, created_at desc);

alter table public.app_logs enable row level security;

drop policy if exists owner_select on public.app_logs;
create policy owner_select on public.app_logs
    for select using (auth.uid() = user_id);

drop policy if exists owner_insert on public.app_logs;
create policy owner_insert on public.app_logs
    for insert with check (auth.uid() = user_id);

-- Logs are append-only from the client, but users may clear their own history.
drop policy if exists owner_delete on public.app_logs;
create policy owner_delete on public.app_logs
    for delete using (auth.uid() = user_id);

grant select, insert, delete on public.app_logs to authenticated;

-- -----------------------------------------------------------------------------
-- Retention: purge entries older than 90 days (best-effort, needs pg_cron)
-- -----------------------------------------------------------------------------

do $outer$
begin
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron unavailable, skipping app_logs retention job: %', sqlerrm;
        return;
    end;

    if exists (select 1 from cron.job where jobname = 'sagebook-purge-app-logs') then
        perform cron.unschedule('sagebook-purge-app-logs');
    end if;

    perform cron.schedule(
        'sagebook-purge-app-logs',
        '45 0 * * *',
        $job$delete from public.app_logs where created_at < now() - interval '90 days';$job$
    );
end $outer$;
