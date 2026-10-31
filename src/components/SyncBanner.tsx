import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { acknowledgeSyncKey, resolveConflict, setSyncKey, syncNow, useSyncStatus } from '../sync/syncManager';
import { describeSyncValue } from '../sync/syncVariant';

export default function SyncBanner() {
  const status = useSyncStatus();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(task: () => Promise<void>) {
    setBusy(true); setError('');
    try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar la acción.'); }
    finally { setBusy(false); }
  }
  const pair = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => { await setSyncKey(key); setKey(''); });
  };
  if (status.phase === 'idle' || status.phase === 'checking' || (status.phase === 'ready' && status.keySaved)) return null;
  return (
    <div className="card" role="status" style={{ borderLeft: '4px solid var(--primary)', marginBottom: 16 }}>
      <strong>{status.phase === 'needs-key' ? 'Vincular este dispositivo' : status.phase === 'conflict' ? 'Revisar cambios entre dispositivos' : status.phase === 'error' ? 'Sincronización pendiente' : 'Guarda tu clave de sincronización'}</strong>
      <p style={{ fontSize: 13, margin: '8px 0' }}>{status.phase === 'ready' ? 'La clave está en Ajustes. Guárdala para poder vincular otros dispositivos o recuperar la copia sincronizada.' : status.message}</p>
      {status.phase === 'needs-key' && <form onSubmit={pair}>
        <label htmlFor="sync-pair-key">Clave de sincronización</label>
        <input id="sync-pair-key" type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" minLength={12} required />
        <button className="btn-primary" disabled={busy} style={{ marginTop: 8 }}>{busy ? 'Vinculando…' : 'Vincular dispositivo'}</button>
      </form>}
      {status.phase === 'conflict' && status.conflicts.map(conflict => <div key={JSON.stringify([conflict.channel, conflict.id])} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        {conflict.caseLabel && <p style={{ fontWeight: 600 }}>{conflict.caseLabel}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {(['local', 'remote'] as const).map(side => <div key={side}>
            <strong>{side === 'local' ? 'Este dispositivo' : 'Versión sincronizada'}</strong>
            <dl style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              {describeSyncValue(conflict[side]).map(([label, value]) => <div key={label} style={{ marginBottom: 6 }}>
                <dt style={{ fontWeight: 600 }}>{label}</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{value}</dd>
              </div>)}
            </dl>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void action(() => resolveConflict(conflict.channel, conflict.id, side))}>
              {side === 'local' ? 'Conservar este' : 'Conservar el sincronizado'}
            </button>
          </div>)}
        </div>
      </div>)}
      {status.phase === 'error' && <button className="btn-ghost" disabled={busy} onClick={() => void action(syncNow)}>Reintentar</button>}
      {status.phase === 'ready' && <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Link to="/ajustes">Ver clave en Ajustes</Link>
        <button className="btn-ghost" onClick={acknowledgeSyncKey}>Ya la he guardado</button>
      </div>}
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
