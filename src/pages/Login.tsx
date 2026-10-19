import { useState } from 'react';
import { requestPasswordReset, signIn, signUp } from '../auth/authService';
import { APP_CONFIG } from '../config/appConfig';
import type { AuthUser } from '../lib/types';
import SafetyNotice from '../components/SafetyNotice';

interface LoginProps { onLogin: (user: AuthUser) => void; }

type AuthMode = 'login' | 'signup' | 'reset';

const AUTH_TABS: { mode: AuthMode; label: string }[] = [
  { mode: 'login', label: 'Entrar' },
  { mode: 'signup', label: 'Crear cuenta' },
];

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setMessage('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleLogin = async () => {
    const user = await signIn(email.trim(), password);
    onLogin(user);
  };

  const handleSignUp = async () => {
    if (password !== confirmPassword) {
      throw new Error('Las contraseñas no coinciden.');
    }

    const user = await signUp(email.trim(), password, fullName);
    if (user) {
      onLogin(user);
      return;
    }

    setMessage('Cuenta creada. Revisa tu email para confirmar el acceso antes de entrar.');
    setPassword('');
    setConfirmPassword('');
  };

  const handleReset = async () => {
    await requestPasswordReset(email.trim());
    setMessage('Te hemos enviado un enlace para crear una nueva contraseña si el correo está registrado.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'login') await handleLogin();
      if (mode === 'signup') await handleSignUp();
      if (mode === 'reset') await handleReset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la operación');
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'login'
    ? 'Entrar'
    : mode === 'signup' ? 'Crear cuenta' : 'Recuperar contraseña';
  const submitLabel = loading
    ? 'Procesando...'
    : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🩺</div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>{APP_CONFIG.appName}</h1>
        <p style={{ color: 'var(--text2)', marginBottom: 20, fontSize: 14 }}>{APP_CONFIG.description} (Local-first)</p>

        {mode !== 'reset' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {AUTH_TABS.map(tab => (
              <button
                type="button"
                key={tab.mode}
                className={mode === tab.mode ? 'btn-primary' : 'btn-ghost'}
                onClick={() => switchMode(tab.mode)}
                style={{ padding: '8px 10px' }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          <h2 style={{ fontSize: 18, marginBottom: 14, textAlign: 'center' }}>{title}</h2>

          {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
          {message && <div className="success-toast">{message}</div>}

          {mode === 'signup' && (
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, textAlign: 'center' }}>
              Recomendación: si vas a usar Google Drive, crea la cuenta con Gmail o con la misma cuenta de Google que usarás para las copias. La contraseña de {APP_CONFIG.appName} es independiente.
            </p>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label>Nombre</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required />
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
          </div>

          {(mode === 'login' || mode === 'signup') && (
            <div className="form-group">
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
              />
            </div>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label>Confirmar contraseña</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
            {submitLabel}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => switchMode('reset')}
              style={{ width: '100%', marginTop: 10 }}
            >
              Olvidé mi contraseña
            </button>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => switchMode('login')}
              style={{ width: '100%', marginTop: 10 }}
            >
              Volver a entrar
            </button>
          )}
        </form>

        <div style={{ marginTop: 18 }}>
          <SafetyNotice compact />
        </div>
      </div>
    </div>
  );
}
