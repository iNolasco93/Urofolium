import { useState } from 'react';
import { getSyncKey, syncNow, useSyncStatus } from '../sync/syncManager';

export default function SyncSettings() {
  const status = useSyncStatus();
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const labels = { idle: 'Sin iniciar', checking: 'Sincronizando…', ready: 'Al día', 'needs-key': 'Falta vincular este dispositivo', conflict: 'Hay cambios que revisar', error: 'Pendiente' };
  return <div className="card" style={{ marginBottom: 20 }}>
    <h3 style={{ fontSize: 16, marginBottom: 12 }}>Sincronización cifrada</h3>
    <p style={{ fontSize: 13 }}>Tus casos se sincronizan entre dispositivos de la misma cuenta. Cada cirugía viaja con sus detalles de litiasis. Puedes registrar sin conexión y sincronizar al recuperarla.</p>
    <p style={{ fontSize: 13, margin: '10px 0' }}><strong>Estado:</strong> {labels[status.phase]}{status.lastSyncedAt ? ` · ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}</p>
    {status.phase === 'error' && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{status.message}</p>}
    <p style={{ fontSize: 13 }}>En otro dispositivo, inicia sesión, abre el almacenamiento local e introduce una vez esta clave de sincronización. Es distinta de la contraseña de acceso, la clave local y la clave de respaldo.</p>
    <p style={{ fontSize: 13, margin: '10px 0' }}>Guárdala en tu gestor de contraseñas. Si pierdes la clave y todos los dispositivos vinculados, necesitarás un backup independiente para recuperar los registros.</p>
    {key && <input aria-label="Clave de sincronización" type={visible ? 'text' : 'password'} value={key} readOnly autoComplete="off" style={{ marginBottom: 8 }} />}
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button className="btn-ghost" type="button" onClick={async () => {
        setError('');
        if (visible) { setVisible(false); setKey(''); return; }
        try {
          const value = await getSyncKey();
          if (!value) throw new Error('Sincroniza primero este dispositivo o vincúlalo con la clave original.');
          setKey(value); setVisible(true);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo leer la clave.'); }
      }}>{visible ? 'Ocultar clave' : 'Mostrar clave'}</button>
      <button className="btn-primary" type="button" disabled={status.phase === 'checking'} onClick={() => void syncNow()}>Sincronizar ahora</button>
    </div>
    {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
    <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 12 }}>La sincronización funciona mientras la aplicación está abierta e incluye los borrados. Mantén también tus copias cifradas de seguridad. Al restaurar una copia antigua, los casos que falten se recuperarán del diario sincronizado; los cambios simultáneos incompatibles requerirán revisión.</p>
  </div>;
}
