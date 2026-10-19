import { useMemo, useState } from 'react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

export default function AuthConfirm() {
  const confirmationUrl = useMemo(getConfirmationUrl, []);
  const [error, setError] = useState('');

  const handleContinue = () => {
    if (!confirmationUrl) {
      setError('Este enlace no contiene una confirmacion valida.');
      return;
    }

    window.location.assign(confirmationUrl);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Confirmar acceso</h1>
        <p style={{ color: 'var(--text2)', marginBottom: 20, fontSize: 14 }}>
          Pulsa continuar para validar tu enlace y crear tu contraseña.
        </p>

        {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <button type="button" className="btn-primary" onClick={handleContinue} style={{ width: '100%' }}>
          Continuar
        </button>
      </div>
    </div>
  );
}

function getConfirmationUrl(): string {
  const currentUrl = new URL(window.location.href);
  const rawConfirmationUrl = currentUrl.searchParams.get('confirmation_url');
  if (!rawConfirmationUrl) return '';

  try {
    const confirmationUrl = new URL(rawConfirmationUrl);
    const expectedOrigin = new URL(supabaseUrl).origin;
    if (confirmationUrl.origin !== expectedOrigin) return '';

    currentUrl.searchParams.forEach((value, key) => {
      if (key !== 'confirmation_url' && !confirmationUrl.searchParams.has(key)) {
        confirmationUrl.searchParams.set(key, value);
      }
    });
    return confirmationUrl.toString();
  } catch {
    return '';
  }
}
