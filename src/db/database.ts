import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection, type capSQLiteSet } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { APP_CONFIG } from '../config/appConfig';
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from './migrations';
import { EncryptedVault } from './encryptedVault';
import { validateBackupPayload } from '../backup/backupValidation';
import type { MetaKey, Procedure, StoneDetails } from '../lib/types';

interface WebState {
  procedures: Procedure[];
  stoneDetails: StoneDetails[];
  meta: Partial<Record<MetaKey, string>>;
  secrets: Record<string, string>;
}

const prefix = APP_CONFIG.storagePrefix;
const legacyOwnerKey = `${prefix}_legacy_owner`;
const sqlite = new SQLiteConnection(CapacitorSQLite);
let db: SQLiteDBConnection | null = null;
let dbName: string | null = null;
let vault: EncryptedVault<WebState> | null = null;
let owner: string | null = null;
let generation = 0;
let closing: Promise<void> = Promise.resolve();
let opening: Promise<void> = Promise.resolve();

function scope(userId: string): string {
  if (!userId) throw new Error('No hay usuario para abrir los datos locales.');
  const encoded = Array.from(new TextEncoder().encode(userId), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_account_${encoded}`;
}

function newVault(userId: string): EncryptedVault<WebState> {
  return new EncryptedVault(localStorage, `${scope(userId)}_vault`, `${prefix}:${userId}`);
}

export function getDatabaseOwner(): string {
  if (!owner) throw new Error('Los datos locales están bloqueados.');
  return owner;
}

export function assertDatabaseOwner(expected: string): void {
  if (owner !== expected) throw new Error('La cuenta ha cambiado. Vuelve a abrir los datos antes de continuar.');
}

export function isDatabaseOpenFor(userId: string): boolean { return owner === userId; }

/** Revoke access immediately, including writes waiting for encryption. */
export function lockDatabase(): void {
  generation++;
  owner = null;
  vault?.lock();
  vault = null;
  const previousName = dbName;
  db = null;
  dbName = null;
  if (previousName) closing = closing.then(() => sqlite.closeConnection(previousName, false)).catch(() => undefined);
}

export async function inspectLocalData(userId: string): Promise<{ exists: boolean; legacyAvailable: boolean; needsPassphrase: boolean }> {
  const web = Capacitor.getPlatform() === 'web';
  const legacyOwner = web ? localStorage.getItem(legacyOwnerKey) : (await Preferences.get({ key: legacyOwnerKey })).value;
  return {
    exists: web ? newVault(userId).exists() : !!(await sqlite.isDatabase(scope(userId))).result,
    legacyAvailable: (!legacyOwner || legacyOwner === userId) && (web
      ? !!localStorage.getItem(`${prefix}_web_procedures`)
      : !!(await sqlite.isDatabase(prefix)).result),
    needsPassphrase: web,
  };
}

export function initDatabase(userId: string, passphrase = '', migrateLegacy = false): Promise<void> {
  lockDatabase();
  const ticket = generation;
  const operation = opening.then(async () => {
    if (ticket !== generation) throw new Error('La apertura se canceló porque cambió la sesión.');
    const start = () => openDatabase(userId, passphrase, migrateLegacy, ticket);
    if (migrateLegacy && Capacitor.getPlatform() === 'web') {
      if (typeof navigator === 'undefined' || !navigator.locks) {
        throw new Error('Para migrar los registros antiguos, utiliza un navegador actualizado con bloqueo seguro entre pestañas.');
      }
      await navigator.locks.request(`${prefix}_legacy_migration`, start);
    } else await start();
  }).catch(error => {
    if (ticket === generation) lockDatabase();
    throw error;
  });
  opening = operation.catch(() => undefined);
  return operation;
}

async function openDatabase(userId: string, passphrase: string, migrateLegacy: boolean, ticket: number): Promise<void> {
  const assertOpening = () => {
    if (ticket !== generation) throw new Error('La apertura se canceló porque cambió la sesión.');
  };
  await closing;
  assertOpening();
  const status = await inspectLocalData(userId);
  assertOpening();
  if (migrateLegacy && !status.legacyAvailable) throw new Error('Estos registros antiguos ya están asignados a otra cuenta.');

  if (Capacitor.getPlatform() === 'web') {
    const next = newVault(userId);
    vault = next;
    if (status.exists) await next.unlock(passphrase);
    else await next.create(passphrase, { procedures: [], stoneDetails: [], meta: { schema_version: String(CURRENT_SCHEMA_VERSION) }, secrets: {} });
    assertOpening();
    if (migrateLegacy) {
      const original = readLegacyWeb();
      const data = validateLegacy(original.procedures, original.stoneDetails, userId);
      const oldKey = (await Preferences.get({ key: `${prefix}_backup_passphrase` })).value;
      assertOpening();
      const legacyOwner = localStorage.getItem(legacyOwnerKey);
      if (legacyOwner && legacyOwner !== userId) throw new Error('Los registros antiguos ya están asignados a otra cuenta.');
      await next.update(state => {
        const ownerNow = localStorage.getItem(legacyOwnerKey);
        if (ownerNow && ownerNow !== userId) throw new Error('Los registros antiguos ya están asignados a otra cuenta.');
        const known = new Set(state.procedures.map(item => item.id));
        mergeState(state, data.procedures.filter(item => !known.has(item.id)), data.stoneDetails.filter(item => !known.has(item.procedure_id)));
        state.meta = { ...original.meta, ...state.meta };
        if (oldKey && !state.secrets.backup_passphrase) state.secrets.backup_passphrase = oldKey;
      });
      assertOpening();
      // Reopen the committed ciphertext before retiring the plaintext source.
      const verified = newVault(userId);
      await verified.unlock(passphrase);
      verified.lock();
      assertOpening();
      const ownerNow = localStorage.getItem(legacyOwnerKey);
      if (ownerNow && ownerNow !== userId) throw new Error('Los registros antiguos ya están asignados a otra cuenta.');
      localStorage.setItem(legacyOwnerKey, userId);
      for (const [key, value] of original.raw) {
        if (localStorage.getItem(key) !== value) throw new Error('Los datos antiguos cambiaron en otra pestaña. Cierra esa pestaña y vuelve a migrarlos.');
      }
      for (const [key] of original.raw) localStorage.removeItem(key);
      await Preferences.remove({ key: `${prefix}_backup_passphrase` });
    }
  } else {
    if (!(await sqlite.isSecretStored()).result) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      await sqlite.setEncryptionSecret(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''));
    }
    assertOpening();
    const name = scope(userId);
    const connection = await sqlite.createConnection(name, true, 'secret', 1, false);
    try { assertOpening(); } catch (error) { await sqlite.closeConnection(name, false); throw error; }
    dbName = name;
    db = connection;
    await connection.open();
    await runMigrations(connection);
    assertOpening();
    if (migrateLegacy) {
      const legacy = await sqlite.createConnection(prefix, false, 'no-encryption', 1, false);
      try {
        await legacy.open();
        await runMigrations(legacy);
        const procedures = (await legacy.query('SELECT * FROM procedures')).values ?? [];
        const stones = (await legacy.query('SELECT * FROM stone_details')).values ?? [];
        const data = validateLegacy(procedures.map(normalizeLegacyProcedure), stones.map(normalizeLegacyStone), userId);
        assertOpening();
        const existingIds = new Set(((await connection.query('SELECT id FROM procedures')).values ?? []).map(item => item.id));
        await connection.executeSet(dataStatements(data.procedures.filter(item => !existingIds.has(item.id)), data.stoneDetails.filter(item => !existingIds.has(item.procedure_id))), true);
        const oldMeta = (await legacy.query('SELECT key,value FROM app_meta')).values ?? [];
        for (const entry of oldMeta) {
          if (entry.key !== 'schema_version') await connection.run('INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)', [entry.key, entry.value]);
        }
        const oldKey = (await Preferences.get({ key: `${prefix}_backup_passphrase` })).value;
        const secureKey = `${scope(userId)}_backup_passphrase`;
        if (oldKey && !(await SecureStoragePlugin.keys()).value.includes(secureKey)) await SecureStoragePlugin.set({ key: secureKey, value: oldKey });
        assertOpening();
        await Preferences.set({ key: legacyOwnerKey, value: userId });
        await legacy.delete();
        await Preferences.remove({ key: `${prefix}_backup_passphrase` });
      } finally { await sqlite.closeConnection(prefix, false); }
    }
  }
  assertOpening();
  // Legacy Google grants have no owner and must never attach to a new account.
  for (const key of ['google_access_token', 'google_token_expiry', 'google_drive_connected_at']) await Preferences.remove({ key });
  assertOpening();
  owner = userId;
}

function readLegacyWeb() {
  const raw = ['procedures', 'stone_details', 'meta'].map(suffix => {
    const key = `${prefix}_web_${suffix}`;
    return [key, localStorage.getItem(key)] as const;
  });
  const rows = JSON.parse(raw[0][1] ?? '[]');
  return {
    raw,
    procedures: Array.isArray(rows) ? rows.map(normalizeLegacyProcedure) : rows,
    stoneDetails: JSON.parse(raw[1][1] ?? '[]'),
    meta: JSON.parse(raw[2][1] ?? '{}') as Partial<Record<MetaKey, string>>,
  };
}

function normalizeLegacyProcedure(row: Record<string, unknown>) {
  return { ...row, primer_ayudante: row.primer_ayudante ?? null };
}

function normalizeLegacyStone(row: Record<string, unknown>) {
  return {
    ...row,
    procedimiento_raw: typeof row.procedimiento_raw === 'string' ? JSON.parse(row.procedimiento_raw) : row.procedimiento_raw,
    enhebrado: row.enhebrado === true || row.enhebrado === 1,
    stonefree: row.stonefree == null ? null : row.stonefree === true || row.stonefree === 1,
  };
}

function validateLegacy(procedures: unknown, stoneDetails: unknown, userId: string) {
  const payload = validateBackupPayload({
    app: 'UroFolium', backupVersion: 3, createdAt: new Date().toISOString(),
    user: { supabaseUserId: userId, email: 'local@migration.invalid' },
    device: { platform: Capacitor.getPlatform(), appVersion: '1.0.0', label: 'Migración local' },
    schema: { version: CURRENT_SCHEMA_VERSION }, data: { procedures, stoneDetails },
  }, { userId, maxBackupVersion: 3, maxSchemaVersion: CURRENT_SCHEMA_VERSION });
  return { procedures: payload.data.procedures, stoneDetails: payload.data.stoneDetails ?? [] };
}

async function runMigrations(connection: SQLiteDBConnection): Promise<void> {
  let currentVersion = 0;
  try {
    const res = await connection.query("SELECT value FROM app_meta WHERE key = 'schema_version'");
    currentVersion = Number(res.values?.[0]?.value ?? 0);
  } catch { /* A new database has no metadata table yet. */ }
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    await connection.execute(migration.sql);
    await connection.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', ['schema_version', String(migration.version)]);
  }
}

export function getDB(): SQLiteDBConnection {
  getDatabaseOwner();
  if (!db) throw new Error('La base de datos no está abierta.');
  return db;
}

export function isWebDatabase(): boolean { return Capacitor.getPlatform() === 'web'; }
function activeVault(): EncryptedVault<WebState> {
  getDatabaseOwner();
  if (!vault) throw new Error('Los datos locales están bloqueados.');
  return vault;
}
export function readWebProcedures(): Procedure[] { return activeVault().read().procedures; }
export function readWebStoneDetails(): StoneDetails[] { return activeVault().read().stoneDetails; }
export function getWebMeta(key: MetaKey): string | null { return activeVault().read().meta[key] ?? null; }

export async function writeWebProcedures(items: Procedure[]): Promise<void> {
  await activeVault().update(state => { state.procedures = items; state.meta.last_data_changed_at = new Date().toISOString(); });
}
export async function writeWebStoneDetails(items: StoneDetails[]): Promise<void> {
  await activeVault().update(state => { state.stoneDetails = items; state.meta.last_data_changed_at = new Date().toISOString(); });
}
export async function updateWebProcedures(update: (items: Procedure[]) => Procedure[]): Promise<void> {
  await activeVault().update(state => { state.procedures = update(state.procedures); state.meta.last_data_changed_at = new Date().toISOString(); });
}
export async function updateWebStoneDetails(update: (items: StoneDetails[]) => StoneDetails[]): Promise<void> {
  await activeVault().update(state => { state.stoneDetails = update(state.stoneDetails); state.meta.last_data_changed_at = new Date().toISOString(); });
}
export async function setWebMeta(key: MetaKey, value: string): Promise<void> {
  await activeVault().update(state => { state.meta[key] = value; });
}
export async function clearProcedures(): Promise<void> {
  if (isWebDatabase()) return writeWebProcedures([]);
  await getDB().run('DELETE FROM procedures');
}
export async function clearStoneDetails(): Promise<void> {
  if (isWebDatabase()) return writeWebStoneDetails([]);
  await getDB().run('DELETE FROM stone_details');
}

function mergeState(state: WebState, procedures: Procedure[], stones: StoneDetails[], removeStoneIds: string[] = []): void {
  const byId = new Map(state.procedures.map(item => [item.id, item]));
  procedures.forEach(item => byId.set(item.id, item));
  const stoneById = new Map(state.stoneDetails.map(item => [item.procedure_id, item]));
  removeStoneIds.forEach(id => stoneById.delete(id));
  stones.forEach(item => stoneById.set(item.procedure_id, item));
  state.procedures = [...byId.values()];
  state.stoneDetails = [...stoneById.values()];
  state.meta.last_data_changed_at = new Date().toISOString();
}

const procedureColumns = ['id', 'fecha', 'categoria', 'procedimiento', 'abordaje', 'duracion', 'rol', 'cirujano_senior', 'primer_ayudante', 'segundo_ayudante', 'complicaciones', 'otro_especificar', 'created_at', 'updated_at', 'deleted_at'] as const;
const stoneColumns = ['procedure_id', 'lateralidad', 'procedimiento_raw', 'nefromax_fr', 'amplatz_fr', 'enhebrado', 'tamanio_mm', 'tutor_interno', 'drenaje_nefrostomico', 'sonda_fr', 'etiqueta_drenaje', 'stonefree', 'created_at', 'updated_at'] as const;
function insertStatement(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(${columns[0]}) DO UPDATE SET ${columns.slice(1).map(column => `${column}=excluded.${column}`).join(',')}`;
}
function dataStatements(procedures: Procedure[], stones: StoneDetails[]): capSQLiteSet[] {
  return [
    ...procedures.map(procedure => ({ statement: insertStatement('procedures', procedureColumns), values: procedureColumns.map(column => procedure[column] ?? null) })),
    ...stones.map(stone => ({ statement: insertStatement('stone_details', stoneColumns), values: stoneColumns.map(column => column === 'procedimiento_raw' ? JSON.stringify(stone[column]) : typeof stone[column] === 'boolean' ? Number(stone[column]) : stone[column] ?? null) })),
    { statement: 'INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)', values: ['last_data_changed_at', new Date().toISOString()] },
  ];
}
export async function replaceDatabaseContents(procedures: Procedure[], stoneDetails: StoneDetails[]): Promise<void> {
  if (isWebDatabase()) return activeVault().update(state => {
    state.procedures = procedures;
    state.stoneDetails = stoneDetails;
    state.meta.last_data_changed_at = new Date().toISOString();
  });
  await getDB().executeSet([{ statement: 'DELETE FROM stone_details', values: [] }, { statement: 'DELETE FROM procedures', values: [] }, ...dataStatements(procedures, stoneDetails)], true);
}
export async function mergeDatabaseContents(procedures: Procedure[], stoneDetails: StoneDetails[], removeStoneIds: string[] = []): Promise<void> {
  if (isWebDatabase()) return activeVault().update(state => mergeState(state, procedures, stoneDetails, removeStoneIds));
  await getDB().executeSet([...removeStoneIds.map(id => ({ statement: 'DELETE FROM stone_details WHERE procedure_id = ?', values: [id] })), ...dataStatements(procedures, stoneDetails)], true);
}

export async function getLocalSecret(key: string): Promise<string | null> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) return activeVault().read().secrets[key] ?? null;
  const secureKey = `${scope(userId)}_${key}`;
  const keys = await SecureStoragePlugin.keys();
  assertDatabaseOwner(userId);
  if (!keys.value.includes(secureKey)) return null;
  const result = await SecureStoragePlugin.get({ key: secureKey });
  assertDatabaseOwner(userId);
  return result.value;
}
export async function setLocalSecret(key: string, value: string): Promise<void> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) return activeVault().update(state => { state.secrets[key] = value; });
  await SecureStoragePlugin.set({ key: `${scope(userId)}_${key}`, value });
  assertDatabaseOwner(userId);
}
export async function removeLocalSecrets(keys: string[]): Promise<void> {
  const userId = getDatabaseOwner();
  if (isWebDatabase()) return activeVault().update(state => { keys.forEach(key => delete state.secrets[key]); });
  const stored = (await SecureStoragePlugin.keys()).value;
  assertDatabaseOwner(userId);
  for (const key of keys) {
    const secureKey = `${scope(userId)}_${key}`;
    if (stored.includes(secureKey)) await SecureStoragePlugin.remove({ key: secureKey });
  }
}
