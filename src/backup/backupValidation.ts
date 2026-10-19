import type { BackupPayload, Procedure, StoneDetails } from '../lib/types';

interface BackupValidationOptions {
  userId: string;
  maxBackupVersion: number;
  maxSchemaVersion: number;
}

type JsonObject = Record<string, unknown>;

function invalid(path: string): never {
  throw new Error(`Respaldo inválido: revisa ${path}. No se han reemplazado los datos.`);
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  return value as JsonObject;
}

function text(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== 'string' || (nonEmpty && !value.trim())) invalid(path);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function date(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalid(path);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) invalid(path);
  return result;
}

function timestamp(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)) invalid(path);
  date(result.slice(0, 10), path);
  if (!Number.isFinite(Date.parse(result))) invalid(path);
  return result;
}

function version(value: unknown, maximum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) invalid(path);
  if (value > maximum) throw new Error(`El respaldo usa una versión de ${path} más reciente. Actualiza la app antes de restaurar.`);
  return value;
}

function procedure(value: unknown, index: number, schemaVersion: number): Procedure {
  const path = `data.procedures[${index}]`;
  const row = object(value, path);
  return {
    id: text(row.id, `${path}.id`, true),
    fecha: date(row.fecha, `${path}.fecha`),
    categoria: text(row.categoria, `${path}.categoria`),
    procedimiento: text(row.procedimiento, `${path}.procedimiento`),
    abordaje: text(row.abordaje, `${path}.abordaje`),
    duracion: nullableNumber(row.duracion, `${path}.duracion`),
    rol: text(row.rol, `${path}.rol`),
    cirujano_senior: nullableText(row.cirujano_senior, `${path}.cirujano_senior`),
    primer_ayudante: schemaVersion < 3 && row.primer_ayudante === undefined
      ? null
      : nullableText(row.primer_ayudante, `${path}.primer_ayudante`),
    segundo_ayudante: nullableText(row.segundo_ayudante, `${path}.segundo_ayudante`),
    complicaciones: nullableText(row.complicaciones, `${path}.complicaciones`),
    otro_especificar: nullableText(row.otro_especificar, `${path}.otro_especificar`),
    created_at: timestamp(row.created_at, `${path}.created_at`),
    updated_at: timestamp(row.updated_at, `${path}.updated_at`),
    deleted_at: row.deleted_at === null ? null : timestamp(row.deleted_at, `${path}.deleted_at`),
  };
}

function stoneDetails(value: unknown, index: number): StoneDetails {
  const path = `data.stoneDetails[${index}]`;
  const row = object(value, path);
  const raw = object(row.procedimiento_raw, `${path}.procedimiento_raw`);
  return {
    procedure_id: text(row.procedure_id, `${path}.procedure_id`, true),
    lateralidad: nullableText(row.lateralidad, `${path}.lateralidad`),
    procedimiento_raw: {
      urs: boolean(raw.urs, `${path}.procedimiento_raw.urs`),
      rirs: boolean(raw.rirs, `${path}.procedimiento_raw.rirs`),
      nlpc: boolean(raw.nlpc, `${path}.procedimiento_raw.nlpc`),
    },
    nefromax_fr: nullableNumber(row.nefromax_fr, `${path}.nefromax_fr`),
    amplatz_fr: nullableNumber(row.amplatz_fr, `${path}.amplatz_fr`),
    enhebrado: boolean(row.enhebrado, `${path}.enhebrado`),
    tamanio_mm: nullableNumber(row.tamanio_mm, `${path}.tamanio_mm`),
    tutor_interno: nullableText(row.tutor_interno, `${path}.tutor_interno`),
    drenaje_nefrostomico: nullableText(row.drenaje_nefrostomico, `${path}.drenaje_nefrostomico`),
    sonda_fr: nullableNumber(row.sonda_fr, `${path}.sonda_fr`),
    etiqueta_drenaje: nullableText(row.etiqueta_drenaje, `${path}.etiqueta_drenaje`),
    stonefree: row.stonefree === null ? null : boolean(row.stonefree, `${path}.stonefree`),
    created_at: timestamp(row.created_at, `${path}.created_at`),
    updated_at: timestamp(row.updated_at, `${path}.updated_at`),
  };
}

/** Validate and normalize the entire decrypted backup before any database mutation. */
export function validateBackupPayload(input: unknown, options: BackupValidationOptions): BackupPayload {
  const payload = object(input, 'archivo');
  if (payload.app !== 'UroFolium') invalid('app');
  const backupVersion = version(payload.backupVersion, options.maxBackupVersion, 'backupVersion');
  const schema = object(payload.schema, 'schema');
  const schemaVersion = version(schema.version, options.maxSchemaVersion, 'schema.version');
  const user = object(payload.user, 'user');
  const userId = text(user.supabaseUserId, 'user.supabaseUserId', true);
  if (userId !== options.userId) throw new Error('Este respaldo pertenece a otro usuario. No se han reemplazado los datos.');
  const email = text(user.email, 'user.email');
  const device = object(payload.device, 'device');
  const data = object(payload.data, 'data');
  if (!Array.isArray(data.procedures)) invalid('data.procedures');
  const procedures = data.procedures.map((row, index) => procedure(row, index, schemaVersion));
  const ids = new Set<string>();
  for (const row of procedures) {
    if (ids.has(row.id)) invalid('identificadores duplicados en data.procedures');
    ids.add(row.id);
  }

  // Version 1 predates the stone-details collection. Missing modern data is an error.
  const rawDetails = data.stoneDetails === undefined && (backupVersion === 1 || schemaVersion === 1)
    ? []
    : data.stoneDetails;
  if (!Array.isArray(rawDetails)) invalid('data.stoneDetails');
  const details = rawDetails.map(stoneDetails);
  const detailIds = new Set<string>();
  for (const row of details) {
    if (!ids.has(row.procedure_id)) invalid('data.stoneDetails: procedimiento inexistente');
    if (detailIds.has(row.procedure_id)) invalid('identificadores duplicados en data.stoneDetails');
    detailIds.add(row.procedure_id);
  }

  return {
    app: 'UroFolium',
    backupVersion,
    createdAt: timestamp(payload.createdAt, 'createdAt'),
    user: { supabaseUserId: userId, email },
    device: {
      platform: text(device.platform, 'device.platform', true),
      appVersion: text(device.appVersion, 'device.appVersion', true),
      label: text(device.label, 'device.label'),
    },
    schema: { version: schemaVersion },
    data: { procedures, stoneDetails: details },
  };
}
