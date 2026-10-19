import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updatePassword } from '../auth/authService';
import type { AuthUser } from '../lib/types';

interface ResetPasswordProps {
  onDone: (user: AuthUser) => void;
}

export default function ResetPassword({ onDone }: ResetPasswordProps) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const user = await updatePassword(password);
      setSuccess(true);
      onDone(user);
      setTimeout(() => navigate('/', { replace: true }), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>🔐</div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Nueva contraseña</h1>
        <p style={{ color: 'var(--text2)', marginBottom: 20, fontSize: 14 }}>
          Escribe una nueva contraseña para tu cuenta.
        </p>

        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
          {success && <div className="success-toast">Contraseña actualizada correctamente</div>}

          <div className="form-group">
            <label>Nueva contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required />
          </div>

          <div className="form-group">
            <label>Confirmar contraseña</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
            {loading ? 'Guardando...' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}
