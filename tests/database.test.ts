import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness, PASSPHRASE, procedure, seedLegacyNative, seedLegacyWeb, stone } from './helpers/databaseHarness.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';

test('web database isolates accounts, encrypts records and secrets, and preserves them after locking', async () => {
  const { api, storage } = await createHarness();
  await api.initDatabase('account-a', PASSPHRASE);
  await api.replaceDatabaseContents([procedure()], [stone()]);
  await api.setLocalSecret('backup_passphrase', 'synthetic-secret-backup-passphrase');
  const raw = [...storage.values.values()].join('');
  for (const secret of [procedure().id, procedure().procedimiento, PASSPHRASE, 'synthetic-secret-backup-passphrase']) {
    assert.equal(raw.includes(secret), false);
  }
  api.lockDatabase();
  assert.throws(() => api.readWebProcedures(), /bloqueados/);
  await api.initDatabase('account-b', PASSPHRASE);
  assert.equal(api.readWebProcedures().length, 0);
  assert.equal(await api.getLocalSecret('backup_passphrase'), null);
  await api.initDatabase('account-a', PASSPHRASE);
  assert.equal(api.readWebProcedures()[0].id, procedure().id);
  assert.equal(api.readWebStoneDetails()[0].procedure_id, procedure().id);
  assert.equal(await api.getLocalSecret('backup_passphrase'), 'synthetic-secret-backup-passphrase');
});

test('web replacement is all-or-nothing on a storage quota failure', async () => {
  const { api, storage } = await createHarness();
  await api.initDatabase('account-a', PASSPHRASE);
  await api.replaceDatabaseContents([procedure()], [stone()]);
  const persisted = [...storage.values.entries()];
  storage.failWrites = true;
  await assert.rejects(api.replaceDatabaseContents([procedure('replacement')], []), /quota/);
  assert.deepEqual([...storage.values.entries()], persisted);
  assert.equal(api.readWebProcedures()[0].id, procedure().id);
  assert.equal(api.readWebStoneDetails().length, 1);
});

test('a lock cancels pending web replacement before storage changes', async () => {
  const { api, storage } = await createHarness();
  await api.initDatabase('account-a', PASSPHRASE);
  await api.replaceDatabaseContents([procedure()], [stone()]);
  const persisted = [...storage.values.entries()];
  const replacement = api.replaceDatabaseContents([procedure('replacement')], []);
  api.lockDatabase();
  await assert.rejects(replacement, /sesión local ha cambiado/);
  assert.deepEqual([...storage.values.entries()], persisted);
});

test('legacy web migration preserves procedures, details and backup key and removes plaintext only after encryption', async () => {
  const harness = await createHarness();
  seedLegacyWeb(harness);
  await harness.api.initDatabase('account-a', PASSPHRASE, true);
  assert.equal(harness.api.readWebProcedures()[0].id, procedure().id);
  assert.equal(harness.api.readWebStoneDetails()[0].procedure_id, procedure().id);
  assert.equal(harness.api.getWebMeta('device_label'), 'Synthetic legacy device');
  assert.equal(await harness.api.getLocalSecret('backup_passphrase'), 'synthetic-backup-passphrase');
  assert.equal(harness.storage.getItem('urofolium_web_procedures'), null);
  assert.equal(harness.storage.getItem('urofolium_web_stone_details'), null);
  assert.equal(harness.preferences.values.has('urofolium_backup_passphrase'), false);
  assert.equal(harness.storage.getItem('urofolium_legacy_owner'), 'account-a');
  assert.equal((await harness.api.inspectLocalData('account-b')).legacyAvailable, false);
});

