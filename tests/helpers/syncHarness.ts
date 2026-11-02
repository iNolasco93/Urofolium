import { webcrypto } from 'node:crypto';
import { SyncEngine, type RemoteState, type SyncStatus } from '../../src/sync/syncEngine';
import type { SyncEnvelope } from '../../src/sync/syncCrypto';
import { validateCases, type Baseline, type Entries, type LocalSnapshot, type SyncData } from '../../src/sync/syncModel';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
export const KEY = 'synthetic-sync-secret-for-tests';
export const time = '2026-10-30T10:00:00.000Z';
export function surgery(id = 'case-1') {
  return { id, fecha: '2026-10-30', estado: 'realizada' as const, notas: null as string | null, nota_conocida: false, notas_revisadas: false, categoria: 'Litiasis', procedimiento: 'RIRS', abordaje: 'Endoscópico', via_acceso: null, duracion: 60,
    rol: 'Cirujano principal', cirujano_senior: 'Senior', primer_ayudante: null, segundo_ayudante: null,
    complicaciones: null, otro_especificar: null, created_at: time, updated_at: time, deleted_at: null as string | null };
}
export function stone(id = 'case-1') {
  return { procedure_id: id, lateralidad: 'Derecha', procedimiento_raw: { urs: false, rirs: true, nlpc: false },
    nefromax_fr: null, amplatz_fr: null, enhebrado: false, tamanio_mm: 12, tutor_interno: null,
    drenaje_nefrostomico: null, sonda_fr: null, etiqueta_drenaje: null, stonefree: true, created_at: time, updated_at: time };
}
export function cases(id = 'case-1'): Entries { return { [id]: { procedure: surgery(id), stone: stone(id) } }; }
export class Server {
  accounts = new Map<string, RemoteState>();
  offline = false;
  beforeCommit?: () => void | Promise<void>;
  async read(user: string, channels: string[]): Promise<RemoteState> {
    if (this.offline) throw new Error('Sin conexión');
    return structuredClone(Object.fromEntries(channels.map(channel => [channel, this.accounts.get(user)?.[channel] ?? null])));
  }
  async commit(user: string, expected: Record<string, number>, updates: Record<string, SyncEnvelope>) {
    if (this.beforeCommit) { const hook = this.beforeCommit; this.beforeCommit = undefined; await hook(); }
    if (this.offline) throw new Error('Sin conexión');
    const state = this.accounts.get(user) ?? {};
    if (Object.entries(expected).some(([channel, revision]) => (state[channel]?.revision ?? 0) !== revision)) return null;
    const revisions = Object.fromEntries(Object.entries(expected).map(([channel, revision]) => [channel, revision + (updates[channel] ? 1 : 0)]));
    for (const [channel, envelope] of Object.entries(updates)) state[channel] = { revision: revisions[channel], envelope: structuredClone(envelope) };
    this.accounts.set(user, state);
    return revisions;
  }
}
export class Device {
  data: SyncData;
  baseline: Baseline | null = null;
  key: string | null = null;
  stamp = 0;
  session = 1;
  failApply = false;
  status: SyncStatus;
  engine: SyncEngine;
  snapshotTransform?: () => SyncData;
  applied?: (data: SyncData) => void;
  constructor(server: Server, data: SyncData = { cases: {} }, validators: Record<string, (value: unknown) => Entries> = { cases: validateCases }, user = 'account-a', hooks: { prepareLocal?: import('../../src/sync/syncEngine').SyncPorts['prepareLocal']; reconcile?: import('../../src/sync/syncEngine').SyncPorts['reconcile'] } = {}) {
    this.data = structuredClone(data);
    const session = this.session;
    this.engine = new SyncEngine({
      userId: user, validators, ...hooks,
      assertActive: () => { if (this.session !== session) throw new Error('Sesión cambiada'); },
      getKey: async () => this.key,
      saveKey: async key => { this.key = key; },
      capture: async () => ({ data: structuredClone(this.snapshotTransform?.() ?? this.data), baseline: structuredClone(this.baseline), stamp: this.stamp, session: this.session }),
      apply: async (local: LocalSnapshot, data, baseline) => {
        if (this.failApply) throw new Error('No queda espacio');
        if (local.stamp !== this.stamp || local.session !== this.session) return false;
        this.data = structuredClone(data); this.baseline = structuredClone(baseline); this.stamp++;
        this.applied?.(data);
        return true;
      },
      readRemote: () => server.read(user, Object.keys(validators)),
      commitRemote: (expected, updates) => server.commit(user, expected, updates),
      publish: status => { this.status = status; },
    });
    this.status = this.engine.status;
  }
  edit(data: SyncData): void { this.data = structuredClone(data); this.stamp++; }
}
