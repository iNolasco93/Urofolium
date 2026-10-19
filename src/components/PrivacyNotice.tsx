import SafetyNotice from './SafetyNotice';
import { APP_CONFIG } from '../config/appConfig';

interface PrivacyNoticeProps {
  onAccept: () => void;
}

export default function PrivacyNotice({ onAccept }: PrivacyNoticeProps) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 540 }}>
        <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 8 }}>{APP_CONFIG.appName}</div>
        <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 18 }}>
          Antes de empezar, confirma estas normas de uso.
        </p>

        <div style={{ marginBottom: 20 }}>
          <SafetyNotice />
        </div>

        <button className="btn-primary" style={{ width: '100%' }} onClick={onAccept}>
          Entiendo y continuar
        </button>
      </div>
    </div>
  );
}
