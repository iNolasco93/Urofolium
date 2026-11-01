import { decryptSnapshot, encryptSnapshot, generateSyncKey, SyncKeyError, type SyncEnvelope } from './syncCrypto';
import { hashes, mergeEntries, same } from './syncMerge';
import type { Baseline, Conflict, Entries, LocalSnapshot, Resolutions, SyncData } from './syncModel';

export interface RemoteChannel { revision: number; envelope: SyncEnvelope }
export type RemoteState = Record<string, RemoteChannel | null>;
export interface SyncStatus {
  phase: 'idle' | 'checking' | 'ready' | 'needs-key' | 'conflict' | 'error';
  message: string; conflicts: Conflict[]; lastSyncedAt: string | null; keySaved: boolean;
}
export const EMPTY_STATUS: SyncStatus = { phase: 'idle', message: '', conflicts: [], lastSyncedAt: null, keySaved: true };
export interface SyncPorts {
  userId: string;
  assertActive(): void;
  validators: Record<string, (value: unknown) => Entries>;
  capture(): Promise<LocalSnapshot>;
  apply(snapshot: LocalSnapshot, data: SyncData, baseline: Baseline): Promise<boolean>;
  getKey(): Promise<string | null>;
  saveKey(value: string): Promise<void>;
  readRemote(signal: AbortSignal): Promise<RemoteState>;
  // Must validate every expected revision and commit all changed channels in one transaction.
  commitRemote(expected: Record<string, number>, updates: Record<string, SyncEnvelope>, signal: AbortSignal): Promise<Record<string, number> | null>;
  prepareLocal?(channel: string, local: Entries, remote: Entries): Entries;
  reconcile?(data: SyncData, remote: SyncData, resolutions: Resolutions): Promise<Conflict[]>;
  publish(status: SyncStatus): void;
}
export class SyncEngine {
  status: SyncStatus = { ...EMPTY_STATUS };
  private stopped = false;
  private running: Promise<void> | null = null;
  private again = false;
  private controller = new AbortController();
  private resolutions: Resolutions = new Map();
  constructor(private ports: SyncPorts) {}
  private check(): void {
    if (this.stopped) throw new Error('Sincronización cancelada.');
    this.ports.assertActive();
  }
  private publish(value: Partial<SyncStatus>): void {
    this.check(); this.status = { ...this.status, ...value }; this.ports.publish(this.status);
  }
  stop(): void { this.stopped = true; this.controller.abort(); this.resolutions.clear(); }
  acknowledgeKey(): void { this.publish({ keySaved: true }); }
  async pair(passphrase: string): Promise<void> {
    const value = passphrase.trim();
    if (value.length < 12) throw new Error('La clave debe tener al menos 12 caracteres.');
    this.check();
    // Wait for any attempted initial upload before validating a replacement key.
    if (this.running) await this.running;
    this.check();
    const remote = await this.ports.readRemote(this.controller.signal);
    this.check();
    if (!Object.values(remote).some(Boolean)) throw new Error('Todavía no hay una copia remota. Sincroniza primero el dispositivo que contiene tus registros.');
    for (const [channel, valueRemote] of Object.entries(remote)) {
      if (valueRemote) this.ports.validators[channel](await decryptSnapshot(valueRemote.envelope, value, this.ports.userId, channel, valueRemote.revision));
      this.check();
    }
    await this.ports.saveKey(value);
    this.check();
    this.publish({ keySaved: true });
    await this.sync();
  }
  resolve(channel: string, id: string, choice: 'local' | 'remote'): Promise<void> {
    const conflict = this.status.conflicts.find(item => item.channel === channel && item.id === id);
    if (conflict) this.resolutions.set(JSON.stringify([channel, id]), { localHash: conflict.localHash, remoteHash: conflict.remoteHash, choice });
    return this.sync();
  }
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    const operation = (async () => {
      do {
        this.again = false;
        try { await this.run(); }
        catch (error) {
          if (this.stopped) return;
          try {
            this.publish({ phase: error instanceof SyncKeyError ? 'needs-key' : 'error', message: error instanceof Error ? error.message : 'No se pudo sincronizar. Los datos locales se conservan.', conflicts: [] });
          } catch { return; }
          // A failed request waits for an explicit retry, connectivity, or the next interval.
          this.again = false;
        }
      } while (this.again && !this.stopped);
    })().finally(() => { if (this.running === operation) this.running = null; });
    this.running = operation;
    return operation;
  }
  private async run(): Promise<void> {
    this.publish({ phase: 'checking', message: 'Sincronizando datos cifrados…' });
    for (let attempt = 0; attempt < 4; attempt++) {
      this.check();
      const remote = await this.ports.readRemote(this.controller.signal);
      this.check();
      let key = await this.ports.getKey();
      this.check();
      if (!key && Object.values(remote).some(Boolean)) {
        this.publish({ phase: 'needs-key', message: 'Introduce la clave de sincronización del dispositivo que contiene tus registros.', conflicts: [] });
        return;
      }
      if (!key) {
        key = generateSyncKey();
        await this.ports.saveKey(key);
        this.publish({ keySaved: false });
      }
      const local = await this.ports.capture();
      this.check();
      const data: SyncData = {};
      const expected: Record<string, number> = {};
      const updates: Record<string, SyncEnvelope> = {};
      const conflicts: Conflict[] = [];
      const remoteData: SyncData = {};
      const originalData: SyncData = {};
      const wireDirty: Record<string, boolean> = {};
      const baseline: Baseline = { version: 1, channels: {} };
      for (const [channel, validate] of Object.entries(this.ports.validators)) {
        if (!Object.prototype.hasOwnProperty.call(remote, channel)) throw new Error('La respuesta de sincronización está incompleta.');
        const state = remote[channel];
        const revision = state?.revision ?? 0;
        if (revision < (local.baseline?.channels[channel]?.revision ?? 0)) throw new Error('La copia remota es anterior a la última sincronización. Se han conservado los datos locales.');
        const rawRemote = state ? await decryptSnapshot(state.envelope, key, this.ports.userId, channel, revision) : {};
        const remoteEntries = validate(rawRemote);
        originalData[channel] = JSON.parse(JSON.stringify(remoteEntries)) as Entries;
        wireDirty[channel] = !same(rawRemote, remoteEntries);
        this.check();
        let localEntries = validate(local.data[channel]);
        if (this.ports.prepareLocal) localEntries = this.ports.prepareLocal(channel, localEntries, remoteEntries);
        // Before notes were available on both clients, an absent common note was unknown.
        // An explicitly cleared note has nota_conocida=true and must never be filled in.
        if (channel === 'cases') for (const [id, value] of Object.entries(remoteEntries)) {
          const remoteCase = value as { procedure: Record<string, unknown> };
          const localCase = localEntries[id] as { procedure: Record<string, unknown> } | undefined;
          if (localCase?.procedure.nota_conocida === true && remoteCase.procedure.nota_conocida === false) {
            remoteCase.procedure.notas = localCase.procedure.notas;
            remoteCase.procedure.nota_conocida = true;
          }
        }
        remoteData[channel] = remoteEntries;
        const result = await mergeEntries(channel, localEntries, remoteEntries, local.baseline?.channels[channel]?.hashes, this.resolutions);
        this.check();
        conflicts.push(...result.conflicts.map(conflict => {
          const item = local.data.cases?.[conflict.id] as { procedure?: { fecha?: string; procedimiento?: string } } | undefined;
          return { ...conflict, caseLabel: item?.procedure ? `${item.procedure.fecha} · ${item.procedure.procedimiento}` : undefined };
        }));
        data[channel] = result.merged;
        expected[channel] = revision;
        baseline.channels[channel] = { revision, hashes: {} };
      }
      if (!conflicts.length && this.ports.reconcile) conflicts.push(...await this.ports.reconcile(data, remoteData, this.resolutions));
      this.check();
      if (conflicts.length) {
        this.publish({ phase: 'conflict', message: `${conflicts.length} caso(s) tienen cambios diferentes. Revisa las versiones completas antes de continuar.`, conflicts });
        return;
      }
      for (const channel of Object.keys(expected)) {
        baseline.channels[channel].hashes = await hashes(data[channel]);
        // Compare to the unmodified server snapshot; notes may have been filled above.
        const state = remote[channel];
        const original = originalData[channel];
        if (!state || wireDirty[channel] || !same(data[channel], original)) {
          updates[channel] = await encryptSnapshot(data[channel], key, this.ports.userId, channel, expected[channel] + 1);
        }
        this.check();
      }
      // Even when no content changed, the server checks the revisions atomically.
      const revisions = await this.ports.commitRemote(expected, updates, this.controller.signal);
      this.check();
      if (!revisions) continue;
      for (const channel of Object.keys(expected)) {
        const next = expected[channel] + (updates[channel] ? 1 : 0);
        if (revisions[channel] !== next) throw new Error('El servidor devolvió una revisión no válida.');
        baseline.channels[channel].revision = next;
      }
      const applied = await this.ports.apply(local, data, baseline);
      this.check();
      // Never advance the baseline if a local edit raced with the network request.
      if (!applied) continue;
      this.resolutions.clear();
      this.publish({ phase: 'ready', message: 'Datos sincronizados', conflicts: [], lastSyncedAt: new Date().toISOString() });
      return;
    }
    throw new Error('Se han recibido nuevos cambios durante la sincronización. Tus datos se conservan; vuelve a intentarlo.');
  }
}
