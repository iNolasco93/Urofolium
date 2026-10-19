import { getValidAccessToken } from './googleAuthService';
import { assertDatabaseOwner, getDatabaseOwner } from '../db/database';

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const APP_DATA_FOLDER = 'appDataFolder';

export interface DriveFile { id: string; name: string; modifiedTime: string; size: string; }

async function getHeaders(): Promise<HeadersInit> {
  const ownerId = getDatabaseOwner();
  const token = await getValidAccessToken();
  assertDatabaseOwner(ownerId);
  return { Authorization: `Bearer ${token}` };
}

async function getDriveError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) {
    return new Error('Google Drive pidio renovar acceso. Vuelve a conectar Google Drive en Ajustes.');
  }
  if (res.status === 403) {
    return new Error('Google Drive no autorizo esta operacion. Revisa que el OAuth tenga permiso drive.appdata.');
  }

  try {
    const json = await res.json();
    const message = json?.error?.message as string | undefined;
    if (message) return new Error(`${fallback}: ${message}`);
  } catch {}

  return new Error(`${fallback}: ${res.status}`);
}

export async function listBackupFiles(): Promise<DriveFile[]> {
  const headers = await getHeaders();
  const params = new URLSearchParams({
    spaces: APP_DATA_FOLDER, fields: 'files(id,name,modifiedTime,size)',
    q: "name contains '.enc'", orderBy: 'modifiedTime desc',
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${params}`, { headers });
  if (!res.ok) throw await getDriveError(res, 'Error listando Drive');
  const json = await res.json();
  return json.files ?? [];
}

export async function findFileByName(name: string): Promise<DriveFile | null> {
  const headers = await getHeaders();
  const params = new URLSearchParams({
    spaces: APP_DATA_FOLDER, fields: 'files(id,name,modifiedTime,size)', q: `name = '${name}'`,
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${params}`, { headers });
  if (!res.ok) throw await getDriveError(res, 'Error buscando en Drive');
  const json = await res.json();
  return json.files?.[0] ?? null;
}

export async function uploadFileToDrive(blob: Blob, filename: string): Promise<string> {
  const ownerId = getDatabaseOwner();
  const headers = await getHeaders();
  assertDatabaseOwner(ownerId);
  const existing = await findFileByName(filename);
  assertDatabaseOwner(ownerId);

  if (existing) {
    const res = await fetch(`${DRIVE_UPLOAD_URL}/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) throw await getDriveError(res, 'Error actualizando backup');
    const json = await res.json();
    return json.id;
  } else {
    const metadata = JSON.stringify({ name: filename, parents: [APP_DATA_FOLDER], mimeType: 'application/octet-stream' });
    const form = new FormData();
    form.append('metadata', new Blob([metadata], { type: 'application/json' }));
    form.append('file', blob);
    const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, { method: 'POST', headers, body: form });
    if (!res.ok) throw await getDriveError(res, 'Error creando backup');
    const json = await res.json();
    return json.id;
  }
}

export async function downloadFileById(fileId: string): Promise<Blob> {
  const headers = await getHeaders();
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, { headers });
  if (!res.ok) throw await getDriveError(res, 'Error descargando backup');
  return res.blob();
}

export async function downloadLatestBackup(filename: string): Promise<Blob | null> {
  const ownerId = getDatabaseOwner();
  const file = await findFileByName(filename);
  assertDatabaseOwner(ownerId);
  if (!file) return null;
  return downloadFileById(file.id);
}

export async function deleteFileFromDrive(fileId: string): Promise<void> {
  const headers = await getHeaders();
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}`, { method: 'DELETE', headers });
  if (!res.ok) throw await getDriveError(res, 'Error eliminando backup antiguo');
}

export async function rotateWeeklyBackup(blob: Blob, prefix = 'urofolium'): Promise<void> {
  const ownerId = getDatabaseOwner();
  const now = new Date();
  const year = now.getFullYear();
  const week = getISOWeek(now);
  const weeklyName = `${prefix}-backup-${year}-W${String(week).padStart(2, '0')}.json.enc`;

  await uploadFileToDrive(blob, weeklyName);
  assertDatabaseOwner(ownerId);

  const files = await listBackupFiles();
  assertDatabaseOwner(ownerId);
  const weeklyPattern = new RegExp(`^${escapeRegExp(prefix)}-backup-\\d{4}-W\\d{2}\\.json\\.enc$`);
  const weeklyFiles = files.filter(f => weeklyPattern.test(f.name))
    .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));

  const toDelete = weeklyFiles.slice(4);
  for (const f of toDelete) {
    assertDatabaseOwner(ownerId);
    await deleteFileFromDrive(f.id);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
