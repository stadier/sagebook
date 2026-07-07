-- =============================================================================
-- Sagebook · Ingest Storage Bucket
-- -----------------------------------------------------------------------------
-- Private bucket for captured media (receipts, statements, voice notes).
-- Objects live under {user_id}/... and are owner-only; process-media downloads
-- them via the service role after verifying the path prefix matches the caller.
-- The stored object doubles as the receipt archive shown in transaction detail.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('ingest', 'ingest', false)
on conflict (id) do nothing;

drop policy if exists "ingest_owner_select" on storage.objects;
create policy "ingest_owner_select" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'ingest'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "ingest_owner_insert" on storage.objects;
create policy "ingest_owner_insert" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'ingest'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "ingest_owner_update" on storage.objects;
create policy "ingest_owner_update" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'ingest'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'ingest'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "ingest_owner_delete" on storage.objects;
create policy "ingest_owner_delete" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'ingest'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
