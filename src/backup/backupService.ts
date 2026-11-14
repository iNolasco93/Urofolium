import { validatePersonalCatalog } from '../lib/personalProcedures';
import { Capacitor } from '@capacitor/core';
import { getCurrentUser } from '../auth/authService';
import { getAllProcedures } from '../db/procedureRepository';
import { getAllStoneDetails } from '../db/stoneRepository';
import { assertDatabaseOwner, getDatabaseOwner, getLocalSecret, replaceDatabaseContents, runLocalWrite } from '../db/database';
import { CURRENT_SCHEMA_VERSION } from '../db/migrations';
import { getMeta, setMeta } from '../db/metaRepository';
import { encrypt, decrypt, getPassphrase, savePassphrase, generatePassphrase } from './cryptoService';
import { uploadFileToDrive, downloadLatestBackup, rotateWeeklyBackup, findFileByName } from '../google/driveService';
import { APP_CONFIG } from '../config/appConfig';
import { validateBackupPayload } from './backupValidation';
import { migrateProcedureCatalog } from '../lib/migrationReview';
import type { BackupPayload, BackupInfo } from '../lib/types';

const APP_VERSION = '1.0.0';
const BACKUP_VERSION = 6;
const LATEST_FILENAME = `${APP_CONFIG.backupPrefix}-backup-latest.json.enc`;
const AUTO_BACKUP_INTERVAL_HOURS = 24;
/** Same secret name as the sync manager. Reusing it leaves the user a single recovery key. */
const SYNC_KEY = 'sync_key_v1';

async function ensurePassphrase(): Promise<string> {
  const ownerId = getDatabaseOwner();
  let pass = await getPassphrase();
  assertDatabaseOwner(ownerId);
  if (!pass) {
    pass = (await getLocalSecret(SYNC_KEY)) ?? generatePassphrase();
    assertDatabaseOwner(ownerId);
    await savePassphrase(pass);
    assertDatabaseOwner(ownerId);
  }
  return pass;
}

export interface BackupKeyStatus {
  hasKey: boolean;
  /** The backup key is the sync key, so one saved key recovers both. */
  sameAsSyncKey: boolean;
  syncKeyAvailable: boolean;
  /** The user confirmed having saved this exact key outside the app. */
  confirmed: boolean;
}

