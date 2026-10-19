import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getCurrentUser } from '../auth/authService';
import { getAllProcedures } from '../db/procedureRepository';
import {
  filterProceduresByResidency,
  getCurrentResidencyYear,
  getResidencyPeriod,
  RESIDENCY_YEAR_KEYS,
  type ResidencyFilter,
  type ResidencyYearKey,
} from '../lib/residency';
import type { Procedure } from '../lib/types';

const COLORS = ['#1f4e79', '#2a9d8f', '#e76f51', '#0f766e', '#4f8cc9', '#f2a541', '#6c7a89', '#5b7cfa'];

type CountDatum = { name: string; value: number };
type RoleStackDatum = { name: string; cirujano: number; ayudante: number; total: number };
type StatsFilterType = 'month' | 'category' | 'procedure' | 'litiasisProcedure' | 'approach' | 'role' | 'senior' | 'threeSurgeonProcedure';
type StatsFilter = { type: StatsFilterType; value: string; label: string };

export default function EstadisticasPage() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [residencyStartMonth, setResidencyStartMonth] = useState<string | null>(null);
  const [residencyFilter, setResidencyFilter] = useState<ResidencyFilter>('current');
  const [activeFilters, setActiveFilters] = useState<StatsFilter[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<StatsFilter | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAllProcedures(), getCurrentUser()]).then(([all, currentUser]) => {
      setProcedures([...all].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      setResidencyStartMonth(currentUser?.residencyStartMonth ?? null);
      setLoading(false);
    });
  }, []);

  const currentResidencyYear = useMemo(
    () => getCurrentResidencyYear(residencyStartMonth),
    [residencyStartMonth]
  );
  const effectiveFilter: ResidencyFilter = residencyStartMonth ? residencyFilter : 'all';
  const activeResidencyYear = effectiveFilter === 'current' ? currentResidencyYear : effectiveFilter === 'all' ? null : effectiveFilter;
  const activePeriod = residencyStartMonth && activeResidencyYear
    ? getResidencyPeriod(residencyStartMonth, activeResidencyYear)
    : null;
  const residencyFilteredProcedures = useMemo(
    () => filterProceduresByResidency(procedures, residencyStartMonth, effectiveFilter),
    [procedures, residencyStartMonth, effectiveFilter]
  );
  const filteredProcedures = useMemo(
    () => applyStatsFilters(residencyFilteredProcedures, activeFilters),
    [residencyFilteredProcedures, activeFilters]
  );
  const stats = useMemo(() => buildStats(filteredProcedures), [filteredProcedures]);

  const applyFilter = (filter: StatsFilter) => {
    setActiveFilters(current => {
      return [...current.filter(item => item.type !== filter.type), filter];
    });
    setSelectedFilter(filter);
  };

  const removeFilter = (filter: StatsFilter) => {
    setActiveFilters(current => current.filter(item => !isSameStatsFilter(item, filter)));
    setSelectedFilter(current => current && isSameStatsFilter(current, filter) ? null : current);
  };

  const clearFilters = () => {
    setActiveFilters([]);
    setSelectedFilter(null);
  };

  const handleFilterTap = (filter: StatsFilter) => {
    const isSelected = selectedFilter ? isSameStatsFilter(selectedFilter, filter) : false;
    const isActive = isStatsFilterActive(activeFilters, filter);

    if (!isSelected) {
      setSelectedFilter(filter);
      return;
    }

    if (isActive) {
      removeFilter(filter);
      return;
    }

    applyFilter(filter);
  };

  const selectedMonth = getVisibleFilterValue(activeFilters, selectedFilter, 'month');
  const selectedCategory = getVisibleFilterValue(activeFilters, selectedFilter, 'category');
  const selectedProcedure = getVisibleFilterValue(activeFilters, selectedFilter, 'procedure');
  const selectedLitiasisProcedure = getVisibleFilterValue(activeFilters, selectedFilter, 'litiasisProcedure');
  const selectedApproach = getVisibleFilterValue(activeFilters, selectedFilter, 'approach');
  const selectedRole = getVisibleFilterValue(activeFilters, selectedFilter, 'role');
  const selectedSenior = getVisibleFilterValue(activeFilters, selectedFilter, 'senior');
  const selectedThreeSurgeonProcedure = getVisibleFilterValue(activeFilters, selectedFilter, 'threeSurgeonProcedure');
  const selectedOnlyFilter = selectedFilter && !isStatsFilterActive(activeFilters, selectedFilter) ? selectedFilter : null;
  const showFilterControls = activeFilters.length > 0 || !!selectedOnlyFilter;

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Cargando...</div>;
  }

  if (procedures.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <p>No hay datos suficientes para mostrar estadísticas.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20, fontSize: 20 }}>Estadísticas</h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13 }}>Año de residencia</label>
        <select
          value={effectiveFilter}
          onChange={event => setResidencyFilter(event.target.value as ResidencyFilter)}
          disabled={!residencyStartMonth}
        >
          {residencyStartMonth && (
            <option value="current">
              Año actual{currentResidencyYear ? ` (${currentResidencyYear})` : ''}
            </option>
          )}
          {RESIDENCY_YEAR_KEYS.map(key => (
            <option key={key} value={key}>
              {formatResidencyOption(residencyStartMonth, key)}
            </option>
          ))}
          <option value="all">Todos los años</option>
        </select>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
          {residencyStartMonth
            ? activePeriod
              ? `Mostrando ${activePeriod.key}: ${activePeriod.shortRange}.`
              : 'No hay un año R1-R5 en curso para la fecha actual. Puedes seleccionar un año concreto o todos.'
            : 'Configura el inicio de residencia en Ajustes para dividir las estadísticas por R1-R5.'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 20 }}>
        <Metric label="Total" value={stats.total} tone="primary" />
        <Metric label="Cirujano" value={stats.cirujano} tone="accent" />
        <Metric label="Ayudante" value={stats.ayudante} tone="teal" />
      </div>

      {showFilterControls && (
        <div className="card" style={{ marginBottom: 20, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 600 }}>Filtros activos</span>
            {selectedOnlyFilter && (
              <span className="check-pill active" style={{ fontSize: 12 }}>
                Señalado: {selectedOnlyFilter.label}
              </span>
            )}
            {activeFilters.map(filter => (
              <button
                type="button"
                key={`${filter.type}:${filter.value}`}
                className="check-pill active"
                onClick={() => removeFilter(filter)}
                style={{ fontSize: 12 }}
              >
                {filter.label} ×
              </button>
            ))}
            <button type="button" className="btn-ghost" onClick={clearFilters} style={{ padding: '5px 8px', fontSize: 12 }}>
              Limpiar filtros
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ChartCard title="Evolución mensual">
          <RoleStackedBarBlock
            data={stats.evolucionMensual}
            orientation="vertical"
            selectedName={selectedMonth}
            onSelect={item => handleFilterTap({ type: 'month', value: item.name, label: `Mes: ${item.name}` })}
          />
        </ChartCard>

        <ChartCard title="Por categoría">
          <RoleStackedBarBlock
            data={stats.porCategoria}
            orientation="horizontal"
            height={260}
            selectedName={selectedCategory}
            onSelect={item => handleFilterTap({ type: 'category', value: item.name, label: `Categoría: ${item.name}` })}
          />
        </ChartCard>

        <ChartCard title="Top 10 procedimientos">
          <RoleStackedBarBlock
            data={stats.topProcedimientos}
            orientation="horizontal"
            selectedName={selectedProcedure}
            onSelect={item => handleFilterTap({ type: 'procedure', value: item.name, label: `Procedimiento: ${item.name}` })}
          />
        </ChartCard>

        <ChartCard title="Litiasis">
          <RoleStackedBarBlock
            data={stats.litiasisPorProcedimiento}
            orientation="horizontal"
            emptyText="No hay procedimientos de litiasis en este periodo."
            selectedName={selectedLitiasisProcedure}
            onSelect={item => handleFilterTap({ type: 'litiasisProcedure', value: item.name, label: `Litiasis: ${item.name}` })}
          />
        </ChartCard>

        <div className="two-cols">
          <ChartCard title="Por abordaje">
            <PieBlock
              data={stats.porAbordaje}
              selectedName={selectedApproach}
              onSelect={item => handleFilterTap({ type: 'approach', value: item.name, label: `Abordaje: ${item.name}` })}
            />
          </ChartCard>

          <ChartCard title="Por rol">
            <PieBlock
              data={stats.porRol}
              selectedName={selectedRole}
              onSelect={item => handleFilterTap({ type: 'role', value: item.name, label: `Rol: ${item.name}` })}
            />
          </ChartCard>
        </div>

        <ChartCard title="Top 10 cirujanos senior">
          <RoleStackedBarBlock
            data={stats.topSeniors}
            orientation="horizontal"
            emptyText="No hay cirujanos senior registrados."
            selectedName={selectedSenior}
            onSelect={item => handleFilterTap({ type: 'senior', value: item.name, label: `Senior: ${item.name}` })}
          />
        </ChartCard>

        <ChartCard title="Cirugías a 3 cirujanos">
          <RoleStackedBarBlock
            data={stats.cirugiasTresCirujanos}
            orientation="horizontal"
            emptyText="No hay cirugías a 3 cirujanos registradas."
            selectedName={selectedThreeSurgeonProcedure}
            onSelect={item => handleFilterTap({ type: 'threeSurgeonProcedure', value: item.name, label: `3 cirujanos: ${item.name}` })}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'accent' | 'teal' | 'danger' }) {
  const color = {
    primary: 'var(--primary)',
    accent: 'var(--accent)',
    teal: 'var(--teal)',
    danger: 'var(--danger)',
  }[tone];

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function formatResidencyOption(startMonth: string | null, key: ResidencyYearKey): string {
  if (!startMonth) return key;
  return getResidencyPeriod(startMonth, key)?.label ?? key;
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: 16, fontSize: 15 }}>{title}</h3>
      {children}
    </div>
  );
}

