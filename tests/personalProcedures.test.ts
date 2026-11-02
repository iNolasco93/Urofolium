import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { insertPersonalBeforeOthers, procedureNameExists, savePersonalProcedure, validatePersonalCatalog, validatePersonalProcedure } from '../src/lib/personalProcedures';

const procedure = {
  id: 'personal-1', categoria: 'Litiasis', nombre: 'Técnica especial', abordajes: ['Percutáneo'],
  formulario: 'percutaneo', createdAt: '2026-11-02T12:00:00.000Z',
  updatedAt: '2026-11-02T12:00:00.000Z', archivedAt: null,
};

test('valida y conserva técnicas personales de litiasis', () => {
  assert.deepEqual(validatePersonalCatalog([procedure]), [procedure]);
  assert.throws(() => validatePersonalProcedure({ ...procedure, categoria: 'Patología renal' }));
  assert.throws(() => validatePersonalProcedure({ ...procedure, abordajes: [] }));
  assert.throws(() => validatePersonalProcedure({ ...procedure, abordajes: ['Inventado'] }));
  assert.throws(() => validatePersonalCatalog([procedure, procedure]));
});

test('detecta duplicados de nombre en una categoría sin depender de tildes', () => {
  assert.equal(procedureNameExists('Litiasis', ' técnica   ESPECIAL ', [procedure]), true);
  assert.equal(procedureNameExists('Litiasis', 'RIRS', []), true);
  assert.equal(procedureNameExists('Patología prostática', 'holep', []), true);
  assert.equal(procedureNameExists('Patología renal', 'Técnica especial', [procedure]), false);
  assert.equal(procedureNameExists('Litiasis', 'Técnica especial', [procedure], procedure.id), false);
});

test('impide crear duplicados y conserva las técnicas archivadas', () => {
  const archived = { ...procedure, archivedAt: '2026-11-02T13:00:00.000Z' };
  assert.throws(() => savePersonalProcedure([archived], { ...procedure, id: 'another' }));
  assert.deepEqual(savePersonalProcedure([procedure], archived), [archived]);
});

test('la sincronización conserva las técnicas por identificador y rechaza datos alterados', async () => {
  const { catalogEntries, validateCatalogEntries } = await import('../src/sync/syncCatalog');
  const { mergeEntries } = await import('../src/sync/syncMerge');
  const first = catalogEntries([procedure]);
  const secondEntry = { ...procedure, id: 'personal-2', nombre: 'Otra técnica' };
  const second = catalogEntries([secondEntry]);
  const merged = await mergeEntries('catalog', first, second);
  assert.equal(Object.keys(merged.merged).length, 2);
  assert.deepEqual(validateCatalogEntries(merged.merged), { ...first, ...second });
  assert.throws(() => validateCatalogEntries({ incorrecto: procedure }));
});

test('los clientes anteriores rechazan la marca del catálogo en vez de editarlo sin conocerlo', async () => {
  const { CATALOG_MARKER, casesWithCatalogMarker, validateCasesWithCatalogMarker } = await import('../src/sync/syncCatalog');
  const { validateCases } = await import('../src/sync/syncModel');
  const marked = casesWithCatalogMarker({}, [procedure]);
  assert.deepEqual(validateCasesWithCatalogMarker(marked), marked);
  assert.throws(() => validateCases(marked));
  assert.throws(() => validateCasesWithCatalogMarker({ [CATALOG_MARKER]: { version: 2 } }));
});


test('los procedimientos personales se muestran antes de Otros', () => {
  assert.deepEqual(insertPersonalBeforeOthers(['RTU cuello', 'Otros'], ['Técnica A', 'Técnica B']), ['RTU cuello', 'Técnica A', 'Técnica B', 'Otros']);
  assert.deepEqual(insertPersonalBeforeOthers(['Linfadenectomía'], ['Técnica A']), ['Linfadenectomía', 'Técnica A']);
});
