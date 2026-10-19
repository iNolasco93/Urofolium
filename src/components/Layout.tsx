import { type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from '../auth/authService';
import { APP_CONFIG } from '../config/appConfig';
import type { AuthUser } from '../lib/types';

interface LayoutProps {
  user: AuthUser;
  onLogout: () => void;
  onLock?: () => void;
  children: ReactNode;
}

const NAV_ITEMS = [
  { path: '/', label: 'Inicio', icon: '🏠' },
  { path: '/nuevo', label: 'Nuevo', icon: '➕' },
  { path: '/listado', label: 'Listado', icon: '📄' },
  { path: '/estadisticas', label: 'Stats', icon: '📊' },
  { path: '/ajustes', label: 'Ajustes', icon: '⚙️' },
];

export default function Layout({ user, onLogout, onLock, children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const handleLogout = async () => {
    onLogout();
    await signOut();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 24 }}>🩺</span>
          <span style={{ fontWeight: 'bold', fontSize: 18 }}>{APP_CONFIG.appName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)', display: 'none' }}>{user.email}</span>
          {onLock && <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={onLock}>Bloquear</button>}
          <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={handleLogout}>Salir</button>
        </div>
      </header>

      <main className="app-main">
        {children}

        <footer className="app-footer">
          <p>© 2026 {APP_CONFIG.appName}. Ivan Nolasco. Todos los derechos reservados.</p>
          <p style={{ marginTop: 4 }}>Una herramienta creada por un residente, para residentes.</p>
        </footer>
      </main>

      <nav className="bottom-nav" aria-label="Navegación principal" style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}>
        {NAV_ITEMS.map(item => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <button
              key={item.path}
              className={`bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`}
              onClick={() => navigate(item.path)}
              aria-label={item.label}
            >
              <span className="bottom-nav__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="bottom-nav__label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
