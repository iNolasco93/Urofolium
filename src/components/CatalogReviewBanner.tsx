import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { assertDatabaseOwner, getDatabaseOwner } from '../db/database';
import { getAllProcedures } from '../db/procedureRepository';
import { getMigrationReviewCases } from '../lib/migrationReview';

export default function CatalogReviewBanner() {
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let active = true;
    const owner = getDatabaseOwner();
    getAllProcedures()
      .then(procedures => {
        assertDatabaseOwner(owner);
        if (active) setPendingCount(getMigrationReviewCases(procedures).length);
      })
      .catch(() => { if (active) setPendingCount(0); });
    return () => { active = false; };
  }, [location.pathname]);

  if (pendingCount === 0 || location.pathname === '/revision-catalogo') return null;

  return (
    <div
      role="status"
      style={{
        background: '#fff7d6', border: '1px solid #e8c547', color: '#5f4700',
        padding: 12, borderRadius: 8, marginBottom: 16, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}
    >
      <div>
        <p style={{ fontWeight: 700, margin: 0 }}>Registros pendientes de revisión</p>
        <p style={{ fontSize: 13, margin: '3px 0 0' }}>
          {pendingCount === 1
            ? 'Hay 1 registro que necesita una corrección manual.'
            : `Hay ${pendingCount} registros que necesitan una corrección manual.`}
        </p>
      </div>
      <Link
        to="/revision-catalogo"
        style={{
          background: '#5f4700', color: 'white', padding: '7px 11px', borderRadius: 6,
          textDecoration: 'none', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
        }}
      >
        Revisar
      </Link>
    </div>
  );
}
