import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assertDatabaseOwner, getDatabaseOwner } from '../db/database';
import { getAllProcedures } from '../db/procedureRepository';
import { getMigrationReviewCases, type MigrationReviewCase } from '../lib/migrationReview';

export default function RevisionCatalogo() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<MigrationReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const owner = getDatabaseOwner();
    getAllProcedures()
      .then(procedures => {
        assertDatabaseOwner(owner);
        if (active) setCases(getMigrationReviewCases(procedures));
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron revisar los registros.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Revisando registros...</div>;

  return (
    <div>
      <h2 style={{ fontSize: 20, marginBottom: 8 }}>Pendientes de revisión</h2>
      <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 20 }}>
        Estos registros necesitan una decisión manual. Abre cada uno, completa los datos indicados y guarda los cambios.
      </p>

      {error && <p role="alert" style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}

      {!error && cases.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text2)' }}>
          No hay registros pendientes de revisión.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cases.map(item => (
          <div key={item.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{item.procedimientoActual}</div>
                <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 3 }}>
                  {item.fecha} · {item.categoriaActual} · {item.abordajeActual || 'Sin abordaje'}
                </div>
                <ul style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {item.problemas.map(problem => <li key={problem}>{problem}</li>)}
                </ul>
                {item.accionRequerida && (
                  <p style={{ margin: '10px 0 0', fontSize: 13 }}>
                    <strong>Corrección:</strong> {item.accionRequerida}
                  </p>
                )}
              </div>
              <button className="btn-primary" style={{ padding: '7px 11px', fontSize: 13 }} onClick={() => navigate(`/editar/${item.id}`)}>
                Corregir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