function PieBlock({ data, selectedName, onSelect }: { data: CountDatum[]; selectedName?: string | null; onSelect?: (item: CountDatum) => void }) {
  if (data.length === 0) return <p style={{ color: 'var(--text2)', fontSize: 14 }}>Sin datos.</p>;

  return (
    <div>
      <ResponsiveContainer width="100%" height={178}>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={64} labelLine={false}>
            {data.map((item, i) => (
              <Cell
                key={item.name}
                cursor={onSelect ? 'pointer' : 'default'}
                fill={COLORS[i % COLORS.length]}
                opacity={getCellOpacity(selectedName, item.name)}
                onClick={() => onSelect?.(item)}
              />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="chart-count-list">
        {data.map((item, i) => (
          <div className="chart-count-row" key={item.name}>
            <span className="chart-count-swatch" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="chart-count-name">{item.name}</span>
            <span className="chart-count-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleStackedBarBlock({
  data,
  orientation,
  emptyText = 'Sin datos.',
  height,
  selectedName,
  onSelect,
}: {
  data: RoleStackDatum[];
  orientation: 'vertical' | 'horizontal';
  emptyText?: string;
  height?: number;
  selectedName?: string | null;
  onSelect?: (item: RoleStackDatum) => void;
}) {
  if (data.length === 0) {
    return <p style={{ color: 'var(--text2)', fontSize: 14 }}>{emptyText}</p>;
  }

  if (orientation === 'vertical') {
    return (
      <ResponsiveContainer width="100%" height={height ?? 240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="cirujano" stackId="role" fill="var(--primary)" name="Como cirujano">
            {data.map(item => (
              <Cell
                key={`cirujano-${item.name}`}
                cursor={onSelect ? 'pointer' : 'default'}
                opacity={getCellOpacity(selectedName, item.name)}
                onClick={() => onSelect?.(item)}
              />
            ))}
          </Bar>
          <Bar dataKey="ayudante" stackId="role" fill="var(--accent)" name="Ayudante" radius={[4, 4, 0, 0]}>
            {data.map(item => (
              <Cell
                key={`ayudante-${item.name}`}
                cursor={onSelect ? 'pointer' : 'default'}
                opacity={getCellOpacity(selectedName, item.name)}
                onClick={() => onSelect?.(item)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(180, data.length * 34 + 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 22 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="cirujano" stackId="role" fill="var(--primary)" name="Como cirujano">
          {data.map(item => (
            <Cell
              key={`cirujano-${item.name}`}
              cursor={onSelect ? 'pointer' : 'default'}
              opacity={getCellOpacity(selectedName, item.name)}
              onClick={() => onSelect?.(item)}
            />
          ))}
        </Bar>
        <Bar dataKey="ayudante" stackId="role" fill="var(--accent)" name="Ayudante" radius={[0, 4, 4, 0]}>
          {data.map(item => (
            <Cell
              key={`ayudante-${item.name}`}
              cursor={onSelect ? 'pointer' : 'default'}
              opacity={getCellOpacity(selectedName, item.name)}
              onClick={() => onSelect?.(item)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function getCellOpacity(selectedName: string | null | undefined, itemName: string): number {
  return selectedName && selectedName !== itemName ? 0.35 : 1;
}

function isSameStatsFilter(a: StatsFilter, b: StatsFilter): boolean {
  return a.type === b.type && a.value === b.value;
}

function isStatsFilterActive(filters: StatsFilter[], filter: StatsFilter): boolean {
  return filters.some(item => isSameStatsFilter(item, filter));
}

function getActiveFilterValue(filters: StatsFilter[], type: StatsFilterType): string | null {
  return filters.find(filter => filter.type === type)?.value ?? null;
}

function getVisibleFilterValue(filters: StatsFilter[], selectedFilter: StatsFilter | null, type: StatsFilterType): string | null {
  if (selectedFilter?.type === type) return selectedFilter.value;
  return getActiveFilterValue(filters, type);
}

function applyStatsFilters(procedures: Procedure[], filters: StatsFilter[]): Procedure[] {
  if (filters.length === 0) return procedures;

  return procedures.filter(procedure => filters.every(filter => matchesStatsFilter(procedure, filter)));
}

function matchesStatsFilter(procedure: Procedure, filter: StatsFilter): boolean {
  switch (filter.type) {
    case 'month':
      return String(procedure.fecha).slice(0, 7) === filter.value;
    case 'category':
      return procedure.categoria === filter.value;
    case 'procedure':
      return procedure.procedimiento === filter.value;
    case 'litiasisProcedure':
      return procedure.categoria === 'Litiasis' && procedure.procedimiento === filter.value;
    case 'approach':
      return procedure.abordaje === filter.value;
    case 'role':
      return procedure.rol === filter.value;
    case 'senior':
      return (procedure.cirujano_senior ?? 'Sin dato') === filter.value;
    case 'threeSurgeonProcedure':
      return isThreeSurgeonCase(procedure) && procedure.procedimiento === filter.value;
  }
}

function buildStats(procedures: Procedure[]) {
  return {
    total: procedures.length,
    cirujano: procedures.filter(isPrincipalRole).length,
    ayudante: procedures.filter(isAssistantRole).length,
    evolucionMensual: countByRole(procedures, p => String(p.fecha).slice(0, 7)).sort((a, b) => a.name.localeCompare(b.name)),
    porCategoria: countByRole(procedures, p => p.categoria),
    topProcedimientos: countByRole(procedures, p => p.procedimiento).slice(0, 10),
    litiasisPorProcedimiento: buildLitiasisProcedureStats(procedures),
    porAbordaje: countBy(procedures, p => p.abordaje),
    porRol: countBy(procedures, p => p.rol),
    topSeniors: countByRole(procedures.filter(p => !!p.cirujano_senior), p => p.cirujano_senior ?? 'Sin dato').slice(0, 10),
    cirugiasTresCirujanos: countByRole(procedures.filter(isThreeSurgeonCase), p => p.procedimiento).slice(0, 10),
  };
}

function isThreeSurgeonCase(procedure: Procedure): boolean {
  return !!procedure.cirujano_senior && (!!procedure.primer_ayudante || !!procedure.segundo_ayudante);
}

function buildLitiasisProcedureStats(procedures: Procedure[]): RoleStackDatum[] {
  return countByRole(procedures.filter(procedure => procedure.categoria === 'Litiasis'), procedure => procedure.procedimiento);
}

function isPrincipalRole(procedure: Procedure): boolean {
  return procedure.rol === 'Cirujano principal';
}

function isAssistantRole(procedure: Procedure): boolean {
  return procedure.rol.toLowerCase().includes('ayudante');
}

function countByRole(items: Procedure[], getter: (item: Procedure) => string): RoleStackDatum[] {
  const map = new Map<string, { total: number; cirujano: number; ayudante: number }>();

  for (const procedure of items) {
    const key = getter(procedure).trim() || 'Sin dato';
    const current = map.get(key) ?? { total: 0, cirujano: 0, ayudante: 0 };
    current.total += 1;
    if (isPrincipalRole(procedure)) current.cirujano += 1;
    if (isAssistantRole(procedure)) current.ayudante += 1;
    map.set(key, current);
  }

  return [...map.entries()]
    .map(([name, values]) => ({
      name,
      cirujano: values.cirujano,
      ayudante: values.ayudante,
      total: values.total,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function countBy(items: Procedure[], getter: (item: Procedure) => string): CountDatum[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = getter(item).trim() || 'Sin dato';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
