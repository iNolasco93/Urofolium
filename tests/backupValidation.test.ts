import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBackupPayload } from '../src/backup/backupValidation';
import type { BackupPayload } from '../src/lib/types';

const options = { userId: 'user-a', maxBackupVersion: 3, maxSchemaVersion: 3 };
const timestamp = '2026-10-18T10:00:00.000Z';

function fixture(): BackupPayload {
  return {
    app: 'UroFolium', backupVersion: 3, createdAt: timestamp,
    user: { supabaseUserId: 'user-a', email: 'a@example.test' },
    device: { platform: 'web', appVersion: '1.0.0', label: 'Test' },
    schema: { version: 3 },
    data: {
      procedures: [{
        id: 'procedure-a', fecha: '2026-10-18',
        categoria: 'Litiasis', procedimiento: 'URS', abordaje: 'Endoscópico',
        duracion: 30, rol: 'Cirujano', cirujano_senior: null,
        primer_ayudante: null, segundo_ayudante: null, complicaciones: null,
        otro_especificar: null,
        created_at: timestamp, updated_at: timestamp, deleted_at: null,
      }],
      stoneDetails: [{
        procedure_id: 'procedure-a', lateralidad: 'Derecha',
        procedimiento_raw: { urs: true, rirs: false, nlpc: false },
        nefromax_fr: null, amplatz_fr: null, enhebrado: false, tamanio_mm: 7.5,
        tutor_interno: null, drenaje_nefrostomico: null, sonda_fr: null,
        etiqueta_drenaje: null, stonefree: true, created_at: timestamp, updated_at: timestamp,
      }],
    },
  };
}

test('accepts a complete backup and returns independent validated objects', () => {
  const input = fixture();
  const result = validateBackupPayload(input, options);
  assert.deepEqual(result, input);
  assert.notEqual(result.data.procedures[0], input.data.procedures[0]);
  assert.notEqual(result.data.stoneDetails![0].procedimiento_raw, input.data.stoneDetails![0].procedimiento_raw);
});

test('accepts a valid empty backup', () => {
  const input = fixture();
  input.data = { procedures: [], stoneDetails: [] };
  assert.deepEqual(validateBackupPayload(input, options).data, input.data);
});

test('normalizes the absent fields in a version-1 backup without changing its source', () => {
  const input = fixture();
  input.backupVersion = 1;
  input.schema.version = 1;
  delete input.data.stoneDetails;
  delete (input.data.procedures[0] as Partial<BackupPayload['data']['procedures'][number]>).primer_ayudante;
  const result = validateBackupPayload(input, options);
  assert.equal(result.data.procedures[0].primer_ayudante, null);
  assert.deepEqual(result.data.stoneDetails, []);
  assert.equal(input.data.procedures[0].primer_ayudante, undefined);
});

test('normalizes the absent assistant field in a version-2 backup', () => {
  const input = fixture();
  input.backupVersion = 2;
  input.schema.version = 2;
  delete (input.data.procedures[0] as Partial<BackupPayload['data']['procedures'][number]>).primer_ayudante;
  assert.equal(validateBackupPayload(input, options).data.procedures[0].primer_ayudante, null);
});

const invalidMutations: Array<[string, (value: any) => void, RegExp]> = [
  ['different user', value => { value.user.supabaseUserId = 'user-b'; }, /otro usuario/],
  ['wrong app', value => { value.app = 'Other'; }, /app/],
  ['newer backup format', value => { value.backupVersion = 4; }, /más reciente/],
  ['newer database schema', value => { value.schema.version = 4; }, /más reciente/],
  ['invalid backup version', value => { value.backupVersion = 0; }, /backupVersion/],
  ['fractional schema version', value => { value.schema.version = 1.5; }, /schema.version/],
  ['version supplied as string', value => { value.backupVersion = '3'; }, /backupVersion/],
  ['missing procedure collection', value => { delete value.data.procedures; }, /data.procedures/],
  ['missing modern stone collection', value => { delete value.data.stoneDetails; }, /data.stoneDetails/],
  ['duplicate procedure ids', value => { value.data.procedures.push({ ...value.data.procedures[0] }); }, /duplicados/],
  ['duplicate stone details', value => { value.data.stoneDetails.push({ ...value.data.stoneDetails[0] }); }, /duplicados/],
  ['orphan stone details', value => { value.data.stoneDetails[0].procedure_id = 'missing'; }, /inexistente/],
  ['blank identifier', value => { value.data.procedures[0].id = ' '; }, /\.id/],
  ['invalid calendar date', value => { value.data.procedures[0].fecha = '2026-02-30'; }, /fecha/],
  ['non-ISO timestamp', value => { value.createdAt = '18/10/2026'; }, /createdAt/],
  ['invalid timestamp date', value => { value.data.procedures[0].updated_at = '2026-02-30T10:00:00Z'; }, /updated_at/],
  ['non-finite number', value => { value.data.procedures[0].duracion = Infinity; }, /duracion/],
  ['number supplied as string', value => { value.data.stoneDetails[0].tamanio_mm = '7.5'; }, /tamanio_mm/],
  ['incorrect nullable boolean', value => { value.data.stoneDetails[0].stonefree = 'true'; }, /stonefree/],
  ['invalid nested stone flags', value => { value.data.stoneDetails[0].procedimiento_raw.urs = 'true'; }, /procedimiento_raw.urs/],
  ['missing nested stone flags', value => { delete value.data.stoneDetails[0].procedimiento_raw; }, /procedimiento_raw/],
  ['missing current assistant field', value => { delete value.data.procedures[0].primer_ayudante; }, /primer_ayudante/],
  ['wrong device metadata type', value => { value.device.label = {}; }, /device.label/],
  ['wrong user email type', value => { value.user.email = []; }, /user.email/],
];

for (const [name, mutate, expected] of invalidMutations) {
  test(`rejects ${name} before a replacement can be called`, () => {
    const input = fixture();
    mutate(input);
    let replaced = false;
    assert.throws(() => {
      validateBackupPayload(input, options);
      replaced = true;
    }, expected);
    assert.equal(replaced, false);
  });
}

for (const invalid of [null, [], 'backup', 4, { app: 'UroFolium' }]) {
  test(`rejects malformed root ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => validateBackupPayload(invalid, options), /Respaldo inválido/);
  });
}
