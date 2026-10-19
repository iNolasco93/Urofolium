import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { Procedure, StoneDetails } from '../../src/lib/types';
import { MIGRATIONS } from '../../src/db/migrations.ts';

export const PASSPHRASE = 'synthetic-local-passphrase';
const time = '2026-10-18T10:00:00.000Z';

export function procedure(id = 'synthetic-procedure'): Procedure {
  return { id, fecha: '2026-10-18', categoria: 'Litiasis',
    procedimiento: 'URS', abordaje: 'Endoscópico', duracion: 30, rol: 'Cirujano',
    cirujano_senior: null, primer_ayudante: null, segundo_ayudante: null,
    complicaciones: null, otro_especificar: null,
    created_at: time, updated_at: time, deleted_at: null };
}

export function stone(procedureId = 'synthetic-procedure'): StoneDetails {
  return { procedure_id: procedureId, lateralidad: 'Derecha', procedimiento_raw: { urs: true, rirs: false, nlpc: false },
    nefromax_fr: null, amplatz_fr: null, enhebrado: false, tamanio_mm: 7,
    tutor_interno: null, drenaje_nefrostomico: null, sonda_fr: null, etiqueta_drenaje: null,
    stonefree: true, created_at: time, updated_at: time };
}

export class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;
  beforeSet?: (key: string, value: string) => void;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    this.beforeSet?.(key, value);
    if (this.failWrites) throw new Error('Synthetic quota failure');
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

class MemoryPreferences {
  values = new Map<string, string>();
  beforeGet?: (key: string) => void | Promise<void>;
  async get({ key }: { key: string }) { await this.beforeGet?.(key); return { value: this.values.get(key) ?? null }; }
  async set({ key, value }: { key: string; value: string }) { this.values.set(key, value); }
  async remove({ key }: { key: string }) { this.values.delete(key); }
}

class MemorySecureStorage extends MemoryPreferences {
  async keys() { return { value: [...this.values.keys()] }; }
}

