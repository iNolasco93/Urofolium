/** Account-scoped JSON storage. The passphrase and derived key only live in memory. */
export type VaultStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type EncryptedVaultErrorCode =
  | 'LOCKED'
  | 'CANCELLED'
  | 'CONFLICT'
  | 'EXISTS'
  | 'NOT_FOUND'
  | 'INVALID_PASSPHRASE'
  | 'INVALID_ENVELOPE'
  | 'DECRYPTION_FAILED';

export class EncryptedVaultError extends Error {
  constructor(public readonly code: EncryptedVaultErrorCode, message: string) {
    super(message);
    this.name = 'EncryptedVaultError';
  }
}

const FORMAT = 'urofolium-vault';
const VERSION = 1;
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

interface Envelope {
  format: typeof FORMAT;
  version: typeof VERSION;
  kdf: 'PBKDF2-SHA256';
  iterations: typeof ITERATIONS;
  salt: string;
  iv: string;
  ciphertext: string;
}

const encoder = new TextEncoder();

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function invalidEnvelope(): EncryptedVaultError {
  return new EncryptedVaultError('INVALID_ENVELOPE', 'El almacén cifrado está dañado o utiliza una versión no compatible.');
}

function decodeBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw invalidEnvelope();
  }
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    if (encodeBase64(bytes) !== value) throw invalidEnvelope();
    return bytes;
  } catch {
    throw invalidEnvelope();
  }
}

function parseEnvelope(raw: string): Envelope {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw invalidEnvelope();
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw invalidEnvelope();
  const value = candidate as Record<string, unknown>;
  if (
    Object.keys(value).length !== 7 ||
    value.format !== FORMAT ||
    value.version !== VERSION ||
    value.kdf !== 'PBKDF2-SHA256' ||
    value.iterations !== ITERATIONS ||
    typeof value.salt !== 'string' ||
    typeof value.iv !== 'string' ||
    typeof value.ciphertext !== 'string'
  ) throw invalidEnvelope();
  if (
    decodeBase64(value.salt).length !== SALT_BYTES ||
    decodeBase64(value.iv).length !== IV_BYTES ||
    decodeBase64(value.ciphertext).length < 16
  ) throw invalidEnvelope();
  return value as unknown as Envelope;
}

/** Values must be JSON data; cloning prevents callers from mutating the committed state. */
function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('El estado del almacén debe ser un valor JSON.');
  return JSON.parse(serialized) as T;
}

async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bytesBuffer(decodeBase64(salt)), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function additionalData(context: string, salt: string): Uint8Array {
  return encoder.encode(JSON.stringify([FORMAT, VERSION, 'PBKDF2-SHA256', ITERATIONS, salt, context]));
}

async function encrypt<T>(state: T, key: CryptoKey, salt: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(JSON.stringify(state));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bytesBuffer(iv), additionalData: bytesBuffer(additionalData(context, salt)), tagLength: 128 },
      key,
      plaintext,
    );
    const envelope: Envelope = {
      format: FORMAT,
      version: VERSION,
      kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      salt,
      iv: encodeBase64(iv),
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    };
    return JSON.stringify(envelope);
  } finally {
    plaintext.fill(0);
  }
}

