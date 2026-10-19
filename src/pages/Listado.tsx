import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../auth/authService';
import { getAllProcedures, deleteProcedure } from '../db/procedureRepository';
import { getAllStoneDetails } from '../db/stoneRepository';
import { assertDatabaseOwner, getDatabaseOwner } from '../db/database';
import { createProcedureWorkbook } from '../lib/procedureWorkbook';
import { getResidencyPeriod, RESIDENCY_YEAR_KEYS, type ResidencyYearKey } from '../lib/residency';
import type { Procedure } from '../lib/types';
import * as XLSX from 'xlsx';

export default function Listado() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [residencyStartMonth, setResidencyStartMonth] = useState<string | null>(null);
  const [selectedResidencyYears, setSelectedResidencyYears] = useState<ResidencyYearKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const navigate = useNavigate();
  const loadData = async () => {
    const owner = getDatabaseOwner();
    const [data, currentUser] = await Promise.all([getAllProcedures(), getCurrentUser()]);
    assertDatabaseOwner(owner);
    setProcedures(data);
    setLoadedOwner(owner);
    setResidencyStartMonth(currentUser?.residencyStartMonth ?? null);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (id: string) => {
    if (confirm('¿Seguro que quieres eliminar este registro?')) {
      await deleteProcedure(id);
      loadData();
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Cargando...</div>;

  const filtered = procedures.filter(p => {
    if (catFilter && p.categoria !== catFilter) return false;
    if (!matchesResidencySelection(p, residencyStartMonth, selectedResidencyYears)) return false;
    if (search) {
      const term = normalizeSearch(search);
      const searchable = [
        p.procedimiento,
        p.cirujano_senior,
        p.rol,
      ].map(value => normalizeSearch(value ?? ''));

      return searchable.some(value => value.includes(term));
    }
    return true;
  });

  const categorias = Array.from(new Set(procedures.map(p => p.categoria)));
  const exportScope = formatExportScope(residencyStartMonth, selectedResidencyYears);

  const toggleResidencyYear = (key: ResidencyYearKey) => {
    setSelectedResidencyYears(current => {
      const next = current.includes(key)
        ? current.filter(item => item !== key)
        : [...current, key];
      return RESIDENCY_YEAR_KEYS.filter(item => next.includes(item));
    });
  };

  const exportExcel = async () => {
    if (filtered.length === 0) {
      alert('No hay registros para exportar con los filtros actuales.');
      return;
    }

    setExportError('');
    setExporting(true);
    try {
      if (!loadedOwner) throw new Error('Vuelve a cargar el listado antes de exportar.');
      assertDatabaseOwner(loadedOwner);
      const stoneDetails = await getAllStoneDetails();
      assertDatabaseOwner(loadedOwner);
      const workbook = createProcedureWorkbook(filtered, stoneDetails);
      XLSX.writeFile(workbook, `urofolium-registros-${formatFilenameScope(selectedResidencyYears)}.xlsx`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo exportar el archivo.');
    } finally {
      setExporting(false);
    }
  };

  const searchPlaceholder = 'Buscar por procedimiento, cirujano senior o rol...';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 20 }}>Todos los registros ({filtered.length}/{procedures.length})</h2>
        <button className="btn-ghost" onClick={exportExcel} disabled={exporting} style={{ fontSize: 13, padding: '6px 10px' }}>
          {exporting ? 'Exportando...' : 'Exportar Excel'}
        </button>
      </div>
      {exportError && <p role="alert" style={{ color: 'var(--danger)', marginBottom: 12 }}>{exportError}</p>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexDirection: 'column' }}>
        <input type="text" placeholder={searchPlaceholder} value={search} onChange={e => setSearch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
          <option value="">Todas las categorias</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ margin: 0 }}>Año de residencia para listado/exportación</label>
            {selectedResidencyYears.length > 0 && (
              <button type="button" className="btn-ghost" onClick={() => setSelectedResidencyYears([])} style={{ padding: '5px 8px', fontSize: 12 }}>
                Todos
              </button>
            )}
          </div>
          <div className="check-group">
            {RESIDENCY_YEAR_KEYS.map(key => (
              <button
                type="button"
                key={key}
                className={`check-pill ${selectedResidencyYears.includes(key) ? 'active' : ''}`}
                onClick={() => toggleResidencyYear(key)}
                disabled={!residencyStartMonth}
                title={getResidencyPeriod(residencyStartMonth ?? '', key)?.label ?? key}
              >
                {key}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
            {residencyStartMonth
              ? `Exportación: ${exportScope}. Incluye identificadores, todos los campos de esta versión y detalles de litiasis para volver a importar.`
              : 'Configura el inicio de residencia en Ajustes para filtrar por R1-R5.'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
            El Excel contiene los registros filtrados y no está cifrado. Para una copia protegida, usa el backup cifrado de Ajustes.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(p => (
          <div key={p.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => navigate(`/editar/${p.id}`)}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.procedimiento}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                  {String(p.fecha).slice(0, 10)} • {p.categoria}
                </div>
                {p.cirujano_senior && (
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                    Senior: {p.cirujano_senior}
                  </div>
                )}
                <span className={`badge ${p.rol === 'Cirujano principal' ? 'badge-cirujano' : 'badge-ayudante'}`} style={{ marginTop: 6, display: 'inline-block' }}>{p.rol}</span>
              </div>
              <button className="btn-ghost" onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} style={{ color: 'var(--danger)', padding: '6px 12px' }}>🗑️</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>No hay resultados</div>}
      </div>
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesResidencySelection(
  procedure: Procedure,
  startMonth: string | null,
  selectedYears: ResidencyYearKey[]
): boolean {
  if (!startMonth || selectedYears.length === 0) return true;

  const date = String(procedure.fecha).slice(0, 10);
  return selectedYears.some(key => {
    const period = getResidencyPeriod(startMonth, key);
    return !!period && date >= period.startDate && date < period.endDateExclusive;
  });
}

function formatExportScope(startMonth: string | null, selectedYears: ResidencyYearKey[]): string {
  if (selectedYears.length === 0) return 'todos los registros filtrados';
  return selectedYears
    .map(key => getResidencyPeriod(startMonth ?? '', key)?.label ?? key)
    .join(', ');
}

function formatFilenameScope(selectedYears: ResidencyYearKey[]): string {
  return selectedYears.length > 0 ? selectedYears.join('-').toLowerCase() : 'todos';
}
