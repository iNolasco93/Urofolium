import { CATEGORIAS, PROCEDIMIENTOS_HBP_GUARDADOS, PROCEDIMIENTOS_ORQUIECTOMIA, TODOS_ABORDAJES, getAbordajesDisponibles } from './categorias';

export const PERSONAL_APPROACHES: readonly string[] = [...TODOS_ABORDAJES, 'Retroperitoneal', 'Microcirugía', 'Vaginal'];

/** A user-owned catalogue entry. Archived entries remain available to old cases. */
export interface PersonalProcedure {
  id: string;
  categoria: string;
  nombre: string;
  abordajes: string[];
  formulario: 'sencillo' | 'litiasis' | 'percutaneo';
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export function normalizeProcedureName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

/** Validate untrusted backup or synchronization data before using it. */
export function validatePersonalProcedure(value: unknown): PersonalProcedure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Procedimiento personal no válido.');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join() !== 'abordajes,archivedAt,categoria,createdAt,formulario,id,nombre,updatedAt' ||
      typeof p.id !== 'string' || !p.id.trim() || typeof p.categoria !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORIAS, p.categoria) ||
      typeof p.nombre !== 'string' || !p.nombre.trim() || p.nombre.trim() !== p.nombre || p.nombre.length > 120 ||
      !Array.isArray(p.abordajes) || !p.abordajes.length || p.abordajes.some(a => typeof a !== 'string' || (!PERSONAL_APPROACHES.includes(a) || !getAbordajesDisponibles(p.categoria as string, '').includes(a))) ||
      new Set(p.abordajes).size !== p.abordajes.length ||
      !['sencillo', 'litiasis', 'percutaneo'].includes(String(p.formulario)) ||
      (p.categoria !== 'Litiasis' && p.formulario !== 'sencillo') ||
      !validTimestamp(p.createdAt) || !validTimestamp(p.updatedAt) || (p.archivedAt !== null && !validTimestamp(p.archivedAt))) {
    throw new Error('Procedimiento personal no válido.');
  }
  return { ...p, abordajes: [...p.abordajes] } as unknown as PersonalProcedure;
}

export function validatePersonalCatalog(value: unknown): PersonalProcedure[] {
  if (!Array.isArray(value)) throw new Error('La lista de procedimientos personales no es válida.');
  const entries = value.map(validatePersonalProcedure);
  if (new Set(entries.map(p => p.id)).size !== entries.length) throw new Error('Hay identificadores de procedimientos personales duplicados.');
  return entries;
}

export function procedureNameExists(categoria: string, nombre: string, catalog: PersonalProcedure[], exceptId?: string): boolean {
  const normalized = normalizeProcedureName(nombre);
  if (!normalized) return false;
  // Built-in names and legacy aliases have special forms or automatic migration rules.
  const reserved = [...Object.values(CATEGORIAS).flat(), ...PROCEDIMIENTOS_HBP_GUARDADOS, ...PROCEDIMIENTOS_ORQUIECTOMIA, 'Penectomía parcial', 'Penectomía total', 'Botox', 'Colporrafia anterior', 'Esfínter artificial', 'Adenomectomía suprapúbica', 'Peyronie', 'Peyronie + Prótesis', 'Orquiectomía simple / escrotal', 'Orquiectomía simple/escrotal', 'Orquiectomía inguinal + prótesis'];
  if (categoria === 'Litiasis') reserved.push('URS + RIRS', 'URS + NLPC');
  if (categoria === 'Patología prostática') reserved.push('Cirugía HBP', ...PROCEDIMIENTOS_HBP_GUARDADOS);
  return reserved.some(item => normalizeProcedureName(item) === normalized) || normalized.startsWith('otros:') ||
    catalog.some(item => item.id !== exceptId && item.categoria === categoria && normalizeProcedureName(item.nombre) === normalized);
}

export function savePersonalProcedure(catalog: PersonalProcedure[], candidate: PersonalProcedure): PersonalProcedure[] {
  const validated = validatePersonalCatalog(catalog);
  const entry = validatePersonalProcedure(candidate);
  if (!entry.archivedAt && procedureNameExists(entry.categoria, entry.nombre, validated, entry.id)) {
    throw new Error('Ya existe un procedimiento con ese nombre en esta categoría.');
  }
  const previous = validated.find(item => item.id === entry.id);
  if (previous && previous.createdAt !== entry.createdAt) throw new Error('No se puede cambiar la fecha de creación.');
  return [...validated.filter(item => item.id !== entry.id), entry];
}

/** Keep the fallback at the end, even when the list has personal entries. */
export function insertPersonalBeforeOthers(standard: readonly string[], personal: readonly string[]): string[] {
  const othersIndex = standard.indexOf('Otros');
  return othersIndex < 0 ? [...standard, ...personal] : [...standard.slice(0, othersIndex), ...personal, ...standard.slice(othersIndex)];
}
