import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';

const directory = await mkdtemp(join(tmpdir(), 'urofolium-excel-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const bundle = join(directory, 'workbook.cjs');
await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/procedureWorkbook.ts', import.meta.url))],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const { createProcedureWorkbook, getProcedureWorkbookColumns, parseProcedureWorkbook, readProcedureWorkbook, materializeProcedureImport } = createRequire(import.meta.url)(bundle);
const timestamp = '2026-07-01T09:10:11.123Z';
const procedure = {
  id: 'case-1', fecha: '2026-07-01', categoria: 'Litiasis', procedimiento: 'ECIRS',
  abordaje: 'Percutáneo', duracion: 0, rol: 'Cirujano principal', cirujano_senior: 'Cirujano sénior',
  primer_ayudante: null, segundo_ayudante: 'Ayudante de prueba', complicaciones: 'No',
  otro_especificar: null, created_at: timestamp, updated_at: '2026-07-02T10:11:12.456Z', deleted_at: null,
};
const stone = {
  procedure_id: procedure.id, lateralidad: 'Bilateral', procedimiento_raw: { urs: false, rirs: true, nlpc: true },
  nefromax_fr: 24, amplatz_fr: null, enhebrado: false, tamanio_mm: 12.5,
  tutor_interno: 'JJ', drenaje_nefrostomico: 'Sonda', sonda_fr: 10, etiqueta_drenaje: 'Sonda 10Fr + JJ',
  stonefree: null, created_at: timestamp, updated_at: '2026-07-03T13:14:15.678Z',
};

function workbook(headers, rows, name = 'Plantilla') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), name);
  return book;
}

function importWorkbook(book, existing = [], existingStone = []) {
  const parsed = readProcedureWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
  assert.deepEqual(parsed.errors, []);
  return { parsed, ...materializeProcedureImport(parsed.rows, existing, existingStone, timestamp) };
}

test('workbook columns contain only the UroFolium data model', () => {
  assert.deepEqual(getProcedureWorkbookColumns().slice(0, 11), [
    'id', 'fecha', 'categoria', 'procedimiento', 'procedimiento_base',
    'tipo_derivacion_urinaria', 'tecnica', 'tipo_protesis', 'abordaje', 'duracion', 'rol',
  ]);
  assert.equal(getProcedureWorkbookColumns().includes('referencia'), false);
  assert.equal(getProcedureWorkbookColumns().includes('notas'), false);
  assert.equal(getProcedureWorkbookColumns().includes('seguimiento'), false);
});

test('XLSX export and import preserve procedure and litiasis fields', () => {
  const procedures = [procedure, { ...procedure, id: 'case-2', procedimiento: 'RTU vesical', duracion: null }];
  const result = importWorkbook(createProcedureWorkbook(procedures, [stone]));
  assert.deepEqual(result.procedures, procedures);
  assert.deepEqual(result.stoneDetails, [stone]);
  assert.deepEqual(result.removeStoneIds, ['case-2']);
});

test('the migration review sheet is included only when records need review', () => {
  const current = createProcedureWorkbook([procedure], [stone]);
  assert.deepEqual(current.SheetNames, ['UroFolium']);

  const legacy = {
    ...procedure,
    id: 'legacy-case',
    categoria: 'Cirugía pélvica y prostática mayor',
    procedimiento: 'Cistectomía radical',
    abordaje: 'Abierto',
  };
  const withPending = createProcedureWorkbook([legacy], []);
  assert.deepEqual(withPending.SheetNames, ['UroFolium', 'Pendientes de revisión']);
  const rows = XLSX.utils.sheet_to_json(withPending.Sheets['Pendientes de revisión']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].categoria_sugerida, 'Patología vesical');
});

