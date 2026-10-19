import { getDB, getWebMeta, isWebDatabase, setWebMeta } from './database';
import type { MetaKey } from '../lib/types';

export async function getMeta(key: MetaKey): Promise<string | null> {
  if (isWebDatabase()) {
    return getWebMeta(key);
  }
  const db = getDB();
  const res = await db.query(`SELECT value FROM app_meta WHERE key = ?`, [key]);
  if (!res.values || res.values.length === 0) return null;
  return res.values[0].value as string;
}

export async function setMeta(key: MetaKey, value: string): Promise<void> {
  if (isWebDatabase()) {
    await setWebMeta(key, value);
    return;
  }
  const db = getDB();
  await db.run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`, [key, value]);
}

export async function getMetaBatch(keys: MetaKey[]): Promise<Partial<Record<MetaKey, string>>> {
  const result: Partial<Record<MetaKey, string>> = {};
  for (const key of keys) {
    const val = await getMeta(key);
    if (val !== null) result[key] = val;
  }
  return result;
}
