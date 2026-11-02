import { validatePersonalCatalog, type PersonalProcedure } from '../lib/personalProcedures';
import { object, validateCases, type Entries } from './syncModel';

export function validateCatalogEntries(value: unknown): Entries {
  const entries = object(value);
  const validated = validatePersonalCatalog(Object.values(entries));
  for (const [id, row] of Object.entries(entries)) {
    if (!row || typeof row !== 'object' || (row as { id?: unknown }).id !== id) throw new Error('Identificador de catálogo no válido.');
  }
  return Object.fromEntries(validated.map(item => [item.id, item]));
}

export function catalogEntries(value: PersonalProcedure[]): Entries {
  return validateCatalogEntries(Object.fromEntries(value.map(item => [item.id, item])));
}

export function describeCatalogValue(value: unknown): [string, string][] {
  const [item] = validatePersonalCatalog([value]);
  const types = { sencillo: 'Sencillo', litiasis: 'Litiasis', percutaneo: 'Litiasis con datos percutáneos' };
  return [['Procedimiento personal', item.nombre], ['Categoría', item.categoria], ['Abordajes', item.abordajes.join(', ')],
    ['Formulario', types[item.formulario]], ['Estado', item.archivedAt ? 'Eliminado' : 'Activo']];
}

// Older clients reject this marker instead of editing a personal case without its definition.
export const CATALOG_MARKER = '__personal_catalog_v1__';
export function casesWithCatalogMarker(cases: Entries, catalog: PersonalProcedure[]): Entries {
  return catalog.length ? { ...cases, [CATALOG_MARKER]: { version: 1 } } : cases;
}
export function validateCasesWithCatalogMarker(value: unknown): Entries {
  const raw = object(value);
  const { [CATALOG_MARKER]: marker, ...cases } = raw;
  if (marker !== undefined && JSON.stringify(marker) !== '{"version":1}') throw new Error('Versión de catálogo personal no válida.');
  const validated = validateCases(cases);
  return marker === undefined ? validated : { ...validated, [CATALOG_MARKER]: { version: 1 } };
}
export function withoutCatalogMarker(cases: Entries): Entries {
  const { [CATALOG_MARKER]: _marker, ...rest } = cases;
  return rest;
}
