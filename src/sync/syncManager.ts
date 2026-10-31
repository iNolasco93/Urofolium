import { useEffect, useState } from 'react';
import {
  applySyncState, assertDatabaseOwner, getDatabaseSession, getDataStamp,
  getLocalSecret, isDatabaseOpenFor, runLocalWrite, setLocalSecret,
} from '../db/database';
import { getAllStoredProcedures } from '../db/procedureRepository';
import { getAllStoneDetails } from '../db/stoneRepository';
import { getMeta } from '../db/metaRepository';
import { SyncEngine, EMPTY_STATUS, type SyncStatus } from './syncEngine';
import { parseBaseline } from './syncModel';
import { same } from './syncMerge';
import { commitRemote, joinData, readRemote, splitData, validators } from './syncVariant';
import { emitRemoteChange, onDatabaseLock, onLocalChange } from './syncSignals';

const KEY = 'sync_key_v1';
const listeners = new Set<(status: SyncStatus) => void>();
let engine: SyncEngine | null = null;
let cleanup: (() => void) | null = null;
let status: SyncStatus = { ...EMPTY_STATUS };
function publish(value: SyncStatus): void { status = value; listeners.forEach(listener => listener(value)); }
export function useSyncStatus(): SyncStatus {
  const [value, setValue] = useState(status);
  useEffect(() => { listeners.add(setValue); setValue(status); return () => { listeners.delete(setValue); }; }, []);
  return value;
}
export function useRemoteRevision(): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const changed = () => setValue(previous => previous + 1);
    window.addEventListener('urofolium-remote-change', changed);
    return () => window.removeEventListener('urofolium-remote-change', changed);
  }, []);
  return value;
}
export function getSyncStatus(): SyncStatus { return status; }
export function syncNow(): Promise<void> { return engine?.sync() ?? Promise.resolve(); }
export async function setSyncKey(value: string): Promise<void> {
  if (!engine) throw new Error('Abre tus registros antes de vincular el dispositivo.');
  await engine.pair(value);
}
export function acknowledgeSyncKey(): void { engine?.acknowledgeKey(); }
export function resolveConflict(channel: string, id: string, choice: 'local' | 'remote'): Promise<void> {
  return engine?.resolve(channel, id, choice) ?? Promise.resolve();
}
export async function getSyncKey(): Promise<string | null> { return getLocalSecret(KEY); }
export function stopSync(): void {
  cleanup?.(); cleanup = null;
  engine?.stop(); engine = null;
  publish({ ...EMPTY_STATUS });
}
export function startSync(userId: string): () => void {
  stopSync();
  const session = getDatabaseSession();
  const assertActive = () => {
    assertDatabaseOwner(userId);
    if (session !== getDatabaseSession()) throw new Error('La sesión cambió; vuelve a abrir tus registros.');
  };
  const current = new SyncEngine({
    userId, validators, assertActive,
    getKey: () => getLocalSecret(KEY),
    saveKey: async key => { assertActive(); await setLocalSecret(KEY, key); assertActive(); },
    capture: () => runLocalWrite(userId, async () => {
      assertActive();
      const baseline = parseBaseline(await getMeta('sync_baseline'));
      const procedures = await getAllStoredProcedures();
      const stones = await getAllStoneDetails();
      assertActive();
      return { data: splitData(procedures, stones, baseline), baseline, stamp: getDataStamp(), session };
    }, false),
    apply: async (local, data, baseline) => {
      assertActive();
      if (same(local.data, data) && same(local.baseline, baseline)) return local.stamp === getDataStamp();
      const joined = joinData(data);
      const applied = await applySyncState(userId, local.session, local.stamp, joined.procedures, joined.stoneDetails, JSON.stringify(baseline));
      assertActive();
      if (applied && !same(local.data, data)) emitRemoteChange();
      return applied;
    },
    readRemote: signal => { assertActive(); return readRemote(userId, signal); },
    commitRemote: (expected, updates, signal) => { assertActive(); return commitRemote(userId, expected, updates, signal); },
    publish,
  });
  engine = current;
  const request = () => { if (isDatabaseOpenFor(userId)) void current.sync(); };
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const offLock = onDatabaseLock(stopSync);
  const off = onLocalChange(() => { clearTimeout(debounce); debounce = setTimeout(request, 350); });
  const visible = () => { if (document.visibilityState === 'visible') request(); };
  window.addEventListener('online', request);
  document.addEventListener('visibilitychange', visible);
  const interval = setInterval(visible, 60_000);
  cleanup = () => { offLock(); off(); clearTimeout(debounce); clearInterval(interval); window.removeEventListener('online', request); document.removeEventListener('visibilitychange', visible); };
  request();
  return () => { if (engine === current) stopSync(); };
}
