-- Each account owns a separate encrypted catalogue. The diary format remains unchanged.
create table public.urofolium_sync_catalog (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision between 1 and 9007199254740990),
  envelope jsonb not null check (coalesce(
    jsonb_typeof(envelope) = 'object' and envelope ?& array['format','version','kdf','iterations','salt','iv','ciphertext']
    and envelope->>'format' = 'urofolium-sync' and envelope->'version' = '1'::jsonb
    and envelope->>'kdf' = 'PBKDF2-SHA256' and envelope->'iterations' = '600000'::jsonb
    and octet_length(envelope::text) <= 8388608, false)),
  updated_at timestamptz not null default now()
);
alter table public.urofolium_sync_catalog enable row level security;
revoke all on public.urofolium_sync_catalog from public, anon, authenticated;
grant select on public.urofolium_sync_catalog to authenticated;
create policy "Read own encrypted catalogue" on public.urofolium_sync_catalog for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.urofolium_sync_commit_catalog(
  owner_id uuid, expected_revision bigint, next_envelope jsonb,
  expected_catalog_revision bigint, next_catalog_envelope jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare common_revision bigint; catalog_revision bigint;
begin
  if owner_id is null or auth.uid() is distinct from owner_id then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision is null or expected_catalog_revision is null or expected_revision < 0 or expected_catalog_revision < 0
    or expected_revision >= 9007199254740990 or expected_catalog_revision >= 9007199254740990 then raise exception 'Invalid revision'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select revision into common_revision from public.urofolium_sync_state where user_id = owner_id;
  select revision into catalog_revision from public.urofolium_sync_catalog where user_id = owner_id;
  common_revision := coalesce(common_revision, 0); catalog_revision := coalesce(catalog_revision, 0);
  if common_revision <> expected_revision or catalog_revision <> expected_catalog_revision then return null; end if;
  if next_envelope is not null then
    common_revision := common_revision + 1;
    insert into public.urofolium_sync_state(user_id, revision, envelope) values(owner_id, common_revision, next_envelope)
      on conflict(user_id) do update set revision = excluded.revision, envelope = excluded.envelope, updated_at = now();
  end if;
  if next_catalog_envelope is not null then
    catalog_revision := catalog_revision + 1;
    insert into public.urofolium_sync_catalog(user_id, revision, envelope) values(owner_id, catalog_revision, next_catalog_envelope)
      on conflict(user_id) do update set revision = excluded.revision, envelope = excluded.envelope, updated_at = now();
  end if;
  return jsonb_build_object('cases', common_revision, 'catalog', catalog_revision);
end;
$$;
revoke all on function public.urofolium_sync_commit_catalog(uuid, bigint, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.urofolium_sync_commit_catalog(uuid, bigint, jsonb, bigint, jsonb) to authenticated;