class NativeConnection {
  readonly database: DatabaseSync;
  readonly name: string;
  readonly registry: NativeSQLite;
  constructor(database: DatabaseSync, name: string, registry: NativeSQLite) {
    this.database = database;
    this.name = name;
    this.registry = registry;
  }
  async open() {}
  async execute(sql: string) { this.database.exec(sql); return {}; }
  async run(sql: string, values: unknown[] = []) { this.database.prepare(sql).run(...values as []); return {}; }
  async query(sql: string, values: unknown[] = []) { return { values: this.database.prepare(sql).all(...values as []) }; }
  async executeSet(set: { statement: string; values: unknown[] }[], transaction: boolean) {
    this.registry.transactionFlags.push(transaction);
    if (transaction) this.database.exec('BEGIN TRANSACTION');
    try {
      for (const row of set) this.database.prepare(row.statement).run(...row.values as []);
      if (this.registry.failNextTransaction) {
        this.registry.failNextTransaction = false;
        throw new Error('Synthetic native transaction failure');
      }
      if (transaction) this.database.exec('COMMIT');
    } catch (error) {
      if (transaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return {};
  }
  async delete() { this.registry.databases.delete(this.name); }
}

class NativeSQLite {
  databases = new Map<string, DatabaseSync>();
  connections = new Map<string, NativeConnection>();
  creationArguments: { name: string; encrypted: boolean; mode: string }[] = [];
  transactionFlags: boolean[] = [];
  failNextTransaction = false;
  secret: string | null = null;
  afterCreate?: (name: string) => void | Promise<void>;
  async isDatabase(name: string) { return { result: this.databases.has(name) }; }
  async isConnection(name: string) { return { result: this.connections.has(name) }; }
  async retrieveConnection(name: string) {
    const connection = this.connections.get(name);
    if (!connection) throw new Error('Connection missing');
    return connection;
  }
  async isSecretStored() { return { result: !!this.secret }; }
  async setEncryptionSecret(secret: string) { this.secret = secret; }
  async createConnection(name: string, encrypted: boolean, mode: string) {
    if (this.connections.has(name)) throw new Error('Connection already exists');
    this.creationArguments.push({ name, encrypted, mode });
    let database = this.databases.get(name);
    if (!database) {
      database = new DatabaseSync(':memory:');
      database.exec('PRAGMA foreign_keys = ON');
      this.databases.set(name, database);
    }
    const connection = new NativeConnection(database, name, this);
    this.connections.set(name, connection);
    await this.afterCreate?.(name);
    return connection;
  }
  async closeConnection(name: string) { this.connections.delete(name); }
}

class WebLocks {
  private pending = new Map<string, Promise<unknown>>();
  async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(name) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(callback);
    this.pending.set(name, operation);
    try { return await operation; }
    finally { if (this.pending.get(name) === operation) this.pending.delete(name); }
  }
}

const mocks: Record<string, string> = {
  '@capacitor/core': 'export const Capacitor = {getPlatform: () => globalThis.harness.platform};',
  '@capacitor/preferences': 'export const Preferences = globalThis.harness.preferences;',
  'capacitor-secure-storage-plugin': 'export const SecureStoragePlugin = globalThis.harness.secureStorage;',
  '@capacitor-community/sqlite': 'export const CapacitorSQLite = {}; export class SQLiteConnection { constructor() { return globalThis.harness.sqlite; } }',
  '../config/appConfig': 'export const APP_CONFIG = {storagePrefix: "urofolium"};',
};

let compiled: Promise<string> | undefined;
async function compiledDatabase(): Promise<string> {
  compiled ??= build({ stdin: { contents: "export * from './src/db/database'; export { createProcedure, updateProcedure, getProcedureById, getAllProcedures } from './src/db/procedureRepository';", resolveDir: resolve('.'), loader: 'ts' }, write: false, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'database-test-adapters', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'test-adapter' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'test-adapter' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  }).then(result => result.outputFiles[0].text);
  return compiled;
}

export async function createHarness(platform: 'web' | 'ios' = 'web', sharedStorage?: MemoryStorage, sharedLocks?: WebLocks) {
  const harness = { platform, storage: sharedStorage ?? new MemoryStorage(), preferences: new MemoryPreferences(),
    secureStorage: new MemorySecureStorage(), sqlite: new NativeSQLite(), locks: sharedLocks ?? new WebLocks() };
  const module = { exports: {} };
  runInNewContext(await compiledDatabase(), {
    module, exports: module.exports, globalThis: { harness }, localStorage: harness.storage,
    navigator: { locks: harness.locks }, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob,
    Date, Map, Set, Uint8Array, ArrayBuffer, Error, queueMicrotask,
  });
  return { ...harness, api: module.exports as typeof import('../../src/db/database') & typeof import('../../src/db/procedureRepository') };
}

export function seedLegacyWeb(harness: Awaited<ReturnType<typeof createHarness>>) {
  harness.storage.setItem('urofolium_web_procedures', JSON.stringify([procedure()]));
  harness.storage.setItem('urofolium_web_stone_details', JSON.stringify([stone()]));
  harness.storage.setItem('urofolium_web_meta', JSON.stringify({ schema_version: '3', device_label: 'Synthetic legacy device' }));
  harness.preferences.values.set('urofolium_backup_passphrase', 'synthetic-backup-passphrase');
}

export async function seedLegacyNative(harness: Awaited<ReturnType<typeof createHarness>>) {
  const legacy = await harness.sqlite.createConnection('urofolium', false, 'no-encryption');
  for (const migration of MIGRATIONS) await legacy.execute(migration.sql);
  await legacy.run('INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)', ['schema_version', '3']);
  for (const [table, row] of [['procedures', procedure()], ['stone_details', stone()]] as const) {
    const columns = Object.keys(row);
    const values = Object.values(row).map(value => typeof value === 'boolean' ? Number(value) : value && typeof value === 'object' ? JSON.stringify(value) : value);
    await legacy.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
  }
  await harness.sqlite.closeConnection('urofolium');
  harness.preferences.values.set('urofolium_backup_passphrase', 'synthetic-legacy-native-key');
}
