import { useEffect, useRef, useState, type FormEvent } from 'react';
import { initDatabase, inspectLocalData, isDatabaseOpenFor, lockDatabase } from '../db/database';
import { signOut } from '../auth/authService';
import type { AuthUser } from '../lib/types';

interface Props { user: AuthUser; onOpen: () => void; onLogout: () => void; }

export default function LocalDataGate({ user, onOpen, onLogout }: Props) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof inspectLocalData>> | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [migrate, setMigrate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    inspectLocalData(user.id).then(value => { if (mounted.current) setStatus(value); })
      .catch(err => { if (mounted.current) setError(err instanceof Error ? err.message : 'No se pudo abrir el almacenamiento local.'); });
    return () => { mounted.current = false; };
  }, [user.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status || busy) return;
    setError('');
    if (status.needsPassphrase && !status.exists && passphrase !== confirmation) {
      setError('Las claves locales no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await initDatabase(user.id, passphrase, migrate);
      if (!mounted.current || !isDatabaseOpenFor(user.id)) return;
      setPassphrase('');
      setConfirmation('');
      onOpen();
    } catch (err) {
      if (!mounted.current) return;
      lockDatabase();
      setError(err instanceof Error ? err.message : 'No se pudieron abrir los datos.');
      setStatus(await inspectLocalData(user.id));
    } finally { if (mounted.current) setBusy(false); }
  };

  const exit = async () => {
    lockDatabase();
    onLogout();
    await signOut();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 500 }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Tus registros en este dispositivo</h1>
        <p style={{ overflowWrap: 'anywhere', marginBottom: 16 }}>{user.email}</p>
        {error && <p role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}
        {!status ? <p>Comprobando almacenamiento…</p> : (
          <form onSubmit={submit}>
            {status.needsPassphrase ? (
              <>
                <p style={{ color: 'var(--text2)', marginBottom: 16 }}>
                  {status.exists
                    ? 'Introduce tu clave local para desbloquear tus registros cifrados.'
                    : 'Crea una clave local de al menos 12 caracteres para cifrar tus registros. Esta clave es independiente de la contraseña de tu cuenta y de la clave de respaldo.'}
                </p>
                <div className="form-group">
                  <label htmlFor="local-passphrase">Clave local</label>
                  <input id="local-passphrase" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} autoComplete={status.exists ? 'current-password' : 'new-password'} minLength={status.exists ? undefined : 12} required disabled={busy} />
                </div>
                {!status.exists && (
                  <div className="form-group">
                    <label htmlFor="local-confirmation">Repite la clave local</label>
                    <input id="local-confirmation" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" required disabled={busy} />
                  </div>
                )}
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
                  Guarda la clave en tu gestor de contraseñas. Se pedirá al volver a abrir la app y la app no la guarda. Si la pierdes, necesitarás una copia de seguridad y su clave para recuperar los registros en otro navegador o dispositivo.
                </p>
              </>
            ) : <p style={{ marginBottom: 16 }}>Tus registros se guardarán cifrados y separados por cuenta. La clave se protege con el almacenamiento seguro del dispositivo.</p>}
            {status.legacyAvailable && (
              <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
                <p style={{ marginBottom: 10 }}>Hay registros de una versión anterior sin cuenta asignada. Solo debes importarlos si son tuyos.</p>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={migrate} onChange={e => setMigrate(e.target.checked)} disabled={busy} style={{ width: 'auto', marginTop: 4 }} />
                  Confirmo que esos registros me pertenecen y quiero trasladarlos a esta cuenta.
                </label>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 10 }}>Si no marcas la casilla, se conservan pendientes de asignar. Al importarlos, se comprueba la copia cifrada antes de retirar el almacenamiento antiguo.</p>
              </div>
            )}
            <button className="btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Protegiendo tus datos…' : status.needsPassphrase ? status.exists ? 'Desbloquear registros' : 'Crear almacenamiento cifrado' : 'Abrir mis registros'}
            </button>
          </form>
        )}
        <button className="btn-ghost" type="button" onClick={exit} disabled={busy} style={{ width: '100%', marginTop: 12 }}>Salir de esta cuenta</button>
      </div>
    </div>
  );
}
