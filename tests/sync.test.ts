import assert from 'node:assert/strict';
import test from 'node:test';
import { Device, Server, cases, surgery, stone, time, KEY } from './helpers/syncHarness';
import { decryptSnapshot, encryptSnapshot } from '../src/sync/syncCrypto';
import { casesFromLocal, parseBaseline, validateCases, type CaseData } from '../src/sync/syncModel';
import { describeCase } from '../src/sync/syncPresentation';

// The same suite is run against both applications' shipping engine.
test('a new device needs the original key and imports a complete encrypted surgery', async () => {
  const server = new Server();
  const a = new Device(server, { cases: cases() });
  await a.engine.sync();
  assert.equal(a.status.phase, 'ready');
  assert.equal(JSON.stringify(server.accounts.get('account-a')).includes('RIRS'), false);
  const b = new Device(server);
  await b.engine.sync();
  assert.equal(b.status.phase, 'needs-key');
  await assert.rejects(b.engine.pair('a-different-secret'), /clave/i);
  assert.equal(b.key, null);
  await b.engine.pair(a.key!);
  assert.equal(b.status.phase, 'ready');
  assert.deepEqual(b.data.cases, cases());
});

test('independent offline creations merge by ID and offline errors preserve the local case', async () => {
  const server = new Server();
  const a = new Device(server, { cases: cases('a') });
  const b = new Device(server, { cases: cases('b') });
  server.offline = true;
  await a.engine.sync();
  assert.equal(a.status.phase, 'error'); assert.deepEqual(a.data.cases, cases('a'));
  server.offline = false;
  await a.engine.sync(); await b.engine.pair(a.key!); await a.engine.sync();
  assert.deepEqual(Object.keys(a.data.cases).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(b.data.cases).sort(), ['a', 'b']);
});

test('concurrent surgery and lithiasis edits require choosing one complete case', async () => {
  const server = new Server();
  const a = new Device(server, { cases: cases() }); const b = new Device(server);
  await a.engine.sync(); await b.engine.pair(a.key!);
  const left = { procedure: { ...surgery(), duracion: 90 }, stone: { ...stone(), lateralidad: 'Izquierda', tamanio_mm: 18, stonefree: false } };
  const right = { procedure: { ...surgery(), duracion: 40 }, stone: { ...stone(), tamanio_mm: 8 } };
  a.edit({ cases: { 'case-1': left } }); b.edit({ cases: { 'case-1': right } });
  await a.engine.sync(); await b.engine.sync();
  assert.equal(b.status.phase, 'conflict'); assert.deepEqual(b.data.cases['case-1'], right);
  assert.deepEqual(b.status.conflicts[0].remote, left);
  assert.ok(describeCase(left).some(([label, value]) => label === 'Stone-free' && value === 'No'));
  await b.engine.resolve('cases', 'case-1', 'remote');
  assert.deepEqual(b.data.cases['case-1'], left);
});

test('deletions propagate, older omissions never delete cases, and cleared stone details stay cleared', async () => {
  const server = new Server();
  const a = new Device(server, { cases: cases() }); const b = new Device(server);
  await a.engine.sync(); await b.engine.pair(a.key!);
  a.edit({ cases: { 'case-1': { procedure: surgery(), stone: null } } });
  await a.engine.sync(); await b.engine.sync();
  assert.equal((b.data.cases['case-1'] as CaseData).stone, null);
  b.edit({ cases: { 'case-1': { procedure: { ...surgery(), deleted_at: time }, stone: null } } });
  await b.engine.sync(); await a.engine.sync();
  assert.equal((a.data.cases['case-1'] as CaseData).procedure.deleted_at, time);
  a.edit({ cases: {} }); await a.engine.sync();
  assert.equal((a.data.cases['case-1'] as CaseData).procedure.deleted_at, time);
});

test('an edit while a request is in flight cannot be replaced by the old snapshot', async () => {
  const server = new Server(); const a = new Device(server, { cases: cases() });
  await a.engine.sync();
  const edited = { procedure: { ...surgery(), duracion: 95 }, stone: { ...stone(), tamanio_mm: 17 } };
  server.beforeCommit = () => a.edit({ cases: { 'case-1': edited } });
  await a.engine.sync();
  assert.deepEqual(a.data.cases['case-1'], edited);
  assert.equal(a.status.phase, 'ready');
});

test('a compare-and-swap collision rereads and preserves the other device creation', async () => {
  const server = new Server(); const a = new Device(server, { cases: cases() }); const b = new Device(server);
  await a.engine.sync(); await b.engine.pair(a.key!);
  a.edit({ cases: { ...cases(), ...cases('a') } }); b.edit({ cases: { ...cases(), ...cases('b') } });
  server.beforeCommit = async () => { await b.engine.sync(); };
  await a.engine.sync();
  assert.equal(a.status.phase, 'ready');
  assert.deepEqual(Object.keys(a.data.cases).sort(), ['a', 'b', 'case-1']);
});

test('local write failure does not advance the baseline and retry recovers the remote commit', async () => {
  const server = new Server(); const a = new Device(server, { cases: cases() });
  a.failApply = true; await a.engine.sync();
  assert.equal(a.status.phase, 'error'); assert.equal(a.baseline, null); assert.deepEqual(a.data.cases, cases());
  a.failApply = false; await a.engine.sync();
  assert.equal(a.status.phase, 'ready'); assert.equal(a.baseline?.channels.cases.revision, 1);
});

test('account, channel and revision are authenticated; corruption and unknown fields are rejected', async () => {
  const envelope = await encryptSnapshot(cases(), KEY, 'a', 'cases', 1);
  assert.deepEqual(await decryptSnapshot(envelope, KEY, 'a', 'cases', 1), cases());
  for (const [user, channel, rev] of [['b', 'cases', 1], ['a', 'different', 1], ['a', 'cases', 2]] as const) {
    await assert.rejects(decryptSnapshot(envelope, KEY, user, channel, rev), /clave/i);
  }
  await assert.rejects(decryptSnapshot({ ...envelope, iv: '' }, KEY, 'a', 'cases', 1), /válida/);
  assert.throws(() => validateCases({ x: { procedure: { ...surgery('x'), unexpected: 'must not travel' }, stone: null } }));
  assert.throws(() => validateCases({ x: { procedure: surgery('x'), stone: stone('other') } }));
  assert.throws(() => parseBaseline('{"version":999}'));
});

test('stopping a session prevents applying or publishing its suspended request', async () => {
  const server = new Server(); const a = new Device(server, { cases: cases() });
  let resume!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; });
  let entered!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  server.beforeCommit = async () => { entered(); await held; };
  const run = a.engine.sync(); await entering;
  a.engine.stop(); a.session++; const status = a.status;
  resume(); await run;
  assert.equal(a.baseline, null); assert.equal(a.status, status);
});

test('a remote rollback is blocked instead of silently replacing current data', async () => {
  const server = new Server(); const a = new Device(server, { cases: cases() });
  await a.engine.sync(); const old = structuredClone(server.accounts.get('account-a'))!;
  a.edit({ cases: cases('new') }); await a.engine.sync();
  server.accounts.set('account-a', old); await a.engine.sync();
  assert.equal(a.status.phase, 'error'); assert.ok(a.data.cases.new);
});
