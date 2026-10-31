const FORMAT = 'urofolium-sync';
const ITERATIONS = 600_000;
const MAX_BYTES = 8_388_608;
export interface SyncEnvelope { format: typeof FORMAT; version: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string; ciphertext: string }
export class SyncKeyError extends Error {}
const encoder = new TextEncoder();
function bytesBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function encode(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
function decode(input: string): Uint8Array {
  if (!input || input.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input)) throw new Error('Copia cifrada no válida.');
  const bytes = Uint8Array.from(atob(input), value => value.charCodeAt(0));
  if (encode(bytes) !== input) throw new Error('Copia cifrada no válida.');
  return bytes;
}
async function key(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytesBuffer(salt), iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function aad(user: string, channel: string, revision: number): Uint8Array {
  return encoder.encode(JSON.stringify([FORMAT, 1, user, channel, revision]));
}
export function generateSyncKey(): string { return encode(crypto.getRandomValues(new Uint8Array(32))); }
export function validateEnvelope(input: unknown): SyncEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Copia cifrada no válida.');
  const e = input as SyncEnvelope;
  if (Object.keys(e).length !== 7 || e.format !== FORMAT || e.version !== 1 || e.kdf !== 'PBKDF2-SHA256' || e.iterations !== ITERATIONS ||
      typeof e.salt !== 'string' || typeof e.iv !== 'string' || typeof e.ciphertext !== 'string' || JSON.stringify(e).length > MAX_BYTES ||
      decode(e.salt).length !== 16 || decode(e.iv).length !== 12 || decode(e.ciphertext).length < 16) throw new Error('Copia cifrada no válida o demasiado grande.');
  return e;
}
export async function encryptSnapshot(value: unknown, passphrase: string, user: string, channel: string, revision: number): Promise<SyncEnvelope> {
  if (passphrase.length < 12) throw new Error('La clave de sincronización debe tener al menos 12 caracteres.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(value));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytesBuffer(iv), additionalData: bytesBuffer(aad(user, channel, revision)) }, await key(passphrase, salt), bytesBuffer(plain));
    return validateEnvelope({ format: FORMAT, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
  } finally { plain.fill(0); }
}
export async function decryptSnapshot(input: unknown, passphrase: string, user: string, channel: string, revision: number): Promise<unknown> {
  const e = validateEnvelope(input);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesBuffer(decode(e.iv)), additionalData: bytesBuffer(aad(user, channel, revision)) }, await key(passphrase, decode(e.salt)), bytesBuffer(decode(e.ciphertext)));
  } catch { throw new SyncKeyError('La clave no abre la copia remota o la copia ha sido alterada. Introduce la clave original.'); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); }
  finally { new Uint8Array(plain).fill(0); }
}