export class EncryptedVault<T> {
  private key: CryptoKey | null = null;
  private state: T | undefined;
  private salt: string | null = null;
  private persistedEnvelope: string | null = null;
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: VaultStorage,
    private readonly storageKey: string,
    private readonly context: string,
  ) {
    if (!storageKey || !context) throw new TypeError('El almacén necesita una clave y un contexto de cuenta.');
  }

  exists(): boolean {
    return this.storage.getItem(this.storageKey) !== null;
  }

  async create(passphrase: string, initialState: T): Promise<void> {
    if (passphrase.length < 12) {
      throw new EncryptedVaultError('INVALID_PASSPHRASE', 'La contraseña local debe tener al menos 12 caracteres.');
    }
    // Snapshot caller data before yielding; a later caller mutation must not enter the vault.
    const initial = cloneJson(initialState);
    this.lock();
    const generation = this.generation;
    return this.enqueue(() => this.withWriteLock(async () => {
      this.assertGeneration(generation);
      if (this.exists()) throw new EncryptedVaultError('EXISTS', 'Ya existe un almacén para esta cuenta. Desbloquéalo para continuar.');
      const salt = encodeBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
      const key = await deriveKey(passphrase, salt);
      this.assertGeneration(generation);
      const envelope = await encrypt(initial, key, salt, this.context);
      this.assertGeneration(generation);
      this.assertUnchanged(null);
      this.storage.setItem(this.storageKey, envelope);
      this.key = key;
      this.salt = salt;
      this.state = initial;
      this.persistedEnvelope = envelope;
    }));
  }

  async unlock(passphrase: string): Promise<void> {
    // Starting a new session also cancels work started by the previous session.
    this.lock();
    const generation = this.generation;
    return this.enqueue(async () => {
      this.assertGeneration(generation);
      const raw = this.storage.getItem(this.storageKey);
      if (raw === null) throw new EncryptedVaultError('NOT_FOUND', 'Esta cuenta todavía no tiene un almacén local.');
      const envelope = parseEnvelope(raw);
      const key = await deriveKey(passphrase, envelope.salt);
      this.assertGeneration(generation);
      let plaintext: ArrayBuffer;
      try {
        plaintext = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: bytesBuffer(decodeBase64(envelope.iv)),
            additionalData: bytesBuffer(additionalData(this.context, envelope.salt)),
            tagLength: 128,
          },
          key,
          bytesBuffer(decodeBase64(envelope.ciphertext)),
        );
      } catch {
        this.assertGeneration(generation);
        throw new EncryptedVaultError('DECRYPTION_FAILED', 'Contraseña local incorrecta o almacén cifrado dañado.');
      }
      let state: T;
      try {
        state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as T;
      } catch {
        throw invalidEnvelope();
      } finally {
        new Uint8Array(plaintext).fill(0);
      }
      this.assertGeneration(generation);
      this.assertUnchanged(raw);
      this.key = key;
      this.salt = envelope.salt;
      this.state = state;
      this.persistedEnvelope = raw;
    });
  }

  read(): T {
    this.assertUnlocked();
    return cloneJson(this.state as T);
  }

  async update(mutator: (draft: T) => void): Promise<void> {
    this.assertUnlocked();
    const generation = this.generation;
    return this.enqueue(() => this.withWriteLock(async () => {
      this.assertGeneration(generation);
      this.assertUnlocked();
      this.assertUnchanged(this.persistedEnvelope);
      const draft = cloneJson(this.state as T);
      mutator(draft);
      // The mutator may retain its draft; keep the committed state detached from it.
      const next = cloneJson(draft);
      this.assertGeneration(generation);
      const envelope = await encrypt(next, this.key!, this.salt!, this.context);
      this.assertGeneration(generation);
      this.assertUnchanged(this.persistedEnvelope);
      // localStorage commits the whole envelope atomically. Quota errors leave memory intact.
      this.storage.setItem(this.storageKey, envelope);
      this.state = next;
      this.persistedEnvelope = envelope;
    }));
  }

  lock(): void {
    this.generation += 1;
    this.key = null;
    this.state = undefined;
    this.salt = null;
    this.persistedEnvelope = null;
  }

  private async withWriteLock(task: () => Promise<void>): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(`urofolium-vault:${this.storageKey}`, task);
      return;
    }
    // Older browsers still reject a changed envelope before committing.
    return task();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const operation = this.pending.then(task);
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private assertUnlocked(): void {
    if (!this.key || !this.salt || this.persistedEnvelope === null) {
      throw new EncryptedVaultError('LOCKED', 'Desbloquea el almacén local para acceder a los registros.');
    }
  }

  private assertGeneration(generation: number): void {
    if (this.generation !== generation) {
      throw new EncryptedVaultError('CANCELLED', 'La sesión local ha cambiado. La operación se ha cancelado.');
    }
  }

  private assertUnchanged(expected: string | null): void {
    if (this.storage.getItem(this.storageKey) !== expected) {
      throw new EncryptedVaultError('CONFLICT', 'Los datos han cambiado en otra pestaña. Vuelve a desbloquear el almacén antes de guardar.');
    }
  }
}
