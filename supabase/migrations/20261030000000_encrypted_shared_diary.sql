-- Case content is encrypted in the client, including the full lithiasis record.
create table public.urofolium_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision between 1 and 9007199254740990),
  envelope jsonb not null check (coalesce(
    jsonb_typeof(envelope) = 'object' and envelope ?& array['format','version','kdf','iterations','salt','iv','ciphertext']
    and envelope->>'format' = 'urofolium-sync'
    and envelope->'version' = '1'::jsonb and envelope->>'kdf' = 'PBKDF2-SHA256'
    and envelope->'iterations' = '600000'::jsonb and octet_length(envelope::text) <= 8388608
  , false)),
  updated_at timestamptz not null default now()
);
alter table public.urofolium_sync_state enable row level security;
revoke all on public.urofolium_sync_state from public, anon, authenticated;
grant select on public.urofolium_sync_state to authenticated;
create policy "Read own encrypted diary" on public.urofolium_sync_state for select to authenticated
  using ((select auth.uid()) = user_id);

-- All writes use the same per-account lock and an expected revision.
-- owner_id also prevents an in-flight client request from changing accounts.
create function public.urofolium_sync_commit(owner_id uuid, expected_revision bigint, next_envelope jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if owner_id is null or auth.uid() is distinct from owner_id then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision is null or expected_revision < 0 or expected_revision >= 9007199254740990 then raise exception 'Invalid revision'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select revision into current_revision from public.urofolium_sync_state where user_id = owner_id;
  current_revision := coalesce(current_revision, 0);
  if current_revision <> expected_revision then return null; end if;
  if next_envelope is null then return current_revision; end if;
  insert into public.urofolium_sync_state(user_id, revision, envelope)
    values (owner_id, current_revision + 1, next_envelope)
    on conflict (user_id) do update set revision = excluded.revision, envelope = excluded.envelope, updated_at = now();
  return current_revision + 1;
end;
$$;
revoke all on function public.urofolium_sync_commit(uuid, bigint, jsonb) from public, anon;
grant execute on function public.urofolium_sync_commit(uuid, bigint, jsonb) to authenticated;
