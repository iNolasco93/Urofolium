import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATEGORIAS, TODOS_ABORDAJES, PROCEDIMIENTOS_HBP, REGLAS_ABORDAJE,
  getAbordajeFijo, getAbordajesDisponibles, getProcedimientoOrquiectomia,
} from '../src/lib/categorias';
import {
  encodeProcedureDetails, getProcedureWorkbookFields, parseProcedureWorkbookFields,
} from '../src/lib/procedureDetails';

test('the expanded surgical catalog keeps the lithiasis choices unchanged', () => {
  assert.deepEqual(CATEGORIAS.Litiasis, [
    'NLPC', 'ECIRS', 'URS', 'RIRS',
    'Cistolitotricia', 'Cistolitotomía', 'Otros',
  ]);
  assert.deepEqual(TODOS_ABORDAJES, [
    'Abierto', 'Endoscópico', 'Percutáneo', 'Laparoscópico', 'Robótico',
  ]);
  assert.deepEqual(Object.keys(CATEGORIAS), [
    'Cirugía de urgencia', 'Litiasis', 'Derivaciones urinarias',
    'Patología prostática', 'Patología vesical', 'Patología renal',
    'Patología ureteral', 'Patología uretral', 'Patología peneana',
    'Patología testicular y escrotal', 'Patología uroginecológica',
    'Cirugía de trasplante', 'Patología linfática',
  ]);
  assert.deepEqual(REGLAS_ABORDAJE['Cirugía de urgencia'].Otros, [
    'Abierto', 'Laparoscópico', 'Robótico', 'Endoscópico',
  ]);
});

test('approach rules expose only the choices requested for each procedure', () => {
  assert.equal(getAbordajeFijo('Patología prostática', 'RTU prostática'), 'Endoscópico');
  assert.equal(getAbordajeFijo('Patología ureteral', 'Incisión endoscópica de ureterocele'), 'Endoscópico');
  assert.equal(getAbordajeFijo('Patología ureteral', 'Inyección endoscópica por RVU'), 'Endoscópico');
  assert.equal(getAbordajeFijo('Patología ureteral', 'Dilatación neumática de uréter'), 'Endoscópico');
  assert.equal(
    CATEGORIAS['Patología ureteral'].indexOf('Dilatación neumática de uréter'),
    CATEGORIAS['Patología ureteral'].indexOf('Reimplante ureteral') + 1,
  );
  assert.deepEqual(getAbordajesDisponibles('Patología renal', 'Nefrectomía radical'), [
    'Abierto', 'Laparoscópico', 'Robótico', 'Retroperitoneal',
  ]);
  assert.deepEqual(getAbordajesDisponibles('Patología uroginecológica', 'Fístula vesico-vaginal'), [
    'Abierto', 'Laparoscópico', 'Robótico', 'Vaginal',
  ]);
  for (const category of [
    'Patología renal', 'Patología ureteral', 'Patología peneana',
    'Patología testicular y escrotal', 'Cirugía de trasplante', 'Patología linfática',
  ]) {
    assert.equal(getAbordajesDisponibles(category, 'Otros').includes('Vaginal'), false);
    assert.equal(getAbordajesDisponibles(category, 'Otros').includes('Transvaginal'), false);
  }
  assert.equal(getAbordajesDisponibles('Patología uroginecológica', 'Otros').includes('Vaginal'), true);
  assert.equal(getAbordajesDisponibles('Patología uroginecológica', 'Otros').includes('Transvaginal'), false);
  assert.deepEqual(getAbordajesDisponibles('Patología testicular y escrotal', 'Vasovasostomía'), [
    'Abierto', 'Microcirugía',
  ]);
});

test('prostatic pathology groups the requested BPH procedures with their approaches', () => {
  assert.deepEqual(PROCEDIMIENTOS_HBP, [
    'RTU prostática', 'HoLEP/ThuLEP', 'Láser verde', 'Adenomectomía',
    'Aquabeam', 'Rezum', 'Urolift', 'Optilume',
  ]);
  for (const procedure of ['RTU prostática', 'HoLEP/ThuLEP', 'Láser verde', 'Aquabeam', 'Rezum', 'Urolift', 'Optilume']) {
    assert.equal(getAbordajeFijo('Patología prostática', procedure), 'Endoscópico');
  }
  assert.deepEqual(getAbordajesDisponibles('Patología prostática', 'Adenomectomía'), [
    'Abierto', 'Laparoscópico', 'Robótico',
  ]);
  assert.deepEqual(getAbordajesDisponibles('Patología prostática', 'Prostatectomía radical'), [
    'Abierto', 'Laparoscópico', 'Robótico',
  ]);
  assert.deepEqual(getAbordajesDisponibles('Patología prostática', 'Otros'), [
    'Abierto', 'Endoscópico', 'Percutáneo', 'Laparoscópico', 'Robótico',
  ]);
  assert.equal(getAbordajeFijo('Patología prostática', 'HoLEP'), 'Endoscópico');
  assert.equal(getAbordajeFijo('Patología prostática', 'ThuLEP'), 'Endoscópico');
});

