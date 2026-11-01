import { fechaLocal } from '../lib/fechas';
import { useRemoteRevision } from '../sync/syncManager';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllProcedures } from '../db/procedureRepository';
import type { AuthUser, Procedure } from '../lib/types';
import SafetyNotice from '../components/SafetyNotice';

interface DashboardProps {
  user: AuthUser;
}

function getGreetingName(user: AuthUser): string {
  const fromMetadata = user.displayName?.trim();
  if (fromMetadata) return fromMetadata.split(/\s+/)[0];
  return user.email.split('@')[0] || 'usuario';
}

export default function Dashboard({ user }: DashboardProps) {
  const remoteRevision = useRemoteRevision();
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const all = await getAllProcedures();
      setProcedures(all);
      setLoading(false);
    })();
  }, [remoteRevision]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Cargando...</div>;

  const realizadas = procedures.filter(p => p.estado !== 'programada');
  const pendientes = procedures.filter(p => p.estado === 'programada').sort((a, b) => a.fecha.localeCompare(b.fecha));
  const comoCirujano = realizadas.filter(p => p.rol === 'Cirujano principal').length;
  const comoAyudante = realizadas.filter(p => p.rol?.toLowerCase().includes('ayudante')).length;
  const ultimos = realizadas.slice(0, 5);
  const metrics = [
    { label: 'Total', value: realizadas.length, color: 'var(--primary)' },
    { label: 'Cirujano', value: comoCirujano, color: 'var(--accent)' },
    { label: 'Ayudante', value: comoAyudante, color: 'var(--teal)' },
  ];

  return (
    <div>
      <p style={{ textAlign: 'center', color: 'var(--text)', fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        Bienvenido {getGreetingName(user)}
      </p>
      <h2 style={{ marginBottom: 20, fontSize: 20 }}>Dashboard</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
        {metrics.map(({ label, value, color }) => (
          <div key={label} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {pendientes.length > 0 && <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Cirugías pendientes</h3>
        {pendientes.map(p => <div className="card" key={p.id} style={{ marginBottom: 8 }}>
          <strong>{p.procedimiento}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text2)' }}>{p.fecha < fechaLocal() ? 'Pendiente de completar' : p.fecha === fechaLocal() ? 'Hoy' : 'Programada'}</span>
          <p style={{ fontSize: 13, margin: '6px 0' }}>{p.fecha} · {p.categoria}{p.abordaje ? ` · ${p.abordaje}` : ''}</p>
          {p.notas && <p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{p.notas}</p>}
          <button className="btn-primary" onClick={() => navigate(`/editar/${p.id}?completar=1`)}>Completar cirugía</button>
        </div>)}
      </section>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16 }}>Últimos procedimientos</h3>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => navigate('/nuevo')}>
          ➕ Nuevo
        </button>
      </div>

      {ultimos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔬</div>
          <p>No hay procedimientos registrados todavía.</p>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/nuevo')}>
            Registrar primero
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ultimos.map(p => (
            <div key={p.id} className="card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/editar/${p.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.procedimiento}</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                    {String(p.fecha).slice(0, 10)} • {p.categoria} • {p.abordaje}
                  </div>
                  {p.cirujano_senior && <div style={{ fontSize: 13, color: 'var(--text2)' }}>Senior: {p.cirujano_senior}</div>}
                </div>
                <span className={`badge ${p.rol === 'Cirujano principal' ? 'badge-cirujano' : 'badge-ayudante'}`}>{p.rol}</span>
              </div>
            </div>
          ))}
          {realizadas.length > 5 && (
            <button className="btn-ghost" onClick={() => navigate('/listado')} style={{ marginTop: 4 }}>
              Ver todos ({realizadas.length})
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SafetyNotice compact summary />
      </div>
    </div>
  );
}
