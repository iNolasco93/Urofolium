import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { EncryptedVault, type VaultStorage } from '../src/db/encryptedVault';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const PASSPHRASE = 'una contraseña local larga';
const STORAGE_KEY = 'urofolium:account-1:vault';
const CONTEXT = 'urofolium:account-1';

interface State {
  procedures: { id: string; note: string }[];
  meta: { count: number };
}

function initialState(): State {
  return { procedures: [{ id: 'private-record-1', note: 'dato confidencial único' }], meta: { count: 0 } };
}

class MemoryStorage implements VaultStorage {
  values = new Map<string, string>();
  writes = 0;
  failWrites = false;

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('Storage quota exceeded');
    this.writes += 1;
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

test('persists only ciphertext, reopens it, and never exposes mutable internal state', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  assert.equal(vault.exists(), false);
  assert.throws(() => vault.read(), { code: 'LOCKED' });
  await assert.rejects(vault.update(() => undefined), { code: 'LOCKED' });
  const source = initialState();
  const creation = vault.create(PASSPHRASE, source);
  source.procedures[0].note = 'mutation after create';
  await creation;
  assert.equal(vault.exists(), true);
  assert.equal(storage.writes, 1);
  const raw = storage.getItem(STORAGE_KEY)!;
  for (const secret of ['private-record-1', 'dato confidencial', PASSPHRASE, 'procedures']) {
    assert.equal(raw.includes(secret), false);
  }
  assert.equal(storage.values.size, 1);
  const exposed = vault.read();
  exposed.procedures[0].note = 'mutation after read';
  assert.deepEqual(vault.read(), initialState());
  vault.lock();
  assert.throws(() => vault.read(), { code: 'LOCKED' });
  await vault.unlock(PASSPHRASE);
  assert.deepEqual(vault.read(), initialState());
});

test('refuses short passphrases, missing vaults, and overwriting existing data', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await assert.rejects(vault.create('too short', initialState()), { code: 'INVALID_PASSPHRASE' });
  assert.equal(storage.writes, 0);
  await assert.rejects(vault.unlock(PASSPHRASE), { code: 'NOT_FOUND' });
  await vault.create(PASSPHRASE, initialState());
  const raw = storage.getItem(STORAGE_KEY);
  await assert.rejects(vault.create(PASSPHRASE, { procedures: [], meta: { count: 99 } }), { code: 'EXISTS' });
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(storage.writes, 1);
  assert.throws(() => vault.read(), { code: 'LOCKED' });
});

test('serializes concurrent writes, changes the IV, and detaches retained drafts', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  const firstEnvelope = JSON.parse(storage.getItem(STORAGE_KEY)!);
  let retained: State | undefined;
  await Promise.all([
    vault.update(draft => { draft.meta.count += 1; retained = draft; }),
    vault.update(draft => { draft.meta.count += 2; }),
    vault.update(draft => { draft.meta.count += 4; }),
  ]);
  retained!.meta.count = 999;
  assert.equal(vault.read().meta.count, 7);
  assert.equal(storage.writes, 4);
  const finalEnvelope = JSON.parse(storage.getItem(STORAGE_KEY)!);
  assert.notEqual(finalEnvelope.iv, firstEnvelope.iv);
  assert.equal(finalEnvelope.salt, firstEnvelope.salt);
  await vault.unlock(PASSPHRASE);
  assert.equal(vault.read().meta.count, 7);
});

test('quota and mutator failures preserve both committed memory and storage and do not poison the queue', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  const raw = storage.getItem(STORAGE_KEY);
  storage.failWrites = true;
  await assert.rejects(vault.update(draft => { draft.procedures = []; }), /quota/);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.deepEqual(vault.read(), initialState());
  storage.failWrites = false;
  await assert.rejects(vault.update(draft => { draft.meta.count = 42; throw new Error('abort mutation'); }), /abort mutation/);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.deepEqual(vault.read(), initialState());
  await vault.update(draft => { draft.meta.count = 3; });
  assert.equal(vault.read().meta.count, 3);
});

test('incorrect passphrases and a different encryption scope cannot decrypt copied ciphertext', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  await assert.rejects(vault.unlock('a completely different passphrase'), { code: 'DECRYPTION_FAILED' });
  assert.throws(() => vault.read(), { code: 'LOCKED' });
  const otherOwner = new EncryptedVault<State>(storage, STORAGE_KEY, 'urofolium:account-2');
  await assert.rejects(otherOwner.unlock(PASSPHRASE), { code: 'DECRYPTION_FAILED' });
  const otherScope = new EncryptedVault<State>(storage, STORAGE_KEY, 'another-app:account-1');
  await assert.rejects(otherScope.unlock(PASSPHRASE), { code: 'DECRYPTION_FAILED' });
  await vault.unlock(PASSPHRASE);
  assert.deepEqual(vault.read(), initialState());
});