test('export writes final procedure names and structured columns, then reimports them', () => {
  const cases = [
    { ...procedure, id: 'cystectomy', categoria: 'Patología vesical', procedimiento: 'Cistectomía radical', abordaje: 'Robótico', otro_especificar: 'Bricker' },
    { ...procedure, id: 'peyronie', categoria: 'Patología peneana', procedimiento: 'Cirugía de Peyronie', abordaje: 'Abierto', otro_especificar: 'Yachia' },
    { ...procedure, id: 'peyronie-prosthesis', categoria: 'Patología peneana', procedimiento: 'Cirugía de Peyronie + Prótesis', abordaje: 'Abierto', otro_especificar: 'urofolium-detail-v1:{"tecnica":"Yachia","tipoProtesis":"hidráulica"}' },
    { ...procedure, id: 'penile-prosthesis', categoria: 'Patología peneana', procedimiento: 'Prótesis de pene', abordaje: 'Abierto', otro_especificar: 'maleable' },
    { ...procedure, id: 'biopsy', categoria: 'Patología testicular y escrotal', procedimiento: 'Biopsia testicular', abordaje: 'Percutáneo', otro_especificar: 'TESA' },
    { ...procedure, id: 'fistula', categoria: 'Patología uroginecológica', procedimiento: 'Fístula vesico-vaginal', abordaje: 'Vaginal', otro_especificar: 'Latzko' },
    { ...procedure, id: 'penectomy', categoria: 'Patología peneana', procedimiento: 'Penectomía total', abordaje: 'Abierto', otro_especificar: null },
    { ...procedure, id: 'other', categoria: 'Patología renal', procedimiento: 'Otros: Autotrasplante renal', abordaje: 'Abierto', otro_especificar: 'Autotrasplante renal' },
    { ...procedure, id: 'bladder-trauma', categoria: 'Cirugía de urgencia', procedimiento: 'Trauma vesical', abordaje: 'Abierto', otro_especificar: 'Cistorrafia + reimplante ureteral izq' },
    { ...procedure, id: 'renal-trauma', categoria: 'Cirugía de urgencia', procedimiento: 'Trauma renal', abordaje: 'Abierto', otro_especificar: 'Nefrorrafia' },
    { ...procedure, id: 'ureteral-trauma', categoria: 'Cirugía de urgencia', procedimiento: 'Trauma ureteral', abordaje: 'Abierto', otro_especificar: 'Anastomosis T-T' },
  ];
  const book = createProcedureWorkbook(cases, []);
  const rows = XLSX.utils.sheet_to_json(book.Sheets.UroFolium, { defval: null });
  const byId = new Map(rows.map(row => [row.id, row]));

  assert.equal(byId.get('cystectomy').procedimiento, 'Cistectomía radical + Bricker');
  assert.equal(byId.get('cystectomy').procedimiento_base, 'Cistectomía radical');
  assert.equal(byId.get('peyronie').procedimiento, 'Cirugía de Peyronie + Yachia');
  assert.equal(byId.get('peyronie-prosthesis').procedimiento, 'Cirugía de Peyronie tipo Yachia + Prótesis hidráulica');
  assert.equal(byId.get('penile-prosthesis').procedimiento, 'Prótesis de pene maleable');
  assert.equal(byId.get('biopsy').procedimiento, 'Biopsia testicular TESA');
  assert.equal(byId.get('fistula').procedimiento, 'Fístula vesico-vaginal + Latzko');
  assert.equal(byId.get('penectomy').procedimiento, 'Penectomía total');
  assert.equal(byId.get('other').procedimiento, 'Otros: Autotrasplante renal');
  assert.equal(byId.get('bladder-trauma').procedimiento, 'Trauma vesical: Cistorrafia + reimplante ureteral izq');
  assert.equal(byId.get('renal-trauma').procedimiento, 'Trauma renal: Nefrorrafia');
  assert.equal(byId.get('ureteral-trauma').procedimiento, 'Trauma ureteral: Anastomosis T-T');

  assert.deepEqual(importWorkbook(book).procedures, cases);
});

