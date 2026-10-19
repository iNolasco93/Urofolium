import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllProcedures, countProcedures } from '../db/procedureRepository';
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
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const [all, count] = await Promise.all([
        getAllProcedures(),
        countProcedures(),
      ]);
      setProcedures(all);
      setTotal(count);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Cargando...</div>;

  const comoCirujano = procedures.filter(p => p.rol === 'Cirujano principal').length;
  const comoAyudante = procedures.filter(p => p.rol?.toLowerCase().includes('ayudante')).length;
  const ultimos = procedures.slice(0, 5);
  const metrics = [
    { label: 'Total', value: total, color: 'var(--primary)' },
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
          {total > 5 && (
            <button className="btn-ghost" onClick={() => navigate('/listado')} style={{ marginTop: 4 }}>
              Ver todos ({total})
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