test('validates the version and envelope, and authenticates ciphertext', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  const original = storage.getItem(STORAGE_KEY)!;
  const envelope = JSON.parse(original);
  for (const invalid of [
    'not json',
    'null',
    '[]',
    JSON.stringify({ ...envelope, version: 2 }),
    JSON.stringify({ ...envelope, iterations: 1 }),
    JSON.stringify({ ...envelope, salt: '!!!=' }),
    JSON.stringify({ ...envelope, iv: 'AAAA' }),
    JSON.stringify({ ...envelope, ciphertext: 42 }),
  ]) {
    storage.setItem(STORAGE_KEY, invalid);
    await assert.rejects(vault.unlock(PASSPHRASE), { code: 'INVALID_ENVELOPE' });
    assert.throws(() => vault.read(), { code: 'LOCKED' });
  }
  envelope.ciphertext = (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1);
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  await assert.rejects(vault.unlock(PASSPHRASE), { code: 'DECRYPTION_FAILED' });
  storage.setItem(STORAGE_KEY, original);
  await vault.unlock(PASSPHRASE);
  assert.deepEqual(vault.read(), initialState());
});

test('a stale tab cannot overwrite another tab, and reopening loads the newer committed state', async () => {
  const storage = new MemoryStorage();
  const firstTab = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  const secondTab = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await firstTab.create(PASSPHRASE, initialState());
  await secondTab.unlock(PASSPHRASE);
  await firstTab.update(draft => { draft.meta.count = 10; });
  const current = storage.getItem(STORAGE_KEY);
  let mutatorCalled = false;
  await assert.rejects(secondTab.update(draft => { mutatorCalled = true; draft.meta.count = 20; }), { code: 'CONFLICT' });
  assert.equal(mutatorCalled, false);
  assert.equal(storage.getItem(STORAGE_KEY), current);
  assert.equal(secondTab.read().meta.count, 0);
  await secondTab.unlock(PASSPHRASE);
  await secondTab.update(draft => { draft.meta.count += 1; });
  assert.equal(secondTab.read().meta.count, 11);
});

test('checks for external changes again after encryption and before committing', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  await assert.rejects(vault.update(draft => {
    draft.meta.count = 9;
    queueMicrotask(() => storage.setItem(STORAGE_KEY, 'changed during encryption'));
  }), { code: 'CONFLICT' });
  assert.equal(storage.getItem(STORAGE_KEY), 'changed during encryption');
  assert.deepEqual(vault.read(), initialState());
});

test('locking cancels active encryption and queued writes without changing persisted data', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  const raw = storage.getItem(STORAGE_KEY);
  const first = vault.update(draft => {
    draft.meta.count = 1;
    queueMicrotask(() => vault.lock());
  });
  const second = vault.update(draft => { draft.meta.count = 2; });
  await Promise.all([
    assert.rejects(first, { code: 'CANCELLED' }),
    assert.rejects(second, { code: 'CANCELLED' }),
  ]);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(storage.writes, 1);
  assert.throws(() => vault.read(), { code: 'LOCKED' });
  await vault.unlock(PASSPHRASE);
  assert.deepEqual(vault.read(), initialState());
});

test('locking cancels pending creation and unlock', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  const creation = vault.create(PASSPHRASE, initialState());
  await Promise.resolve();
  vault.lock();
  await assert.rejects(creation, { code: 'CANCELLED' });
  assert.equal(storage.writes, 0);
  await vault.create(PASSPHRASE, initialState());
  const unlocking = vault.unlock(PASSPHRASE);
  await Promise.resolve();
  vault.lock();
  await assert.rejects(unlocking, { code: 'CANCELLED' });
  assert.throws(() => vault.read(), { code: 'LOCKED' });
  await vault.unlock(PASSPHRASE);
  assert.deepEqual(vault.read(), initialState());
});

test('a new unlock supersedes an active update and cannot revive the old draft', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptedVault<State>(storage, STORAGE_KEY, CONTEXT);
  await vault.create(PASSPHRASE, initialState());
  let reopening: Promise<void> | undefined;
  const obsoleteUpdate = vault.update(draft => {
    draft.meta.count = 42;
    queueMicrotask(() => { reopening = vault.unlock(PASSPHRASE); });
  });
  await assert.rejects(obsoleteUpdate, { code: 'CANCELLED' });
  assert.ok(reopening);
  await reopening;
  assert.deepEqual(vault.read(), initialState());
  assert.equal(storage.writes, 1);
  await vault.update(draft => { draft.meta.count = 2; });
  assert.equal(vault.read().meta.count, 2);
});
