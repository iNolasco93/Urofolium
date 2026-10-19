import { Capacitor } from '@capacitor/core';
import { getCurrentUser, fetchSupabaseProcedures } from '../auth/authService';
import { getAllProcedures, upsertProcedures } from '../db/procedureRepository';
import { getAllStoneDetails } from '../db/stoneRepository';
import { assertDatabaseOwner, getDatabaseOwner, replaceDatabaseContents } from '../db/database';
import { CURRENT_SCHEMA_VERSION } from '../db/migrations';
import { getMeta, setMeta } from '../db/metaRepository';
import { encrypt, decrypt, getPassphrase, savePassphrase, generatePassphrase } from './cryptoService';
import { uploadFileToDrive, downloadLatestBackup, rotateWeeklyBackup, findFileByName } from '../google/driveService';
import { APP_CONFIG } from '../config/appConfig';
import { validateBackupPayload } from './backupValidation';
import type { BackupPayload, BackupInfo, Procedure } from '../lib/types';

const APP_VERSION = '1.0.0';
const BACKUP_VERSION = 3;
const LATEST_FILENAME = `${APP_CONFIG.backupPrefix}-backup-latest.json.enc`;
const AUTO_BACKUP_INTERVAL_HOURS = 24;

async function ensurePassphrase(): Promise<string> {
  const ownerId = getDatabaseOwner();
  let pass = await getPassphrase();
  assertDatabaseOwner(ownerId);
  if (!pass) {
    pass = generatePassphrase();
    await savePassphrase(pass);
    assertDatabaseOwner(ownerId);
  }
  return pass;
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
  const procedures = await getAllProcedures();
  assertDatabaseOwner(user.id);
  const procedureIds = new Set(procedures.map(procedure => procedure.id));
  const stoneDetails = (await getAllStoneDetails()).filter(details => procedureIds.has(details.procedure_id));
  assertDatabaseOwner(user.id);
  const deviceLabel = (await getMeta('device_label')) ?? 'Desconocido';
  assertDatabaseOwner(user.id);
  return {
    app: 'UroFolium', backupVersion: BACKUP_VERSION, createdAt: new Date().toISOString(),
    user: { supabaseUserId: user.id, email: user.email },
    device: { platform: Capacitor.getPlatform(), appVersion: APP_VERSION, label: deviceLabel },
    schema: { version: CURRENT_SCHEMA_VERSION }, data: { procedures, stoneDetails },
  };
}

export async function createBackupNow(): Promise<void> {
  const ownerId = getDatabaseOwner();
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
  const passphraseToUse = cleanPassphrase || savedPassphrase;

  if (!passphraseToUse) {
    throw new Error('No hay clave de respaldo guardada. Escribe la clave usada al crear el backup y vuelve a restaurar.');
  }

  const payload = validateBackupPayload(await decrypt(blob, passphraseToUse), {
    userId: user.id,
    maxBackupVersion: BACKUP_VERSION,
    maxSchemaVersion: CURRENT_SCHEMA_VERSION,
  });

  assertDatabaseOwner(user.id);
  await replaceDatabaseContents(payload.data.procedures, payload.data.stoneDetails ?? []);
  assertDatabaseOwner(user.id);
  if (cleanPassphrase) await savePassphrase(cleanPassphrase);
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

export async function migrateFromSupabase(): Promise<number> {
  const ownerId = getDatabaseOwner();
  const rows = await fetchSupabaseProcedures();
  assertDatabaseOwner(ownerId);
  const mapped: Procedure[] = rows.map((r: unknown) => {
    const row = r as Record<string, unknown>;
    const now = new Date().toISOString();
    return {
      id: (row.id as string) ?? crypto.randomUUID(),
      fecha: (row.fecha as string) ?? now.slice(0, 10),
      categoria: (row.categoria as string) ?? '',
      procedimiento: (row.procedimiento as string) ?? '',
      abordaje: (row.abordaje as string) ?? '',
      duracion: row.duracion != null ? Number(row.duracion) : null,
      rol: (row.rol as string) ?? '',
      cirujano_senior: (row.cirujano_senior as string) ?? null,
      primer_ayudante: (row.primer_ayudante as string) ?? null,
      segundo_ayudante: (row.segundo_ayudante as string) ?? null,
      complicaciones: (row.complicaciones as string) ?? null,
      otro_especificar: (row.otro_especificar as string) ?? null,
      created_at: (row.created_at as string) ?? now,
      updated_at: (row.updated_at as string) ?? now,
      deleted_at: null,
    };
  });
  await upsertProcedures(mapped);
  assertDatabaseOwner(ownerId);
  return mapped.length;
}
