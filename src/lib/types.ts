// ─── Procedimiento quirúrgico ───────────────────────────────────────────────
export interface Procedure {
  id: string;
  fecha: string;                  // YYYY-MM-DD
  categoria: string;
  procedimiento: string;
  abordaje: string;
  duracion: number | null;        // minutos
  rol: string;
  cirujano_senior: string | null;
  primer_ayudante: string | null;
  segundo_ayudante: string | null;
  complicaciones: string | null;
  otro_especificar: string | null;
  created_at: string;             // ISO 8601
  updated_at: string;             // ISO 8601
  deleted_at: string | null;      // ISO 8601 or null (soft delete)
}

// ─── Detalles específicos de litiasis ──────────────────────────────────────
export interface StoneProcedureRaw {
  urs: boolean;
  rirs: boolean;
  nlpc: boolean;
}

export interface StoneDetails {
  procedure_id: string;
  lateralidad: string | null;
  procedimiento_raw: StoneProcedureRaw;
  nefromax_fr: number | null;
  amplatz_fr: number | null;
  enhebrado: boolean;
  tamanio_mm: number | null;
  tutor_interno: string | null;
  drenaje_nefrostomico: string | null;
  sonda_fr: number | null;
  etiqueta_drenaje: string | null;
  stonefree: boolean | null;
  created_at: string;
  updated_at: string;
}

// ─── Metadatos de la app ────────────────────────────────────────────────────
export type MetaKey =
  | 'schema_version'
  | 'last_backup_at'
  | 'last_backup_drive_file_id'
  | 'last_restore_at'
  | 'device_label'
  | 'last_data_changed_at';

// ─── Formato del archivo de backup ──────────────────────────────────────────
export interface BackupPayload {
  app: 'UroFolium';
  backupVersion: number;
  createdAt: string;
  user: {
    supabaseUserId: string;
    email: string;
  };
  device: {
    platform: string;
    appVersion: string;
    label: string;
  };
  schema: {
    version: number;
  };
  data: {
    procedures: Procedure[];
    stoneDetails?: StoneDetails[];
  };
}

// ─── Estado de autenticación ────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  residencyStartMonth: string | null; // YYYY-MM
}

// ─── Info de backup ─────────────────────────────────────────────────────────
export interface BackupInfo {
  lastBackupAt: string | null;
  driveFileId: string | null;
  lastRestoreAt: string | null;
}