test('radical cystectomy import requires a urinary diversion', () => {
  const headers = ['fecha', 'categoria', 'procedimiento', 'abordaje', 'rol', 'otro_especificar'];
  const base = ['2026-07-01', 'Patología vesical', 'Cistectomía radical', 'Abierto', 'Observador'];
  const missing = parseProcedureWorkbook(workbook(headers, [[...base, null]]));
  assert.ok(missing.errors.some(error => error.includes('tipo_derivacion_urinaria')));
  const legacy = importWorkbook(workbook(headers, [[...base, 'Bricker']]));
  assert.equal(legacy.procedures[0].otro_especificar, 'Bricker');
});

test('partial updates preserve omitted optional fields and existing litiasis details', () => {
  const result = importWorkbook(workbook(
    ['id', 'fecha', 'categoria', 'procedimiento', 'abordaje', 'rol'],
    [[procedure.id, '2026-07-05', procedure.categoria, procedure.procedimiento, procedure.abordaje, procedure.rol]],
  ), [procedure], [stone]);
  assert.deepEqual(result.procedures, [{ ...procedure, fecha: '2026-07-05', updated_at: timestamp }]);
  assert.deepEqual(result.stoneDetails, []);
  assert.deepEqual(result.removeStoneIds, []);
});

test('explicitly absent stone details remove an existing stone record', () => {
  const result = importWorkbook(workbook(
    ['id', 'fecha', 'categoria', 'procedimiento', 'abordaje', 'rol', 'stone_detalles'],
    [[procedure.id, procedure.fecha, procedure.categoria, procedure.procedimiento, procedure.abordaje, procedure.rol, false]],
  ), [procedure], [stone]);
  assert.deepEqual(result.removeStoneIds, [procedure.id]);
});

test('Excel date cells and workbooks using the 1904 epoch preserve the calendar date', () => {
  const headers = ['fecha', 'categoria', 'procedimiento', 'abordaje', 'rol'];
  const row = [46204, 'Litiasis', 'RIRS', 'Endoscópico', 'Observador'];
  const book = workbook(headers, [row]);
  book.Sheets.Plantilla.A2.z = 'yyyy-mm-dd';
  assert.equal(importWorkbook(book).procedures[0].fecha, '2026-07-01');
  const book1904 = workbook(headers, [[44742, ...row.slice(1)]]);
  book1904.Workbook = { WBProps: { date1904: true } };
  assert.equal(importWorkbook(book1904).procedures[0].fecha, '2026-07-01');
});

test('CSV import preserves leading zeroes, zero duration and boolean litiasis values', () => {
  const csv = 'id,fecha,categoria,procedimiento,abordaje,rol,duracion,stone_detalles,stone_stonefree\n00001,2026-07-01,Litiasis,RIRS,Endoscópico,Observador,0,true,false\n';
  const parsed = readProcedureWorkbook(new TextEncoder().encode(csv).buffer);
  assert.deepEqual(parsed.errors, []);
  const result = materializeProcedureImport(parsed.rows, [], [], timestamp);
  assert.equal(result.procedures[0].id, '00001');
  assert.equal(result.procedures[0].duracion, 0);
  assert.equal(result.stoneDetails[0].stonefree, false);
});

test('invalid values, missing columns and duplicate identifiers are rejected', () => {
  const invalid = parseProcedureWorkbook(workbook(
    ['fecha', 'categoria', 'procedimiento', 'abordaje', 'rol', 'duracion', 'stone_detalles'],
    [['31/02/2026', 'Litiasis', 'RIRS', 'Endoscópico', 'Observador', '-1', 'tal vez']],
  ));
  assert.equal(invalid.errors.length, 3);
  assert.match(parseProcedureWorkbook(workbook(['fecha', 'procedimiento', 'abordaje', 'rol'], [])).errors[0], /categoria/);
  const headers = ['id', 'fecha', 'categoria', 'procedimiento', 'abordaje', 'rol'];
  const row = ['same-id', '2026-07-01', 'Litiasis', 'RIRS', 'Endoscópico', 'Observador'];
  assert.ok(parseProcedureWorkbook(workbook(headers, [row, row])).errors.some(error => error.includes('id duplicado')));
});