async function keyFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`urofolium-backup-key:${value}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getBackupKeyStatus(): Promise<BackupKeyStatus> {
  const ownerId = getDatabaseOwner();
  const pass = await getPassphrase();
  assertDatabaseOwner(ownerId);
  const syncKey = await getLocalSecret(SYNC_KEY);
  assertDatabaseOwner(ownerId);
  const confirmedFingerprint = await getMeta('backup_key_confirmed');
  assertDatabaseOwner(ownerId);
  return {
    hasKey: !!pass,
    sameAsSyncKey: !!pass && pass === syncKey,
    syncKeyAvailable: !!syncKey,
    confirmed: !!pass && confirmedFingerprint === await keyFingerprint(pass),
  };
}

/** Changing the key later invalidates the confirmation, because it stores the key fingerprint. */
export async function confirmBackupKeySaved(): Promise<void> {
  const ownerId = getDatabaseOwner();
  const pass = await getPassphrase();
  assertDatabaseOwner(ownerId);
  if (!pass) throw new Error('Primero muestra o crea la clave de respaldo.');
  const fingerprint = await keyFingerprint(pass);
  assertDatabaseOwner(ownerId);
  await setMeta('backup_key_confirmed', fingerprint);
}

export async function adoptSyncKeyForBackups(): Promise<string> {
  const ownerId = getDatabaseOwner();
  const syncKey = await getLocalSecret(SYNC_KEY);
  assertDatabaseOwner(ownerId);
  if (!syncKey) throw new Error('Este dispositivo todavía no tiene clave de sincronización. Sincroniza primero.');
  await savePassphrase(syncKey);
  assertDatabaseOwner(ownerId);
  return syncKey;
}

export async function getBackupPassphrase(): Promise<string | null> {
  return getPassphrase();
}

export async function getOrCreateBackupPassphrase(): Promise<string> {
  return ensurePassphrase();
}

export async function updateBackupPassphrase(passphrase: string): Promise<void> {
  const clean = passphrase.trim();
  if (clean.length < 12) {
    throw new Error('La clave de respaldo debe tener al menos 12 caracteres.');
  }
  await savePassphrase(clean);
}

async function buildBackupPayload(): Promise<BackupPayload> {
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay sesión activa');
  assertDatabaseOwner(user.id);
  return runLocalWrite(user.id, async () => {
    const procedures = (await getAllProcedures()).map(p => ({ ...p, estado: p.estado ?? 'realizada' as const, notas: p.notas ?? null }));
    assertDatabaseOwner(user.id);
    const procedureIds = new Set(procedures.map(procedure => procedure.id));
    const stoneDetails = (await getAllStoneDetails()).filter(details => procedureIds.has(details.procedure_id));
    assertDatabaseOwner(user.id);
    const rawCatalog = await getMeta('personal_procedures');
    const personalProcedures = rawCatalog === null ? [] : validatePersonalCatalog(JSON.parse(rawCatalog));
    assertDatabaseOwner(user.id);
    const deviceLabel = (await getMeta('device_label')) ?? 'Desconocido';
    assertDatabaseOwner(user.id);
    return {
      app: 'UroFolium', backupVersion: BACKUP_VERSION, createdAt: new Date().toISOString(),
      user: { supabaseUserId: user.id, email: user.email },
      device: { platform: Capacitor.getPlatform(), appVersion: APP_VERSION, label: deviceLabel },
      schema: { version: CURRENT_SCHEMA_VERSION }, data: { procedures, stoneDetails, personalProcedures },
    };
  }, false);
}

export async function createBackupNow(): Promise<void> {
  const ownerId = getDatabaseOwner();
  // A copy nobody can decrypt is worse than no copy: require a confirmed key first.
  if (!(await getBackupKeyStatus()).confirmed) {
    throw new Error('Antes de subir copias a Google Drive, confirma en Ajustes que has guardado tu clave de respaldo.');
  }
  assertDatabaseOwner(ownerId);
  const blob = await createEncryptedBackupBlob();
  assertDatabaseOwner(ownerId);
  const fileId = await uploadFileToDrive(blob, LATEST_FILENAME);
  assertDatabaseOwner(ownerId);

  const now = new Date();
  if (now.getDay() === 0) await rotateWeeklyBackup(blob, APP_CONFIG.backupPrefix);
  assertDatabaseOwner(ownerId);

  await setMeta('last_backup_at', now.toISOString());
  assertDatabaseOwner(ownerId);
  await setMeta('last_backup_drive_file_id', fileId);
}

export async function restoreBackupNow(passphrase?: string): Promise<number> {
  const ownerId = getDatabaseOwner();
  const blob = await downloadLatestBackup(LATEST_FILENAME);
  assertDatabaseOwner(ownerId);
  if (!blob) throw new Error('No se encontro ninguna copia en Google Drive.');
  return restoreBackupFromBlob(blob, passphrase);
}

export async function createManualBackup(): Promise<{ blob: Blob; filename: string; passphrase: string }> {
  const ownerId = getDatabaseOwner();
  const passphrase = await ensurePassphrase();
  assertDatabaseOwner(ownerId);
  const blob = await createEncryptedBackupBlob(passphrase);
  assertDatabaseOwner(ownerId);
  const createdAt = new Date().toISOString().slice(0, 10);
  await setMeta('last_backup_at', new Date().toISOString());
  assertDatabaseOwner(ownerId);
  return { blob, filename: `${APP_CONFIG.backupPrefix}-backup-${createdAt}.json.enc`, passphrase };
}

export async function restoreManualBackup(blob: Blob, passphrase?: string): Promise<number> {
  return restoreBackupFromBlob(blob, passphrase);
}

async function createEncryptedBackupBlob(passphrase?: string): Promise<Blob> {
  const payload = await buildBackupPayload();
  const key = passphrase ?? await ensurePassphrase();
  assertDatabaseOwner(payload.user.supabaseUserId);
  const blob = await encrypt(payload, key);
  assertDatabaseOwner(payload.user.supabaseUserId);
  return blob;
}

async function restoreBackupFromBlob(blob: Blob, passphrase?: string): Promise<number> {
  const ownerId = getDatabaseOwner();
  const user = await getCurrentUser();
  assertDatabaseOwner(ownerId);
  if (!user) throw new Error('No hay sesión activa');
  assertDatabaseOwner(user.id);
  const cleanPassphrase = passphrase?.trim();
  const savedPassphrase = await getPassphrase();
  assertDatabaseOwner(user.id);
  const syncKey = await getLocalSecret(SYNC_KEY);
  assertDatabaseOwner(user.id);
  // Try the typed key first, then this device's backup key, then the recovery (sync) key.
  const candidates = [...new Set([cleanPassphrase, savedPassphrase, syncKey].filter((value): value is string => !!value))];

  if (candidates.length === 0) {
    throw new Error('No hay clave de respaldo guardada. Escribe la clave usada al crear el backup y vuelve a restaurar.');
  }

  let decrypted: object | null = null;
  let usedKey = '';
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      decrypted = await decrypt(blob, candidate);
      usedKey = candidate;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!decrypted) throw lastError;

  const payload = validateBackupPayload(decrypted, {
    userId: user.id,
    maxBackupVersion: BACKUP_VERSION,
    maxSchemaVersion: CURRENT_SCHEMA_VERSION,
  });

  assertDatabaseOwner(user.id);
  await replaceDatabaseContents(
    payload.data.procedures.map(procedure => migrateProcedureCatalog(procedure)),
    payload.data.stoneDetails ?? [],
    payload.data.personalProcedures,
  );
  assertDatabaseOwner(user.id);
  if (cleanPassphrase && usedKey === cleanPassphrase) await savePassphrase(cleanPassphrase);
  assertDatabaseOwner(user.id);
  await setMeta('last_restore_at', new Date().toISOString());
  assertDatabaseOwner(user.id);
  return payload.data.procedures.length;
}

export async function getLastBackupInfo(): Promise<BackupInfo> {
  const [lastBackupAt, driveFileId, lastRestoreAt] = await Promise.all([
    getMeta('last_backup_at'), getMeta('last_backup_drive_file_id'), getMeta('last_restore_at'),
  ]);
  return { lastBackupAt, driveFileId, lastRestoreAt };
}

export async function checkAndAutoBackup(): Promise<boolean> {
  const ownerId = getDatabaseOwner();
  if (!(await getBackupKeyStatus()).confirmed) return false;
  assertDatabaseOwner(ownerId);
  const lastBackupAt = await getMeta('last_backup_at');
  assertDatabaseOwner(ownerId);
  const lastDataChangedAt = await getMeta('last_data_changed_at');
  assertDatabaseOwner(ownerId);
  if (!lastDataChangedAt) return false;
  if (lastBackupAt && new Date(lastDataChangedAt).getTime() <= new Date(lastBackupAt).getTime()) return false;
  if (!lastBackupAt) { await createBackupNow(); return true; }
  const last = new Date(lastBackupAt).getTime();
  const hoursElapsed = (Date.now() - last) / (1000 * 60 * 60);
  if (hoursElapsed >= AUTO_BACKUP_INTERVAL_HOURS) { await createBackupNow(); return true; }
  return false;
}

export async function hasBackupAvailable(): Promise<{ found: boolean; date: string | null }> {
  const file = await findFileByName(LATEST_FILENAME).catch(() => null);
  return { found: !!file, date: file?.modifiedTime ?? null };
}
