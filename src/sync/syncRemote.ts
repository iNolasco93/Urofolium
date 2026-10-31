import { supabase } from '../auth/authService';
import { validateEnvelope, type SyncEnvelope } from './syncCrypto';
import type { RemoteChannel } from './syncEngine';

export function requestSignal(parent: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.any([parent, AbortSignal.timeout(20_000)]);
  }
  // Older mobile WebViews do not provide AbortSignal.any/timeout.
  const controller = new AbortController();
  if (parent.aborted) { controller.abort(); return controller.signal; }
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 20_000);
  parent.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timer); parent.removeEventListener('abort', abort);
  }, { once: true });
  return controller.signal;
}
export async function readChannel(table: string, userId: string, signal: AbortSignal): Promise<RemoteChannel | null> {
  const { data, error } = await supabase.from(table).select('revision,envelope').eq('user_id', userId).abortSignal(requestSignal(signal)).maybeSingle();
  if (error) throw new Error(`No se pudo leer la sincronización: ${error.message}`);
  if (!data) return null;
  if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('Revisión remota no válida.');
  return { revision: data.revision, envelope: validateEnvelope(data.envelope) };
}
export async function commitCommon(userId: string, revision: number, envelope: SyncEnvelope | undefined, signal: AbortSignal): Promise<Record<string, number> | null> {
  const { data, error } = await supabase.rpc('urofolium_sync_commit', {
    owner_id: userId, expected_revision: revision, next_envelope: envelope ?? null,
  }).abortSignal(requestSignal(signal));
  if (error) throw new Error(`No se pudo guardar la sincronización: ${error.message}`);
  if (data === null) return null;
  return { cases: Number(data) };
}
