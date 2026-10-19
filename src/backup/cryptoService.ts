import { getLocalSecret, setLocalSecret } from '../db/database';

const PBKDF2_ITERATIONS = 200_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encrypt(payload: object, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, plaintext);

  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  return new Blob([result], { type: 'application/octet-stream' });
}

export async function decrypt(blob: Blob, passphrase: string): Promise<object> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const salt = bytes.slice(0, SALT_LENGTH);
  const iv = bytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = bytes.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(passphrase, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
  } catch {
    throw new Error('Error al descifrar: passphrase incorrecta o archivo corrupto.');
  }
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

const PASSPHRASE_KEY = 'backup_passphrase';

export async function savePassphrase(passphrase: string): Promise<void> {
  await setLocalSecret(PASSPHRASE_KEY, passphrase);
}

export async function getPassphrase(): Promise<string | null> {
  return getLocalSecret(PASSPHRASE_KEY);
}

export function generatePassphrase(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const arr = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}
