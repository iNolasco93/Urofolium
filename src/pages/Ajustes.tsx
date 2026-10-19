import { type ChangeEvent, type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, updateAccountProfile } from '../auth/authService';
import {
  createBackupNow,
  createManualBackup,
  getBackupPassphrase,
  getLastBackupInfo,
  getOrCreateBackupPassphrase,
  migrateFromSupabase,
  restoreBackupNow,
  restoreManualBackup,
  updateBackupPassphrase,
} from '../backup/backupService';
import {
  clearGoogleTokens,
  connectGoogleDrive,
  ensureGoogleDriveAccess,
  getGoogleDriveConfigError,
  isGoogleSignedIn,
} from '../google/googleAuthService';
import type { AuthUser, BackupInfo } from '../lib/types';

type InfoSection = 'import' | 'manual-backup' | 'drive';

export default function Ajustes() {
  const navigate = useNavigate();
  const googleConfigError = getGoogleDriveConfigError();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleOk, setGoogleOk] = useState(false);
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [backupKey, setBackupKey] = useState('');
  const [showBackupKey, setShowBackupKey] = useState(false);
  const [restoreKey, setRestoreKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [residencyStartMonth, setResidencyStartMonth] = useState('');
  const [openInfo, setOpenInfo] = useState<InfoSection | null>(null);

  useEffect(() => {
    getCurrentUser().then(currentUser => {
      setUser(currentUser);
      setDisplayName(currentUser?.displayName ?? '');
      setResidencyStartMonth(currentUser?.residencyStartMonth ?? '');
    });
    isGoogleSignedIn().then(setGoogleOk);
    getBackupPassphrase().then(value => setBackupKey(value ?? ''));
    loadBackupInfo();
  }, []);

  const loadBackupInfo = async () => {
    const info = await getLastBackupInfo();
    setBackupInfo(info);
  };

  const refreshGoogleState = async () => {
    setGoogleOk(await isGoogleSignedIn());
  };

  const handleConnectGoogle = () => wrapAction(async () => {
    await connectGoogleDrive();
    await refreshGoogleState();
    return 'Google Drive conectado. Los backups en Drive se guardan cifrados.';
  });

  const handleDisconnectGoogle = async () => {
    await clearGoogleTokens();
    setGoogleOk(false);
  };

  const wrapAction = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMsg('');
    try {
      const successMsg = await action();
      setMsg(successMsg);
      await loadBackupInfo();
      await refreshGoogleState();
    } catch (err) {
      setMsg('Error: ' + (err instanceof Error ? err.message : 'accion no completada'));
    } finally {
      setBusy(false);
    }
  };

  const handleMigrate = () => wrapAction(async () => {
    const count = await migrateFromSupabase();
    if (count === 0) {
      return 'No se encontraron registros en Supabase para este usuario.';
    }
    return `Migrados ${count} registros desde Supabase. Te recomendamos hacer un backup ahora.`;
  });

  const handleSaveProfile = () => wrapAction(async () => {
    const updatedUser = await updateAccountProfile(displayName, residencyStartMonth);
    setUser(updatedUser);
    setDisplayName(updatedUser.displayName ?? '');
    setResidencyStartMonth(updatedUser.residencyStartMonth ?? '');
    return 'Perfil guardado correctamente.';
  });

  const handleShowBackupKey = () => wrapAction(async () => {
    const key = await getOrCreateBackupPassphrase();
    setBackupKey(key);
    setShowBackupKey(true);
    return 'Clave de respaldo lista. Guárdala fuera de la app para poder restaurar en otro dispositivo.';
  });

  const handleSaveBackupKey = () => wrapAction(async () => {
    await updateBackupPassphrase(backupKey);
    return 'Clave de respaldo guardada. Los próximos backups usarán esta clave.';
  });

  const handleExportManualBackup = () => wrapAction(async () => {
    if (backupKey.trim()) await updateBackupPassphrase(backupKey);
    const { blob, filename, passphrase } = await createManualBackup();
    setBackupKey(passphrase);
    setShowBackupKey(true);
    downloadBlob(blob, filename);
    return 'Backup cifrado descargado. Guarda también la clave de respaldo.';
  });

  const handleRestoreManualBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    wrapAction(async () => {
      const count = await restoreManualBackup(file, restoreKey || backupKey || undefined);
      return `Backup restaurado correctamente: ${count} procedimientos.`;
    });
  };

  const handleCreateGoogleBackup = () => wrapAction(async () => {
    await ensureGoogleDriveAccess();
    await createBackupNow();
    return 'Backup cifrado guardado en Google Drive.';
  });

  const handleRestoreGoogleBackup = () => wrapAction(async () => {
    await ensureGoogleDriveAccess();
    const count = await restoreBackupNow(restoreKey || backupKey || undefined);
    return `Restauración completada desde Google Drive: ${count} procedimientos.`;
  });

  const toggleInfo = (section: InfoSection) => {
    setOpenInfo(current => current === section ? null : section);
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <h2 style={{ marginBottom: 20, fontSize: 20 }}>Ajustes</h2>

      {msg && <div style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: msg.startsWith('Error') ? '#fdecea' : '#e6f4ea', color: msg.startsWith('Error') ? '#d93025' : '#137333' }}>{msg}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Cuenta Supabase</h3>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 8 }}>Sesión activa como: <strong>{user?.email}</strong></p>
        <label style={{ fontSize: 13 }}>Nombre para mostrar</label>
        <input
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
          placeholder="Ej. Ivan"
          autoComplete="name"
        />
        <label style={{ fontSize: 13, display: 'block', marginTop: 12 }}>Inicio de residencia</label>
        <input
          type="month"
          value={residencyStartMonth}
          onChange={event => setResidencyStartMonth(event.target.value)}
          placeholder="YYYY-MM"
        />
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
          Se usara para calcular R1-R5 en Estadisticas. Ej. Mayo 2023 clasifica R1 como 05/23 - 04/24.
        </p>
        <button className="btn-ghost" onClick={handleSaveProfile} disabled={busy || displayName.trim().length < 2} style={{ marginTop: 10 }}>
          Guardar perfil
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Migración de datos (una vez)</h3>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>Descarga tus cirugías antiguas del servidor a la base de datos local del móvil.</p>
        <button className="btn-primary" onClick={handleMigrate} disabled={busy}>
          {busy ? 'Importando...' : 'Importar datos desde Supabase'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <InfoHeader
          title="Importar Excel o CSV"
          isOpen={openInfo === 'import'}
          onToggle={() => toggleInfo('import')}
        />
        {openInfo === 'import' && (
          <InfoPanel>
            <p>
              Usa esta opción para cargar registros desde una tabla Excel o CSV directamente al almacenamiento local del dispositivo.
            </p>
            <ol>
              <li>Descarga el modelo desde la pantalla de importación para respetar nombres de columnas y valores válidos.</li>
              <li>Introduce una cirugía por fila y evita nombres, NHC, fechas de nacimiento u otros datos identificativos.</li>
              <li>La columna ayudante se interpreta según tu rol en cada cirugía.</li>
              <li>Antes de guardar, revisa la vista previa para confirmar si se crearán registros nuevos o se actualizarán registros existentes.</li>
            </ol>
          </InfoPanel>
        )}
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>Carga una tabla local y guarda sus filas directamente en el almacenamiento local del dispositivo.</p>
        <button className="btn-primary" onClick={() => navigate('/importar')} disabled={busy}>Abrir importador local</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <InfoHeader
          title="Backup cifrado manual"
          isOpen={openInfo === 'manual-backup'}
          onToggle={() => toggleInfo('manual-backup')}
        />
        {openInfo === 'manual-backup' && (
          <InfoPanel>
            <p>
              El backup manual crea un archivo cifrado que puedes guardar fuera de la app y restaurar en otro navegador o dispositivo.
            </p>
            <ol>
              <li>Crea o guarda una clave de respaldo antes de exportar.</li>
              <li>Descarga el archivo cifrado y consérvalo junto con la clave en un lugar seguro.</li>
              <li>Para restaurar, selecciona el archivo y escribe la misma clave usada al crearlo.</li>
            </ol>
            <p>
              La clave no se guarda dentro del archivo. Si se pierde, el backup no podrá descifrarse.
            </p>
          </InfoPanel>
        )}
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
          Opción universal para Google Drive, iCloud, Dropbox o cualquier carpeta: descarga un archivo cifrado y restaúralo en otro dispositivo.
        </p>

        <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>Clave de respaldo</label>
          <input
            type={showBackupKey ? 'text' : 'password'}
            value={backupKey}
            onChange={event => setBackupKey(event.target.value)}
            placeholder="Crea o pega una clave de al menos 12 caracteres"
            autoComplete="off"
          />
          <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
            Sin esta clave no podrás descifrar el backup en otro navegador o dispositivo.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn-ghost" onClick={handleShowBackupKey} disabled={busy}>
            {showBackupKey ? 'Clave visible' : 'Mostrar/crear clave'}
          </button>
          <button className="btn-ghost" onClick={() => setShowBackupKey(value => !value)} disabled={busy || !backupKey}>
            {showBackupKey ? 'Ocultar clave' : 'Ver clave'}
          </button>
          <button className="btn-ghost" onClick={handleSaveBackupKey} disabled={busy || !backupKey.trim()}>
            Guardar clave
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn-primary" onClick={handleExportManualBackup} disabled={busy}>
            Exportar backup cifrado
          </button>
          <label className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
            Restaurar archivo
            <input type="file" accept=".enc,application/octet-stream" onChange={handleRestoreManualBackup} style={{ display: 'none' }} disabled={busy} />
          </label>
        </div>

        <label style={{ fontSize: 13 }}>Clave para restaurar, si es distinta</label>
        <input
          type="password"
          value={restoreKey}
          onChange={event => setRestoreKey(event.target.value)}
          placeholder="Opcional: clave usada al crear ese backup"
          autoComplete="off"
        />
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
          En un navegador nuevo, pega aquí la clave original del dispositivo donde se creó el backup.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <InfoHeader
          title="Google Drive (Backups)"
          isOpen={openInfo === 'drive'}
          onToggle={() => toggleInfo('drive')}
        />
        {openInfo === 'drive' && (
          <InfoPanel>
            <p>
              Google Drive permite guardar y recuperar copias cifradas desde la carpeta privada de la app. Drive conserva el archivo, pero no conoce ni guarda tu clave de respaldo.
            </p>
            <ol>
              <li>Conecta tu cuenta de Google y autoriza el acceso solicitado por UroFolium.</li>
              <li>Antes de crear una copia, asegúrate de tener guardada tu clave de respaldo.</li>
              <li>Crear copia ahora sube un backup cifrado; restaurar copia recupera la última copia disponible en Drive.</li>
              <li>Usa renovar acceso si la sesión caduca y desconectar Drive si quieres retirar el acceso en este dispositivo.</li>
            </ol>
            <p>
              <strong>Si Google indica que no tienes acceso como tester:</strong> contacta con el responsable del despliegue para solicitar autorización. Cuando tu cuenta esté autorizada, vuelve a intentar la conexión desde esta sección.
            </p>
            <p>
              <strong>Si Google indica que la aplicación no está verificada:</strong> continúa únicamente si reconoces UroFolium y estás usando el enlace oficial.
            </p>
          </InfoPanel>
        )}
        {googleConfigError ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>{googleConfigError}</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 0 }}>
              Crea un OAuth Client ID web en Google Cloud y añade el valor en Vercel como VITE_GOOGLE_CLIENT_ID.
            </p>
          </div>
        ) : googleOk ? (
          <div>
            <p style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 'bold', marginBottom: 12 }}>✓ Sesión activa con Google Drive</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
              Si hay cambios, la app intentará crear una copia automática diaria mientras esta sesión siga activa.
            </p>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
              Para restaurar en otro navegador o dispositivo, escribe antes la misma clave de respaldo usada al crear la copia.
            </p>

            <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 13, margin: 0 }}>Último backup creado: {backupInfo?.lastBackupAt ? new Date(backupInfo.lastBackupAt).toLocaleString() : 'Nunca'}</p>
              <p style={{ fontSize: 13, margin: '4px 0 0' }}>Última restauración: {backupInfo?.lastRestoreAt ? new Date(backupInfo.lastRestoreAt).toLocaleString() : 'Nunca'}</p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={handleCreateGoogleBackup} disabled={busy}>Crear copia ahora</button>
              <button className="btn-ghost" onClick={handleRestoreGoogleBackup} disabled={busy}>Restaurar copia</button>
              <button className="btn-ghost" onClick={handleConnectGoogle} disabled={busy}>Renovar acceso</button>
            </div>

            <button className="btn-ghost" onClick={handleDisconnectGoogle} disabled={busy} style={{ color: 'var(--danger)', marginTop: 16, padding: 0 }}>Desconectar Drive</button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
              Conecta tu cuenta de Google para guardar copias cifradas en la carpeta privada de la app. Si el acceso caduca, podrás renovarlo desde aquí.
            </p>
            <button className="btn-primary" onClick={handleConnectGoogle} disabled={busy}>Conectar Google Drive</button>
          </div>
        )}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function InfoHeader({
  title,
  isOpen,
  onToggle,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="info-header">
      <h3 style={{ fontSize: 16 }}>{title}</h3>
      <button
        type="button"
        className="info-button"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        {isOpen ? 'Ocultar' : 'Información'}
      </button>
    </div>
  );
}

function InfoPanel({ children }: { children: ReactNode }) {
  return <div className="info-panel">{children}</div>;
}
