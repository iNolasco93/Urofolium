import assert from 'node:assert/strict';
import test from 'node:test';
import { getMigrationReviewCases, migrateProcedureCatalog } from '../src/lib/migrationReview';
import type { Procedure } from '../src/lib/types';

const BASE: Procedure = {
  id: 'case-1', fecha: '2026-07-01', nhc: null, categoria: 'Litiasis', procedimiento: 'RIRS',
  abordaje: 'Endoscópico', duracion: null, rol: 'Observador', cirujano_senior: 'Senior',
  primer_ayudante: null, segundo_ayudante: null, complicaciones: 'No', notas: null,
  seguimiento: false, otro_especificar: null, created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null,
};

test('current compatible records do not create migration review cases', () => {
  const procedures = [
    BASE,
    { ...BASE, id: 'cystectomy', categoria: 'Patología vesical', procedimiento: 'Cistectomía radical', abordaje: 'Robótico', otro_especificar: 'Bricker' },
    { ...BASE, id: 'biopsy', categoria: 'Patología testicular y escrotal', procedimiento: 'Biopsia testicular', abordaje: 'Percutáneo', otro_especificar: 'TESA' },
  ];
  assert.deepEqual(getMigrationReviewCases(procedures), []);
});

test('legacy categories, renamed procedures and fixed approaches migrate automatically', () => {
  const procedure = {
    ...BASE,
    categoria: 'Suelo pélvico / continencia',
    procedimiento: 'Colporrafia anterior',
    abordaje: 'Abierto',
  };
  const migrated = migrateProcedureCatalog(procedure, '2026-08-01T00:00:00.000Z');
  assert.equal(migrated.categoria, 'Patología uroginecológica');
  assert.equal(migrated.procedimiento, 'Reparación cistocele');
  assert.equal(migrated.abordaje, 'Vaginal');
  assert.deepEqual(getMigrationReviewCases([procedure]), []);
});

test('the four approved aliases, current categories and unequivocal approaches migrate together', () => {
  const cases = [
    { ...BASE, id: 'botox', categoria: 'Endourología', procedimiento: 'Botox', abordaje: 'Abierto' },
    { ...BASE, id: 'colporrhaphy', categoria: 'Suelo pélvico / continencia', procedimiento: 'Colporrafia anterior', abordaje: 'Abierto' },
    { ...BASE, id: 'sphincter', categoria: 'Suelo pélvico / continencia', procedimiento: 'Esfínter artificial', abordaje: 'Robótico' },
    { ...BASE, id: 'adenomectomy', categoria: 'Cirugía pélvica y prostática mayor', procedimiento: 'Adenomectomía suprapúbica', abordaje: 'Robótico' },
    { ...BASE, id: 'tot', categoria: 'Suelo pélvico / continencia', procedimiento: 'TOT', abordaje: 'Abierto' },
    { ...BASE, id: 'peyronie', categoria: 'Patología peneana', procedimiento: 'Peyronie', abordaje: 'Abierto' },
    { ...BASE, id: 'peyronie-prosthesis', categoria: 'Patología peneana', procedimiento: 'Peyronie + Prótesis', abordaje: 'Abierto' },
  ].map(item => migrateProcedureCatalog(item, '2026-08-01T00:00:00.000Z'));

  assert.deepEqual(cases.map(({ categoria, procedimiento, abordaje }) => ({ categoria, procedimiento, abordaje })), [
    { categoria: 'Patología uroginecológica', procedimiento: 'Botox intravesical', abordaje: 'Endoscópico' },
    { categoria: 'Patología uroginecológica', procedimiento: 'Reparación cistocele', abordaje: 'Vaginal' },
    { categoria: 'Patología uretral', procedimiento: 'Implante de esfínter artificial', abordaje: 'Abierto' },
    { categoria: 'Patología prostática', procedimiento: 'Adenomectomía', abordaje: 'Robótico' },
    { categoria: 'Patología uroginecológica', procedimiento: 'TOT', abordaje: 'Vaginal' },
    { categoria: 'Patología peneana', procedimiento: 'Cirugía de Peyronie', abordaje: 'Abierto' },
    { categoria: 'Patología peneana', procedimiento: 'Cirugía de Peyronie + Prótesis', abordaje: 'Abierto' },
  ]);
});

test('legacy transvaginal approaches migrate to vaginal', () => {
  const migrated = migrateProcedureCatalog({
    ...BASE,
    categoria: 'Patología uroginecológica',
    procedimiento: 'Fístula vesico-vaginal',
    abordaje: 'Transvaginal',
  });
  assert.equal(migrated.abordaje, 'Vaginal');
});

test('ambiguous Others and missing cystectomy diversion require manual correction', () => {
  const reviews = getMigrationReviewCases([
    { ...BASE, id: 'other', categoria: 'Genital masculina', procedimiento: 'Otros: Reconstrucción', abordaje: 'Abierto', otro_especificar: 'Reconstrucción' },
    { ...BASE, id: 'cystectomy', categoria: 'Cirugía pélvica y prostática mayor', procedimiento: 'Cistectomía radical', abordaje: 'Abierto' },
  ]);
  assert.equal(reviews[0].categoriaSugerida, '');
  assert.match(reviews[0].accionRequerida, /Seleccionar la categoría/);
  assert.ok(reviews[1].problemas.some(problem => problem.includes('derivación urinaria')));
});
