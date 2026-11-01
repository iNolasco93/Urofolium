import { runLocalWrite, upsertNativeProcedures } from './database';
import { v4 as uuidv4 } from 'uuid';
import { getDB, getDatabaseOwner, assertDatabaseOwner, isWebDatabase, readWebProcedures, updateWebProcedures } from './database';
import { setMeta } from './metaRepository';
import type { Procedure } from '../lib/types';

async function markDataChanged(userId: string): Promise<void> {
  assertDatabaseOwner(userId);
  await setMeta('last_data_changed_at', new Date().toISOString());
}

function rowToProcedure(row: Record<string, unknown>): Procedure {
  return {
    id: row.id as string,
    fecha: row.fecha as string,
    estado: (row.estado as Procedure['estado']) ?? 'realizada',
    nota_conocida: row.nota_conocida === 1 || row.nota_conocida === true,
    notas_revisadas: row.notas_revisadas === 1 || row.notas_revisadas === true,
    categoria: row.categoria as string,
    procedimiento: row.procedimiento as string,
    abordaje: row.abordaje as string,
    duracion: row.duracion != null ? Number(row.duracion) : null,
    rol: row.rol as string,
    cirujano_senior: (row.cirujano_senior as string) ?? null,
    primer_ayudante: (row.primer_ayudante as string) ?? null,
    segundo_ayudante: (row.segundo_ayudante as string) ?? null,
    complicaciones: (row.complicaciones as string) ?? null,
    notas: (row.notas as string) ?? null,
    otro_especificar: (row.otro_especificar as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string) ?? null,
  };
}

export async function getAllProcedures(): Promise<Procedure[]> {
  if (isWebDatabase()) {
    return readWebProcedures()
      .filter(p => p.deleted_at === null)
      .sort((a, b) => `${b.fecha}${b.created_at}`.localeCompare(`${a.fecha}${a.created_at}`));
  }
  const db = getDB();
  const res = await db.query(
    `SELECT * FROM procedures WHERE deleted_at IS NULL ORDER BY fecha DESC, created_at DESC`
  );
  return (res.values ?? []).map(rowToProcedure);
}

export async function getProcedureById(id: string): Promise<Procedure | null> {
  if (isWebDatabase()) {
    return readWebProcedures().find(p => p.id === id) ?? null;
  }
  const db = getDB();
  const res = await db.query(`SELECT * FROM procedures WHERE id = ?`, [id]);
  if (!res.values || res.values.length === 0) return null;
  return rowToProcedure(res.values[0]);
}

export async function countProcedures(): Promise<number> {
  if (isWebDatabase()) {
    return readWebProcedures().filter(p => p.deleted_at === null).length;
  }
  const db = getDB();
  const res = await db.query(`SELECT COUNT(*) as count FROM procedures WHERE deleted_at IS NULL`);
  return res.values?.[0]?.count ?? 0;
}

export async function isDatabaseEmpty(): Promise<boolean> {
  return (await countProcedures()) === 0;
}

async function createProcedureUnlocked(
  data: Omit<Procedure, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<Procedure> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) {
    const now = new Date().toISOString();
    const procedure = { ...data, id: uuidv4(), created_at: now, updated_at: now, deleted_at: null };
    await updateWebProcedures(items => [...items, procedure]);
    return procedure;
  }
  const now = new Date().toISOString();
  const procedure = { ...data, id: uuidv4(), created_at: now, updated_at: now, deleted_at: null };
  await upsertNativeProcedures([procedure]);
  await markDataChanged(userId);
  return procedure;
}

async function updateProcedureUnlocked(
  id: string,
  data: Partial<Omit<Procedure, 'id' | 'created_at'>>
): Promise<void> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) {
    const now = new Date().toISOString();
    await updateWebProcedures(items => items.map(p => (
      p.id === id ? { ...p, ...data, updated_at: now } : p
    )));
    return;
  }
  const db = getDB();
  const now = new Date().toISOString();

  const columns = ['fecha', 'estado', 'nota_conocida', 'notas_revisadas', 'categoria', 'procedimiento', 'abordaje', 'duracion', 'rol', 'cirujano_senior', 'primer_ayudante', 'segundo_ayudante', 'complicaciones', 'notas', 'otro_especificar', 'deleted_at'] as const;
  const changed = columns.filter(column => data[column] !== undefined);
  const values = changed.map(column => column === 'nota_conocida' || column === 'notas_revisadas' ? Number(data[column]) : data[column] ?? null);
  await db.run(
    `UPDATE procedures SET ${[...changed.map(column => `${column} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`,
    [...values, now, id],
  );
  await markDataChanged(userId);
}

async function deleteProcedureUnlocked(id: string): Promise<void> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) {
    const now = new Date().toISOString();
    await updateWebProcedures(items => items.map(p => (
      p.id === id ? { ...p, deleted_at: now, updated_at: now } : p
    )));
    return;
  }
  const db = getDB();
  const now = new Date().toISOString();
  await db.run(`UPDATE procedures SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
  await markDataChanged(userId);
}

async function upsertProceduresUnlocked(items: Procedure[]): Promise<void> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) {
    await updateWebProcedures(current => {
      const byId = new Map(current.map(p => [p.id, p]));
      for (const item of items) byId.set(item.id, item);
      return [...byId.values()];
    });
    return;
  }
  await upsertNativeProcedures(items);
  await markDataChanged(userId);
}

export function createProcedure(data: Omit<Procedure, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>): Promise<Procedure> {
  return runLocalWrite(getDatabaseOwner(), () => createProcedureUnlocked(data));
}

export function updateProcedure(id: string, data: Partial<Omit<Procedure, 'id' | 'created_at'>>): Promise<void> {
  return runLocalWrite(getDatabaseOwner(), () => updateProcedureUnlocked(id, data));
}

export function deleteProcedure(id: string): Promise<void> {
  return runLocalWrite(getDatabaseOwner(), () => deleteProcedureUnlocked(id));
}

export function upsertProcedures(items: Procedure[]): Promise<void> {
  return runLocalWrite(getDatabaseOwner(), () => upsertProceduresUnlocked(items));
}

export async function getAllStoredProcedures(): Promise<Procedure[]> {
  if (isWebDatabase()) return readWebProcedures();
  const result = await getDB().query('SELECT * FROM procedures');
  return (result.values ?? []).map(rowToProcedure);
}