test('a failed encrypted migration commit retains every plaintext source and legacy secret', async () => {
  const harness = await createHarness();
  seedLegacyWeb(harness);
  let vaultWrites = 0;
  harness.storage.beforeSet = key => {
    if (key.endsWith('_vault') && ++vaultWrites === 2) throw new Error('Synthetic migration quota failure');
  };
  await assert.rejects(harness.api.initDatabase('account-a', PASSPHRASE, true), /quota/);
  assert.ok(harness.storage.getItem('urofolium_web_procedures'));
  assert.ok(harness.storage.getItem('urofolium_web_stone_details'));
  assert.ok(harness.storage.getItem('urofolium_web_meta'));
  assert.equal(harness.preferences.values.get('urofolium_backup_passphrase'), 'synthetic-backup-passphrase');
  assert.equal(harness.storage.getItem('urofolium_legacy_owner'), null);
});

test('invalid legacy records cannot delete or partially import the plaintext data', async () => {
  const harness = await createHarness();
  seedLegacyWeb(harness);
  harness.storage.setItem('urofolium_web_procedures', JSON.stringify([{ ...procedure(), fecha: 'bad-date' }]));
  const original = harness.storage.getItem('urofolium_web_procedures');
  await assert.rejects(harness.api.initDatabase('account-a', PASSPHRASE, true), /fecha/);
  assert.equal(harness.storage.getItem('urofolium_web_procedures'), original);
  assert.ok(harness.storage.getItem('urofolium_web_stone_details'));
  await harness.api.initDatabase('account-a', PASSPHRASE);
  assert.equal(harness.api.readWebProcedures().length, 0);
});

test('migration refuses a legacy claim made by another account while awaiting the legacy key', async () => {
  const harness = await createHarness();
  seedLegacyWeb(harness);
  harness.preferences.beforeGet = key => {
    if (key === 'urofolium_backup_passphrase') harness.storage.setItem('urofolium_legacy_owner', 'account-b');
  };
  await assert.rejects(harness.api.initDatabase('account-a', PASSPHRASE, true), /otra cuenta|asignados|cambi/);
  assert.ok(harness.storage.getItem('urofolium_web_procedures'));
  assert.equal(harness.storage.getItem('urofolium_legacy_owner'), 'account-b');
  await harness.api.initDatabase('account-a', PASSPHRASE);
  assert.equal(harness.api.readWebProcedures().length, 0);
});