test('testicular pathology keeps orquiectomy as a configurable procedure', () => {
  assert.equal(CATEGORIAS['Patología testicular y escrotal'].includes('Orquiectomía'), true);
  assert.equal(getAbordajeFijo('Patología testicular y escrotal', 'Orquiectomía'), 'Abierto');
  for (const storedProcedure of [
    'Orquiectomía simple', 'Orquiectomía inguinal',
    'Orquiectomía simple con prótesis', 'Orquiectomía inguinal con prótesis',
  ]) {
    assert.equal(getAbordajeFijo('Patología testicular y escrotal', storedProcedure), 'Abierto');
  }
  assert.equal(getProcedimientoOrquiectomia(false, false), 'Orquiectomía simple');
  assert.equal(getProcedimientoOrquiectomia(true, false), 'Orquiectomía inguinal');
  assert.equal(getProcedimientoOrquiectomia(false, true), 'Orquiectomía simple con prótesis');
  assert.equal(getProcedimientoOrquiectomia(true, true), 'Orquiectomía inguinal con prótesis');
});

test('biopsy technique determines whether its approach is open or percutaneous', () => {
  assert.deepEqual(getAbordajesDisponibles('Patología testicular y escrotal', 'Biopsia testicular'), [
    'Abierto', 'Percutáneo',
  ]);
});

test('structured procedure details produce the requested final export names', () => {
  assert.equal(
    getProcedureWorkbookFields('Cistectomía radical', 'Bricker').procedimientoFinal,
    'Cistectomía radical + Bricker',
  );
  assert.equal(
    getProcedureWorkbookFields('Cirugía de Peyronie', 'Yachia').procedimientoFinal,
    'Cirugía de Peyronie + Yachia',
  );
  const combined = encodeProcedureDetails('Cirugía de Peyronie + Prótesis', {
    tecnica: 'Yachia', tipoProtesis: 'hidráulica',
  });
  assert.equal(
    getProcedureWorkbookFields('Cirugía de Peyronie + Prótesis', combined).procedimientoFinal,
    'Cirugía de Peyronie tipo Yachia + Prótesis hidráulica',
  );
  assert.equal(
    getProcedureWorkbookFields('Fístula vesico-vaginal', 'Latzko').procedimientoFinal,
    'Fístula vesico-vaginal + Latzko',
  );
  assert.equal(
    getProcedureWorkbookFields('Biopsia testicular', 'TESA').procedimientoFinal,
    'Biopsia testicular TESA',
  );
  assert.equal(
    getProcedureWorkbookFields('Trauma vesical', 'Cistorrafia + reimplante ureteral izq').procedimientoFinal,
    'Trauma vesical: Cistorrafia + reimplante ureteral izq',
  );
  assert.equal(
    getProcedureWorkbookFields('Trauma renal', 'Nefrorrafia').procedimientoFinal,
    'Trauma renal: Nefrorrafia',
  );
  assert.equal(
    getProcedureWorkbookFields('Trauma ureteral', 'Anastomosis T-T').procedimientoFinal,
    'Trauma ureteral: Anastomosis T-T',
  );
  assert.equal(getProcedureWorkbookFields('Cirugía de Peyronie', null).procedimientoFinal, 'Cirugía de Peyronie');
  assert.equal(getProcedureWorkbookFields('Fístula vesico-vaginal', null).procedimientoFinal, 'Fístula vesico-vaginal');
});

test('final procedure names can be imported without splitting meaningful plus signs incorrectly', () => {
  const combined = parseProcedureWorkbookFields(
    'Cirugía de Peyronie tipo Yachia + Prótesis hidráulica', '', '', '', '',
  );
  assert.equal(combined.procedimiento, 'Cirugía de Peyronie + Prótesis');
  assert.deepEqual(
    getProcedureWorkbookFields(combined.procedimiento, combined.storedDetail),
    {
      procedimientoBase: 'Cirugía de Peyronie + Prótesis',
      procedimientoFinal: 'Cirugía de Peyronie tipo Yachia + Prótesis hidráulica',
      tipoDerivacionUrinaria: '',
      tecnica: 'Yachia',
      tipoProtesis: 'hidráulica',
    },
  );
});

test('trauma final names can be imported with their free-text description', () => {
  const parsed = parseProcedureWorkbookFields(
    'Trauma ureteral: Reimplante ureteral derecho', '', '', '', '',
  );
  assert.deepEqual(parsed, {
    procedimiento: 'Trauma ureteral',
    storedDetail: 'Reimplante ureteral derecho',
  });
});
