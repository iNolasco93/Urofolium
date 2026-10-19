import { clearStoneDetails, getDB, getDatabaseOwner, assertDatabaseOwner, isWebDatabase, readWebStoneDetails, updateWebStoneDetails } from './database';
import { setMeta } from './metaRepository';
import type { StoneDetails, StoneProcedureRaw } from '../lib/types';

type StoneDetailsInput = Omit<StoneDetails, 'created_at' | 'updated_at'>;

async function markDataChanged(userId: string): Promise<void> {
  assertDatabaseOwner(userId);
  await setMeta('last_data_changed_at', new Date().toISOString());
}

function normalizeRaw(value: unknown): StoneProcedureRaw {
  if (typeof value === 'string') {
    try {
      return normalizeRaw(JSON.parse(value));
    } catch {
      return { urs: false, rirs: false, nlpc: false };
    }
  }

  const raw = (value ?? {}) as Partial<StoneProcedureRaw>;
  return {
    urs: raw.urs === true,
    rirs: raw.rirs === true,
    nlpc: raw.nlpc === true,
  };
}

function rowToStoneDetails(row: Record<string, unknown>): StoneDetails {
  return {
    procedure_id: row.procedure_id as string,
    lateralidad: (row.lateralidad as string) ?? null,
    procedimiento_raw: normalizeRaw(row.procedimiento_raw),
    nefromax_fr: row.nefromax_fr != null ? Number(row.nefromax_fr) : null,
    amplatz_fr: row.amplatz_fr != null ? Number(row.amplatz_fr) : null,
    enhebrado: row.enhebrado === 1 || row.enhebrado === true,
    tamanio_mm: row.tamanio_mm != null ? Number(row.tamanio_mm) : null,
    tutor_interno: (row.tutor_interno as string) ?? null,
    drenaje_nefrostomico: (row.drenaje_nefrostomico as string) ?? null,
    sonda_fr: row.sonda_fr != null ? Number(row.sonda_fr) : null,
    etiqueta_drenaje: (row.etiqueta_drenaje as string) ?? null,
    stonefree: row.stonefree == null ? null : row.stonefree === 1 || row.stonefree === true,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getStoneDetailsByProcedureId(procedureId: string): Promise<StoneDetails | null> {
  if (isWebDatabase()) {
    return readWebStoneDetails().find(item => item.procedure_id === procedureId) ?? null;
  }

  const db = getDB();
  const res = await db.query(`SELECT * FROM stone_details WHERE procedure_id = ?`, [procedureId]);
  if (!res.values || res.values.length === 0) return null;
  return rowToStoneDetails(res.values[0]);
}

export async function getAllStoneDetails(): Promise<StoneDetails[]> {
  if (isWebDatabase()) {
    return readWebStoneDetails();
  }

  const db = getDB();
  const res = await db.query(`SELECT * FROM stone_details ORDER BY created_at DESC`);
  return (res.values ?? []).map(rowToStoneDetails);
}

export async function upsertStoneDetails(data: StoneDetailsInput): Promise<StoneDetails> {
  const userId = getDatabaseOwner();
  const now = new Date().toISOString();

  if (isWebDatabase()) {
    let next!: StoneDetails;
    await updateWebStoneDetails(items => {
      const existing = items.find(item => item.procedure_id === data.procedure_id);
      next = { ...data, created_at: existing?.created_at ?? now, updated_at: now };
      return [...items.filter(item => item.procedure_id !== data.procedure_id), next];
    });
    return next;
  }

  const db = getDB();
  const existing = await getStoneDetailsByProcedureId(data.procedure_id);
  const createdAt = existing?.created_at ?? now;

  await db.run(
    `INSERT INTO stone_details
      (procedure_id, lateralidad, procedimiento_raw, nefromax_fr, amplatz_fr,
       enhebrado, tamanio_mm, tutor_interno, drenaje_nefrostomico, sonda_fr,
       etiqueta_drenaje, stonefree, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(procedure_id) DO UPDATE SET
       lateralidad = excluded.lateralidad,
       procedimiento_raw = excluded.procedimiento_raw,
       nefromax_fr = excluded.nefromax_fr,
       amplatz_fr = excluded.amplatz_fr,
       enhebrado = excluded.enhebrado,
       tamanio_mm = excluded.tamanio_mm,
       tutor_interno = excluded.tutor_interno,
       drenaje_nefrostomico = excluded.drenaje_nefrostomico,
       sonda_fr = excluded.sonda_fr,
       etiqueta_drenaje = excluded.etiqueta_drenaje,
       stonefree = excluded.stonefree,
       updated_at = excluded.updated_at`,
    [
      data.procedure_id,
      data.lateralidad,
      JSON.stringify(data.procedimiento_raw),
      data.nefromax_fr ?? null,
      data.amplatz_fr ?? null,
      data.enhebrado ? 1 : 0,
      data.tamanio_mm ?? null,
      data.tutor_interno ?? null,
      data.drenaje_nefrostomico ?? null,
      data.sonda_fr ?? null,
      data.etiqueta_drenaje ?? null,
      data.stonefree == null ? null : data.stonefree ? 1 : 0,
      createdAt,
      now,
    ]
  );

  await markDataChanged(userId);
  return { ...data, created_at: createdAt, updated_at: now };
}

export async function deleteStoneDetails(procedureId: string): Promise<void> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) {
    await updateWebStoneDetails(items => items.filter(item => item.procedure_id !== procedureId));
    return;
  }

  const db = getDB();
  await db.run(`DELETE FROM stone_details WHERE procedure_id = ?`, [procedureId]);
  await markDataChanged(userId);
}

export async function clearAllStoneDetails(): Promise<void> {
  const userId = getDatabaseOwner();
  await clearStoneDetails();
  await markDataChanged(userId);
}

export async function upsertStoneDetailsBatch(items: StoneDetails[]): Promise<void> {
  const userId = getDatabaseOwner();
  if (items.length === 0) return;

  if (isWebDatabase()) {
    await updateWebStoneDetails(current => {
      const byId = new Map(current.map(item => [item.procedure_id, item]));
      for (const item of items) byId.set(item.procedure_id, item);
      return [...byId.values()];
    });
    return;
  }

  const db = getDB();
  for (const item of items) {
    await db.run(
      `INSERT OR REPLACE INTO stone_details
        (procedure_id, lateralidad, procedimiento_raw, nefromax_fr, amplatz_fr,
         enhebrado, tamanio_mm, tutor_interno, drenaje_nefrostomico, sonda_fr,
         etiqueta_drenaje, stonefree, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        item.procedure_id,
        item.lateralidad,
        JSON.stringify(item.procedimiento_raw),
        item.nefromax_fr ?? null,
        item.amplatz_fr ?? null,
        item.enhebrado ? 1 : 0,
        item.tamanio_mm ?? null,
        item.tutor_interno ?? null,
        item.drenaje_nefrostomico ?? null,
        item.sonda_fr ?? null,
        item.etiqueta_drenaje ?? null,
        item.stonefree == null ? null : item.stonefree ? 1 : 0,
        item.created_at,
        item.updated_at,
      ]
    );
  }
  await markDataChanged(userId);
}