test('concurrent tabs cannot migrate the same legacy records into two accounts', async () => {
  const first = await createHarness();
  seedLegacyWeb(first);
  const second = await createHarness('web', first.storage, first.locks);
  const results = await Promise.allSettled([
    first.api.initDatabase('account-a', PASSPHRASE, true),
    second.api.initDatabase('account-b', PASSPHRASE, true),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = first.storage.getItem('urofolium_legacy_owner');
  assert.ok(winner === 'account-a' || winner === 'account-b');
  const loser = winner === 'account-a' ? second : first;
  const loserId = winner === 'account-a' ? 'account-b' : 'account-a';
  await loser.api.initDatabase(loserId, PASSPHRASE);
  assert.equal(loser.api.readWebProcedures().length, 0);
});

test('native opens account-scoped encrypted connections and stores secrets separately per account', async () => {
  const { api, sqlite } = await createHarness('ios');
  await api.initDatabase('account-a');
  await api.replaceDatabaseContents([procedure()], [stone()]);
  await api.setLocalSecret('backup_passphrase', 'synthetic-native-secret');
  assert.match(sqlite.secret!, /^[a-f0-9]{64}$/);
  assert.equal(sqlite.creationArguments[0].encrypted, true);
  assert.equal(sqlite.creationArguments[0].mode, 'secret');
  await api.initDatabase('account-b');
  assert.equal((await api.getDB().query('SELECT * FROM procedures')).values?.length, 0);
  assert.equal(await api.getLocalSecret('backup_passphrase'), null);
  await api.initDatabase('account-a');
  assert.equal((await api.getDB().query('SELECT * FROM procedures')).values?.length, 1);
  assert.equal(await api.getLocalSecret('backup_passphrase'), 'synthetic-native-secret');
});

test('native SQL replacement rolls back deletion and partial insertion when an insertion fails', async () => {
  const { api, sqlite } = await createHarness('ios');
  await api.initDatabase('account-a');
  await api.replaceDatabaseContents([procedure()], [stone()]);
  await assert.rejects(api.replaceDatabaseContents([procedure('new-valid'), { ...procedure('new-invalid'), categoria: null } as never], []), /NOT NULL/);
  const rows = (await api.getDB().query('SELECT id FROM procedures')).values!;
  assert.deepEqual(rows.map(row => row.id), [procedure().id]);
  assert.equal((await api.getDB().query('SELECT * FROM stone_details')).values!.length, 1);
  assert.ok(sqlite.transactionFlags.every(Boolean));
});

test('native legacy migration preserves rows and backup key before removing the old database', async () => {
  const harness = await createHarness('ios');
  await seedLegacyNative(harness);
  await harness.api.initDatabase('account-a', '', true);
  assert.equal((await harness.api.getDB().query('SELECT * FROM procedures')).values!.length, 1);
  assert.equal((await harness.api.getDB().query('SELECT * FROM stone_details')).values!.length, 1);
  assert.equal(await harness.api.getLocalSecret('backup_passphrase'), 'synthetic-legacy-native-key');
  assert.equal(harness.sqlite.databases.has('urofolium'), false);
  assert.equal(harness.preferences.values.has('urofolium_backup_passphrase'), false);
  assert.equal(harness.preferences.values.get('urofolium_legacy_owner'), 'account-a');
});

test('failed native migration rolls back its inserts and retains the old database and key', async () => {
  const harness = await createHarness('ios');
  await seedLegacyNative(harness);
  harness.sqlite.failNextTransaction = true;
  await assert.rejects(harness.api.initDatabase('account-a', '', true), /transaction failure/);
  assert.equal(harness.sqlite.databases.has('urofolium'), true);
  assert.equal(harness.preferences.values.get('urofolium_backup_passphrase'), 'synthetic-legacy-native-key');
  assert.equal(harness.preferences.values.has('urofolium_legacy_owner'), false);
  await harness.api.initDatabase('account-a');
  assert.equal((await harness.api.getDB().query('SELECT * FROM procedures')).values!.length, 0);
});

test('native migration preserves an existing account backup key when importing older records', async () => {
  const harness = await createHarness('ios');
  await harness.api.initDatabase('account-a');
  await harness.api.setLocalSecret('backup_passphrase', 'synthetic-current-account-key');
  harness.api.lockDatabase();
  await seedLegacyNative(harness);
  await harness.api.initDatabase('account-a', '', true);
  assert.equal(await harness.api.getLocalSecret('backup_passphrase'), 'synthetic-current-account-key');
});

test('cancelling native connection creation closes it and allows reopening the same account', async () => {
  const { api, sqlite } = await createHarness('ios');
  let created!: () => void;
  let release!: () => void;
  const createdSignal = new Promise<void>(resolve => { created = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  sqlite.afterCreate = async () => { created(); await pending; };
  const opening = api.initDatabase('account-a');
  await createdSignal;
  api.lockDatabase();
  release();
  await assert.rejects(opening, /cancel|cambi/);
  sqlite.afterCreate = undefined;
  await api.initDatabase('account-a');
  assert.equal(api.getDatabaseOwner(), 'account-a');
  assert.equal(sqlite.connections.size, 1);
});


test('native partial updates preserve unrelated fields', async () => {
  const { api } = await createHarness('ios');
  await api.initDatabase('account-a');
  const original = procedure();
  await api.replaceDatabaseContents([original], []);
  await api.updateProcedure(original.id, { duracion: 45 });
  const updated = await api.getProcedureById(original.id);
  assert.ok(updated);
  assert.deepEqual({ ...updated, updated_at: original.updated_at }, { ...original, duracion: 45 });
});

test('concurrent web creates preserve both records instead of overwriting a stale array', async () => {
  const { api } = await createHarness();
  await api.initDatabase('account-a', PASSPHRASE);
  const { id, created_at, updated_at, deleted_at, ...draft } = procedure();
  const results = await Promise.all([api.createProcedure(draft), api.createProcedure({ ...draft, procedimiento: 'RIRS' })]);
  const saved = await api.getAllProcedures();
  assert.equal(saved.length, 2);
  assert.deepEqual(new Set(saved.map(item => item.id)), new Set(results.map(item => item.id)));
});

for (const platform of ['web', 'ios'] as const) {
  test(`${platform}: remote case, stone and merge baseline commit together and roll back together`, async () => {
    const { api, storage, sqlite } = await createHarness(platform);
    await api.initDatabase('account-a', PASSPHRASE);
    await api.replaceDatabaseContents([procedure()], [stone()]);
    const readMeta = async () => platform === 'web' ? api.getWebMeta('sync_baseline') :
      (await api.getDB().query("SELECT value FROM app_meta WHERE key = 'sync_baseline'")).values?.[0]?.value ?? null;
    const apply = (baseline: string) => api.applySyncState('account-a', api.getDatabaseSession(), api.getDataStamp(), [procedure('remote')], [stone('remote')], baseline);
    assert.equal(await apply('baseline-1'), true);
    assert.equal(await readMeta(), 'baseline-1');
    if (platform === 'web') storage.failWrites = true; else sqlite.failNextTransaction = true;
    await assert.rejects(apply('baseline-2'), /quota|transaction failure/);
    assert.equal(await readMeta(), 'baseline-1');
    assert.equal((await api.getAllStoredProcedures())[0].id, 'remote');
    storage.failWrites = false;
    assert.equal(await apply('baseline-2'), true);
    assert.equal(await readMeta(), 'baseline-2');
  });

  test(`${platform}: a stale remote snapshot cannot replace a newer local change`, async () => {
    const { api } = await createHarness(platform);
    await api.initDatabase('account-a', PASSPHRASE);
    await api.replaceDatabaseContents([procedure()], [stone()]);
    const stamp = api.getDataStamp();
    await api.updateProcedure(procedure().id, { duracion: 120 });
    assert.equal(await api.applySyncState('account-a', api.getDatabaseSession(), stamp, [], [], 'stale'), false);
    assert.equal((await api.getAllProcedures())[0].duracion, 120);
    await assert.rejects(api.mergeDatabaseContents([procedure()], [], [], stamp), /cambia/);
    await api.deleteProcedure(procedure().id);
    assert.equal((await api.getAllProcedures()).length, 0);
    assert.ok((await api.getAllStoredProcedures())[0].deleted_at);
  });
}


test('an existing version-3 native account migrates its records and preserves notes', async () => {
  const { api, sqlite } = await createHarness('ios');
  const name = 'urofolium_account_' + Buffer.from('account-a').toString('hex');
  const connection = await sqlite.createConnection(name, true, 'secret');
  for (const migration of MIGRATIONS.filter(item => item.version <= 3)) await connection.execute(migration.sql);
  await connection.run("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)", ['schema_version', '3']);
  const original = procedure();
  const columns = Object.keys(original).filter(key => !['estado', 'nota_conocida', 'notas_revisadas', 'notas', 'via_acceso'].includes(key));
  const values = columns.map(key => original[key as keyof typeof original]).map(value => typeof value === 'boolean' ? Number(value) : value);
  await connection.run(`INSERT INTO procedures (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
  await sqlite.closeConnection(name);
  sqlite.failNextMigration = true;
  await assert.rejects(api.initDatabase('account-a'), /migration failure/);
  const previous = sqlite.databases.get(name)!;
  assert.equal(previous.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get()?.value, '3');
  assert.equal(previous.prepare('PRAGMA table_info(procedures)').all().some(row => row.name === 'estado'), false);
  await api.initDatabase('account-a');
  const saved = await api.getProcedureById(original.id);
  assert.equal(saved?.estado, 'realizada');
  assert.equal(saved?.notas, original.notas ?? null);
  assert.equal(saved?.nota_conocida, false);
});


for (const platform of ['web', 'ios'] as const) {
  test(`${platform}: renaming a personal procedure commits history and catalogue atomically`, async () => {
    const { api, storage, sqlite } = await createHarness(platform);
    await api.initDatabase('account-a', PASSPHRASE);
    const now = '2026-10-18T10:00:00.000Z';
    const personal = { id: 'custom', categoria: 'Litiasis', nombre: 'Técnica antigua', abordajes: ['Percutáneo'], formulario: 'percutaneo' as const, createdAt: now, updatedAt: now, archivedAt: null };
    await api.replaceDatabaseContents([{ ...procedure(), categoria: 'Litiasis', procedimiento: personal.nombre }], [stone()], [personal]);
    await api.renamePersonalProcedure({ ...personal, nombre: 'Técnica nueva' }, personal, true);
    const catalog = await api.readPersonalProcedures();
    assert.equal(catalog.find((item: any) => item.id === 'custom').archivedAt !== null, true);
    assert.equal((await api.getAllProcedures())[0].procedimiento, 'Técnica nueva');
    if (platform === 'web') assert.equal(api.readWebStoneDetails()[0].procedure_id, procedure().id);
    const active = catalog.find((item: any) => !item.archivedAt);
    if (platform === 'web') storage.failWrites = true; else sqlite.failNextTransaction = true;
    await assert.rejects(api.renamePersonalProcedure({ ...active, nombre: 'Fallo deliberado' }, active, true), /quota|transaction failure/);
    assert.equal((await api.getAllProcedures())[0].procedimiento, 'Técnica nueva');
    assert.equal((await api.readPersonalProcedures()).find((item: any) => !item.archivedAt).nombre, 'Técnica nueva');
  });
}

test('eliminar y volver a añadir un procedimiento conserva las cirugías y su configuración', async () => {
  const { api } = await createHarness();
  await api.initDatabase('account-a', PASSPHRASE);
  const now = '2026-10-18T10:00:00.000Z';
  const item = { id: 'custom-remove', categoria: 'Litiasis', nombre: 'Técnica personal', abordajes: ['Percutáneo'], formulario: 'percutaneo' as const, createdAt: now, updatedAt: now, archivedAt: null };
  await api.replaceDatabaseContents([{ ...procedure(), categoria: 'Litiasis', procedimiento: item.nombre }], [stone()], [item]);
  await api.putPersonalProcedure({ ...item, archivedAt: now });
  assert.equal((await api.getAllProcedures())[0].procedimiento, item.nombre);
  await assert.rejects(api.putPersonalProcedure({ ...item, id: 'new-id', formulario: 'sencillo' }), /cirugías registradas/);
  await api.putPersonalProcedure({ ...item, id: 'new-id' });
  const catalog = await api.readPersonalProcedures();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, item.id);
  assert.equal(catalog[0].archivedAt, null);
  assert.equal((await api.getAllProcedures())[0].procedimiento, item.nombre);
  assert.equal(api.readWebStoneDetails()[0].procedure_id, procedure().id);
});


test('native migration retains a legacy retroperitoneal route without assuming laparoscopy', async () => {
  const { api, sqlite } = await createHarness('ios');
  const name = 'urofolium_account_' + Buffer.from('account-a').toString('hex');
  const connection = await sqlite.createConnection(name, true, 'secret');
  for (const migration of MIGRATIONS.filter(item => item.version <= 4)) await connection.execute(migration.sql);
  await connection.run('INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)', ['schema_version', '4']);
  const original = { ...procedure(), categoria: 'Patología renal', procedimiento: 'Nefrectomía radical', abordaje: 'Retroperitoneal' };
  const columns = Object.keys(original).filter(key => key !== 'via_acceso');
  const values = columns.map(key => original[key as keyof typeof original]).map(value => typeof value === 'boolean' ? Number(value) : value);
  await connection.run(`INSERT INTO procedures (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
  await sqlite.closeConnection(name);
  await api.initDatabase('account-a');
  const saved = await api.getProcedureById(original.id);
  assert.equal(saved?.abordaje, 'Retroperitoneal');
  assert.equal(saved?.via_acceso, 'Retroperitoneal');
});
