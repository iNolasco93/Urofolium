import type { Procedure, StoneDetails } from '../lib/types';

export const SHARED_FIELDS = [
  'id', 'fecha', 'estado', 'notas', 'nota_conocida', 'notas_revisadas', 'categoria', 'procedimiento', 'abordaje', 'via_acceso', 'duracion', 'rol',
  'cirujano_senior', 'primer_ayudante', 'segundo_ayudante', 'complicaciones',
  'otro_especificar', 'created_at', 'updated_at', 'deleted_at',
] as const;
export type SharedProcedure = Pick<Procedure, typeof SHARED_FIELDS[number]>;
export interface CaseData { procedure: SharedProcedure; stone: StoneDetails | null }
export type Entries = Record<string, unknown>;
export type SyncData = Record<string, Entries>;
export interface ChannelBaseline { revision: number; hashes: Record<string, string> }
export interface Baseline { version: 1; channels: Record<string, ChannelBaseline> }
export interface LocalSnapshot { data: SyncData; baseline: Baseline | null; stamp: number; session: number }
export interface Conflict { channel: string; id: string; local: unknown; remote: unknown; localHash: string; remoteHash: string; caseLabel?: string; localLabel?: string; remoteLabel?: string }
export interface Resolution { localHash: string; remoteHash: string; choice: 'local' | 'remote' }
export type Resolutions = Map<string, Resolution>;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La copia de sincronización contiene datos no válidos.');
  return value as Record<string, unknown>;
}
function string(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new Error('La copia contiene un texto no válido.');
  return value;
}
function timestamp(value: unknown, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('La copia contiene una fecha no válida.');
}
function number(value: unknown): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('La copia contiene un número no válido.');
}
function boolean(value: unknown, nullable = false): void {
  if (!(nullable && value === null) && typeof value !== 'boolean') throw new Error('La copia contiene una opción no válida.');
}
export function sharedProcedure(procedure: Procedure): SharedProcedure {
  // An explicit allowlist is also the wire format: never spread a local record here.
  const normalized = { ...procedure, estado: procedure.estado ?? 'realizada', notas: procedure.notas ?? null,
    nota_conocida: procedure.nota_conocida ?? !!procedure.notas , notas_revisadas: procedure.notas_revisadas ?? false, via_acceso: procedure.via_acceso ?? (procedure.abordaje === 'Retroperitoneal' ? 'Retroperitoneal' : null) };
  return Object.fromEntries(SHARED_FIELDS.map(key => [key, normalized[key]])) as unknown as SharedProcedure;
}
export function casesFromLocal(procedures: Procedure[], stones: StoneDetails[]): Entries {
  const byId = new Map(stones.map(item => [item.procedure_id, item]));
  const ids = new Set(procedures.map(item => item.id));
  if (ids.size !== procedures.length || byId.size !== stones.length || stones.some(item => !ids.has(item.procedure_id))) {
    throw new Error('Hay identificadores duplicados o detalles de litiasis sin cirugía. Revisa los datos antes de sincronizar.');
  }
  return validateCases(Object.fromEntries(procedures.map(item => [item.id, {
    procedure: sharedProcedure(item), stone: byId.get(item.id) ?? null,
  }])));
}
export function validateCases(input: unknown): Entries {
  const entries = object(input);
  const normalized = Object.entries(entries).map(([id, value]) => {
    const item = object(value);
    const original = object(item.procedure);
    const expected = [...SHARED_FIELDS].sort().join();
    const legacy = SHARED_FIELDS.filter(key => !['estado', 'notas', 'nota_conocida', 'notas_revisadas', 'via_acceso'].includes(key)).sort().join();
    const withoutRoute = SHARED_FIELDS.filter(key => key !== 'via_acceso').sort().join();
    const keys = Object.keys(original).sort().join();
    if (Object.keys(item).sort().join() !== 'procedure,stone' || (keys !== expected && keys !== withoutRoute && keys !== legacy) || original.id !== id || !id.trim()) throw new Error('La copia contiene un caso no válido.');
    const previous: Record<string, unknown> = keys === legacy ? { ...original, estado: 'realizada', notas: null, nota_conocida: false, notas_revisadas: false } : original;
    const p: Record<string, unknown> = { ...previous, via_acceso: previous.via_acceso ?? (previous.abordaje === 'Retroperitoneal' ? 'Retroperitoneal' : null) };
    if (p.via_acceso !== null && p.via_acceso !== 'Transperitoneal' && p.via_acceso !== 'Retroperitoneal') throw new Error('La vía de acceso no es válida.');
    if (p.estado !== 'programada' && p.estado !== 'realizada') throw new Error('Estado de cirugía no válido.');
    string(p.notas, true); boolean(p.nota_conocida); boolean(p.notas_revisadas);
    for (const key of ['id', 'fecha', 'categoria', 'procedimiento', 'abordaje', 'rol']) string(p[key]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha as string) || new Date(`${p.fecha}T00:00:00Z`).toISOString().slice(0, 10) !== p.fecha) throw new Error('Fecha de cirugía no válida.');
    for (const key of ['cirujano_senior', 'primer_ayudante', 'segundo_ayudante', 'complicaciones', 'otro_especificar']) string(p[key], true);
    number(p.duracion);
    timestamp(p.created_at); timestamp(p.updated_at); timestamp(p.deleted_at, true);
    if (item.stone !== null) {
      const s = object(item.stone);
      const fields = ['procedure_id', 'lateralidad', 'procedimiento_raw', 'nefromax_fr', 'amplatz_fr', 'enhebrado', 'tamanio_mm', 'tutor_interno', 'drenaje_nefrostomico', 'sonda_fr', 'etiqueta_drenaje', 'stonefree', 'created_at', 'updated_at'];
      if (Object.keys(s).sort().join() !== fields.sort().join() || s.procedure_id !== id) throw new Error('Los detalles de litiasis no corresponden a la cirugía.');
      for (const key of ['lateralidad', 'tutor_interno', 'drenaje_nefrostomico', 'etiqueta_drenaje']) string(s[key], true);
      for (const key of ['nefromax_fr', 'amplatz_fr', 'tamanio_mm', 'sonda_fr']) number(s[key]);
      boolean(s.enhebrado); boolean(s.stonefree, true);
      timestamp(s.created_at); timestamp(s.updated_at);
      const raw = object(s.procedimiento_raw);
      if (Object.keys(raw).sort().join() !== 'nlpc,rirs,urs') throw new Error('Combinación de litiasis no válida.');
      for (const key of ['urs', 'rirs', 'nlpc']) boolean(raw[key]);
    }
    return [id, { ...item, procedure: p }];
  });
  return JSON.parse(JSON.stringify(Object.fromEntries(normalized))) as Entries;
}
export function parseBaseline(raw: string | null): Baseline | null {
  if (!raw) return null;
  const data = object(JSON.parse(raw));
  if (data.version !== 1) throw new Error('Actualiza la aplicación para leer el historial de sincronización.');
  const channels = object(data.channels);
  for (const value of Object.values(channels)) {
    const channel = object(value);
    if (!Number.isSafeInteger(channel.revision) || Number(channel.revision) < 0) throw new Error('Historial de sincronización no válido.');
    for (const hash of Object.values(object(channel.hashes))) {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Historial de sincronización no válido.');
    }
  }
  return data as unknown as Baseline;
}
