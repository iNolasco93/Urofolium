import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, Navigate, Link } from 'react-router-dom';
import { assertDatabaseOwner, getDatabaseOwner, isDatabaseOpenFor, isWebDatabase, lockDatabase, mergeDatabaseContents } from './db/database';
import LocalDataGate from './components/LocalDataGate';
import { getCurrentUser, onAuthChange } from './auth/authService';
import { getAllProcedures, isDatabaseEmpty } from './db/procedureRepository';
import { isGoogleSignedIn } from './google/googleAuthService';
import { hasBackupAvailable, checkAndAutoBackup } from './backup/backupService';
import { APP_CONFIG } from './config/appConfig';
import { getAutomaticCatalogMigrationUpdates } from './lib/migrationReview';
import type { AuthUser } from './lib/types';

import Layout from './components/Layout';
import PrivacyNotice from './components/PrivacyNotice';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Nuevo from './pages/Nuevo';
import Listado from './pages/Listado';
import Estadisticas from './pages/Estadisticas';
import Ajustes from './pages/Ajustes';
import Importar from './pages/Importar';
import ResetPassword from './pages/ResetPassword';
import AuthConfirm from './pages/AuthConfirm';

type RestoreOffer = { date: string } | null;

export default function App() {
  const [user, updateUser] = useState<AuthUser | null>(null);
  const userId = useRef<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [restoreOffer, setRestoreOffer] = useState<RestoreOffer>(null);
  const [passwordSetupMode, setPasswordSetupMode] = useState(() => hasPasswordSetupLink());
  const [privacyAccepted, setPrivacyAccepted] = useState(() => (
    localStorage.getItem(APP_CONFIG.privacyAcceptedKey) === 'true'
  ));

  useEffect(() => {
    document.title = APP_CONFIG.appName;
    document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.setAttribute('content', APP_CONFIG.shortName);
  }, []);

  const setUser = useCallback((next: AuthUser | null) => {
    if (userId.current !== next?.id) {
      lockDatabase();
      setDbReady(false);
      setCatalogReady(false);
      setCatalogError('');
      setRestoreOffer(null);
    }
    userId.current = next?.id ?? null;
    updateUser(next);
  }, []);

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    const unsub = onAuthChange((next, event) => {
      if (!active) return;
      authEventReceived = true;
      setUser(next);
      if (event === 'PASSWORD_RECOVERY' || hasPasswordSetupLink()) setPasswordSetupMode(true);
      setAuthReady(true);
    });
    getCurrentUser()
      .then(next => { if (active && !authEventReceived) setUser(next); })
      .catch(() => { if (active && !authEventReceived) setUser(null); })
      .finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; unsub(); };
  }, [setUser]);

  useEffect(() => {
    if (!user || !dbReady) return;

    let active = true;
    const owner = getDatabaseOwner();
    setCatalogReady(false);
    setCatalogError('');
    (async () => {
      const procedures = await getAllProcedures();
      assertDatabaseOwner(owner);
      const updates = getAutomaticCatalogMigrationUpdates(procedures);
      if (updates.length > 0) {
        await mergeDatabaseContents(updates, [], []);
        assertDatabaseOwner(owner);
      }
      if (active) setCatalogReady(true);
    })().catch(error => {
      if (active) setCatalogError(error instanceof Error ? error.message : 'No se pudo actualizar el catálogo local.');
    });
    return () => { active = false; };
  }, [user, dbReady, catalogRetry]);

  useEffect(() => {
    if (!user || !dbReady || !catalogReady) return;

    let active = true;
    (async () => {
      const empty = await isDatabaseEmpty();
      if (empty) {
        const googleOk = await isGoogleSignedIn();
        if (googleOk) {
          const { found, date } = await hasBackupAvailable();
          if (active && isDatabaseOpenFor(user.id) && found && date) setRestoreOffer({ date });
        }
      } else {
        const googleOk = await isGoogleSignedIn();
        if (googleOk) {
          checkAndAutoBackup().catch(err => console.warn('[App] Auto-backup error:', err));
        }
      }
    })().catch(err => console.warn('[App] Backup check:', err));
    return () => { active = false; };
  }, [user, dbReady, catalogReady]);

  if (!authReady) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <p>Iniciando {APP_CONFIG.appName}...</p>
      </div>
    );
  }

  if (!privacyAccepted) {
    return (
      <PrivacyNotice
        onAccept={() => {
          localStorage.setItem(APP_CONFIG.privacyAcceptedKey, 'true');
          setPrivacyAccepted(true);
        }}
      />
    );
  }

  if (isAuthConfirmLink()) {
    return (
      <BrowserRouter>
        <AuthConfirm />
      </BrowserRouter>
    );
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/auth/confirm" element={<AuthConfirm />} />
          <Route path="/reset-password" element={<ResetPassword onDone={setUser} />} />
          <Route path="*" element={<Login onLogin={setUser} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (passwordSetupMode) {
    return (
      <BrowserRouter>
        <ResetPassword
          onDone={updatedUser => {
            setUser(updatedUser);
            setPasswordSetupMode(false);
          }}
        />
      </BrowserRouter>
    );
  }

  if (!dbReady || !isDatabaseOpenFor(user.id)) {
    return <LocalDataGate key={user.id} user={user} onOpen={() => setDbReady(true)} onLogout={() => setUser(null)} />;
  }

  if (catalogError) {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 12 }}>No se pudo revisar el catálogo local</h2>
        <p style={{ color: 'var(--text2)', marginBottom: 18 }}>{catalogError}</p>
        <button className="btn-primary" onClick={() => setCatalogRetry(value => value + 1)}>Reintentar</button>
      </div>
    );
  }

  if (!catalogReady) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Actualizando el catálogo local...</div>;
  }

  return (
    <BrowserRouter>
      <Layout key={user.id} user={user} onLogout={() => setUser(null)} onLock={isWebDatabase() ? () => { lockDatabase(); setDbReady(false); setCatalogReady(false); setCatalogError(''); setRestoreOffer(null); } : undefined}>
        {restoreOffer && (
          <div className="restore-banner" style={{ background: 'var(--primary)', color: 'white', padding: 12, borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontWeight: 'bold', margin: 0 }}>Copia en Google Drive encontrada</p>
              <p style={{ fontSize: 13, margin: 0 }}>{new Date(restoreOffer.date).toLocaleString()}</p>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>Abre Ajustes, pega tu clave de respaldo y restaura desde Google Drive.</p>
            </div>
            <Link to="/ajustes" style={{ background: 'white', color: 'var(--primary)', padding: '6px 12px', borderRadius: 4, textDecoration: 'none', fontWeight: 'bold', fontSize: 13 }} onClick={() => setRestoreOffer(null)}>
              Abrir ajustes
            </Link>
          </div>
        )}
        <Routes>
          <Route path="/auth/confirm" element={<AuthConfirm />} />
          <Route path="/reset-password" element={<ResetPassword onDone={setUser} />} />
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/nuevo" element={<Nuevo />} />
          <Route path="/editar/:id" element={<Nuevo />} />
          <Route path="/listado" element={<Listado />} />
          <Route path="/estadisticas" element={<Estadisticas />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

function hasPasswordSetupLink(): boolean {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const type = url.searchParams.get('type') ?? hashParams.get('type');
  return url.pathname === '/reset-password' || type === 'recovery' || type === 'invite' || url.searchParams.has('code');
}

function isAuthConfirmLink(): boolean {
  return window.location.pathname === '/auth/confirm';
}
