import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness, PASSPHRASE, procedure, seedLegacyNative, seedLegacyWeb, stone } from './helpers/databaseHarness.ts';

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
