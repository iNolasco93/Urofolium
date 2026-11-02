import { getAllStoredProcedures } from './procedureRepository';
import { getDatabaseOwner, getDataStamp, mergeDatabaseContents, runLocalWrite } from './database';
import { getMeta, setMeta } from './metaRepository';
import { procedureNameExists, savePersonalProcedure, validatePersonalCatalog, type PersonalProcedure } from '../lib/personalProcedures';

/** Caller holds the local-write queue when composing with another operation. */
export async function readPersonalProcedures(): Promise<PersonalProcedure[]> {
  const raw = await getMeta('personal_procedures');
  return raw === null ? [] : validatePersonalCatalog(JSON.parse(raw));
}

export function putPersonalProcedure(entry: PersonalProcedure): Promise<void> {
  return runLocalWrite(getDatabaseOwner(), async () => {
    const current = await readPersonalProcedures();
    // Re-adding the same removed name restores its identity and its historical cases.
    const removed = !entry.archivedAt && !current.some(item => item.id === entry.id)
      ? current.find(item => item.archivedAt && item.categoria === entry.categoria && item.nombre === entry.nombre)
      : undefined;
    if (removed) entry = { ...entry, id: removed.id, createdAt: removed.createdAt };
    const previous = current.find(item => item.id === entry.id);
    if (previous && (previous.nombre !== entry.nombre || previous.categoria !== entry.categoria || previous.formulario !== entry.formulario)) {
      const used = (await getAllStoredProcedures()).some(item => item.categoria === previous.categoria && item.procedimiento === previous.nombre);
      if (used) throw new Error('Esta técnica ya tiene cirugías registradas. Crea una técnica nueva para conservar los registros anteriores.');
    }
    const next = savePersonalProcedure(current, entry);
    await setMeta('personal_procedures', JSON.stringify(next));
  });
}

/** Rename and related case updates commit in a single local transaction. */
export async function renamePersonalProcedure(entry: PersonalProcedure, original: PersonalProcedure, updateCases: boolean): Promise<void> {
  const owner = getDatabaseOwner();
  const stamp = getDataStamp();
  const [catalog, procedures] = await Promise.all([readPersonalProcedures(), getAllStoredProcedures()]);
  const current = catalog.find(item => item.id === original.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(original)) throw new Error('El procedimiento ha cambiado. Vuelve a abrirlo antes de editar.');
  if (entry.categoria !== original.categoria || entry.formulario !== original.formulario) throw new Error('Para cambiar la categoría o el formulario, crea una técnica nueva.');
  const now = new Date().toISOString();
  const oldEntry = { ...current, archivedAt: now, updatedAt: now };
  const nextEntry = { ...entry, id: crypto.randomUUID(), createdAt: now, updatedAt: now, archivedAt: null };
  if (procedureNameExists(entry.categoria, entry.nombre, catalog, original.id)) throw new Error('Ya existe un procedimiento con ese nombre en esta categoría.');
  const next = validatePersonalCatalog([...catalog.map(item => item.id === original.id ? oldEntry : item), nextEntry]);
  const affected = updateCases ? procedures.filter(item => item.categoria === original.categoria && item.procedimiento === original.nombre)
    .map(item => ({ ...item, procedimiento: entry.nombre, updated_at: now })) : [];
  if (owner !== getDatabaseOwner()) throw new Error('La cuenta ha cambiado.');
  await mergeDatabaseContents(affected, [], [], stamp, next);
}
