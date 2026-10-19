import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAllProcedures, getProcedureById } from '../db/procedureRepository';
import { getStoneDetailsByProcedureId } from '../db/stoneRepository';
import { assertDatabaseOwner, getDatabaseOwner, mergeDatabaseContents } from '../db/database';
import { CATEGORIAS, REGLAS_ABORDAJE, SELECTABLE, ABORDAJES_SELECCIONABLES, TODOS_ABORDAJES, ROLES } from '../lib/categorias';
import type { Procedure, StoneDetails, StoneProcedureRaw } from '../lib/types';

const ORQUIECTOMIA_SIMPLE = 'Orquiectomía simple / escrotal';
const ORQUIECTOMIA_INGUINAL = 'Orquiectomía inguinal';
const ORQUIECTOMIA_INGUINAL_PROTESIS = 'Orquiectomía inguinal + prótesis';
const LITIASIS = 'Litiasis';
const LITIASIS_SIMPLE_PROCEDURES = ['Cistolitotricia', 'Cistolitotomía'] as const;
const DUPLICATE_DURATION_TOLERANCE_MINUTES = 15;

const STONE_EMPTY = {
  lat_dcha: false,
  lat_izq: false,
  proc_urs: false,
  proc_rirs: false,
  proc_nlpc: false,
  nefromax: false,
  nefromax_fr: '' as string,
  amplatz: false,
  amplatz_fr: '' as string,
  enhebrado: false,
  tamanio_mm: '' as string,
  drenaje: false,
  tutor_interno: '' as string,
  drenaje_nefrostomico: '' as string,
  sonda_fr: '' as string,
  stonefree: '' as string,
};

const EMPTY = {
  fecha: new Date().toISOString().slice(0, 10),
  categoria: '',
  procedimiento: '',
  abordaje: '',
  duracion: '',
  rol: '',
  cirujano_senior: '',
  primer_ayudante: '',
  segundo_ayudante: '',
  complicaciones: false,
  complicaciones_detalle: '',
  otro_especificar: '',
  orquiectomia_inguinal: false,
  orquiectomia_protesis: false,
  ...STONE_EMPTY,
};

type FormState = typeof EMPTY;
type ProcedureDraft = Omit<Procedure, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>;
type StoneProcedureKey = 'proc_urs' | 'proc_rirs' | 'proc_nlpc';
type LitiasisSimpleProcedure = (typeof LITIASIS_SIMPLE_PROCEDURES)[number];

function normalizeDuplicateValue(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function durationIsSimilar(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return Math.abs(a - b) <= DUPLICATE_DURATION_TOLERANCE_MINUTES;
}

function sameDuplicateValue(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDuplicateValue(a) === normalizeDuplicateValue(b);
}

function isPotentialDuplicate(draft: ProcedureDraft, existing: Procedure): boolean {
  return (
    sameDuplicateValue(draft.fecha, existing.fecha) &&
    sameDuplicateValue(draft.categoria, existing.categoria) &&
    sameDuplicateValue(draft.procedimiento, existing.procedimiento) &&
    sameDuplicateValue(draft.abordaje, existing.abordaje) &&
    sameDuplicateValue(draft.rol, existing.rol) &&
    sameDuplicateValue(draft.cirujano_senior, existing.cirujano_senior) &&
    sameDuplicateValue(draft.primer_ayudante, existing.primer_ayudante) &&
    sameDuplicateValue(draft.segundo_ayudante, existing.segundo_ayudante) &&
    durationIsSimilar(draft.duracion, existing.duracion)
  );
}

function findPotentialDuplicates(draft: ProcedureDraft, procedures: Procedure[], currentId?: string): Procedure[] {
  return procedures.filter(procedure => procedure.id !== currentId && isPotentialDuplicate(draft, procedure));
}

function formatDuplicateCandidate(procedure: Procedure): string {
  const duration = procedure.duracion != null ? `, ${procedure.duracion} min` : '';
  const senior = procedure.cirujano_senior ? `, senior: ${procedure.cirujano_senior}` : '';
  return `${procedure.fecha} - ${procedure.procedimiento} (${procedure.rol}${senior}${duration})`;
}

function buildDuplicateWarning(duplicates: Procedure[]): string {
  const sample = duplicates
    .slice(0, 3)
    .map(procedure => `- ${formatDuplicateCandidate(procedure)}`)
    .join('\n');
  const extra = duplicates.length > 3 ? `\n...y ${duplicates.length - 3} posible(s) duplicado(s) más.` : '';
  const countLabel = duplicates.length === 1 ? '1 posible duplicado' : `${duplicates.length} posibles duplicados`;

  return [
    `Se encontró ${countLabel} con fecha, procedimiento, abordaje, rol, equipo quirúrgico y duración similar.`,
    '',
    sample,
    extra,
    '',
    'Sin identificador de paciente, esto puede ser una cirugía repetida o dos casos reales parecidos.',
    '¿Quieres guardar de todos modos?',
  ].join('\n');
}

function parseStoredProcedure(procedimiento: string): Pick<FormState, 'procedimiento' | 'orquiectomia_inguinal' | 'orquiectomia_protesis'> {
  if (procedimiento === ORQUIECTOMIA_INGUINAL_PROTESIS) {
    return { procedimiento: 'Orquiectomía', orquiectomia_inguinal: true, orquiectomia_protesis: true };
  }
  if (procedimiento === ORQUIECTOMIA_INGUINAL) {
    return { procedimiento: 'Orquiectomía', orquiectomia_inguinal: true, orquiectomia_protesis: false };
  }
  if (procedimiento === ORQUIECTOMIA_SIMPLE) {
    return { procedimiento: 'Orquiectomía', orquiectomia_inguinal: false, orquiectomia_protesis: false };
  }
  return { procedimiento, orquiectomia_inguinal: false, orquiectomia_protesis: false };
}

function calcularProcedimientoLitiasis(urs: boolean, rirs: boolean, nlpc: boolean): string {
  if (rirs && nlpc) return 'ECIRS';
  const procs: string[] = [];
  if (urs) procs.push('URS');
  if (rirs) procs.push('RIRS');
  if (nlpc) procs.push('NLPC');
  return procs.join('+') || '';
}

function isLitiasisSimpleProcedure(procedimiento: string): procedimiento is LitiasisSimpleProcedure {
  return (LITIASIS_SIMPLE_PROCEDURES as readonly string[]).includes(procedimiento);
}

function requiereDetallesStone(form: Pick<FormState, 'proc_urs' | 'proc_rirs' | 'proc_nlpc'>): boolean {
  return form.proc_urs || form.proc_rirs || form.proc_nlpc;
}

function getProcedimientoLitiasis(form: Pick<FormState, 'procedimiento' | 'proc_urs' | 'proc_rirs' | 'proc_nlpc'>): string {
  if (isLitiasisSimpleProcedure(form.procedimiento)) return form.procedimiento;
  return calcularProcedimientoLitiasis(form.proc_urs, form.proc_rirs, form.proc_nlpc);
}

function calcularAbordajeLitiasis(procedimiento: string, rol: string): string {
  if (!procedimiento) return '';
  if (procedimiento === 'Cistolitotomía') return 'Abierto';
  if (procedimiento === 'Cistolitotricia') return 'Endoscópico';
  if (procedimiento === 'ECIRS') {
    if (rol === 'Primer ayudante') return 'Endoscópico';
    if (rol === 'Cirujano principal') return 'Percutáneo';
    return '';
  }
  if (procedimiento.includes('NLPC')) return 'Percutáneo';
  return 'Endoscópico';
}

function puedeElegirAbordajeLitiasis(procedimiento: string, rol: string): boolean {
  return procedimiento === 'ECIRS' && !!rol && !calcularAbordajeLitiasis(procedimiento, rol);
}

function requierePrimerAyudante(rol: string): boolean {
  return rol === 'Segundo ayudante' || rol === 'Observador';
}

function muestraSegundoAyudante(rol: string): boolean {
  return rol === 'Cirujano principal' || rol === 'Primer ayudante';
}

function calcularLateralidad(dcha: boolean, izq: boolean): string {
  if (dcha && izq) return 'Bilateral';
  if (dcha) return 'Derecha';
  if (izq) return 'Izquierda';
  return '';
}

function calcularEtiquetaDrenaje(
  nlpc: boolean,
  tutorInterno: string,
  drenajeNefrostomico: string,
  sondaFr: string
): string {
  if (!nlpc) return tutorInterno ? tutorInterno : '';
  const tieneNefrostomico = drenajeNefrostomico === 'Sonda' || drenajeNefrostomico === 'NPC';
  const nefrostomicoLabel = drenajeNefrostomico === 'Sonda'
    ? `Sonda ${sondaFr}Fr`
    : drenajeNefrostomico === 'NPC' ? 'NPC' : '';
  if (tieneNefrostomico && tutorInterno) return `${nefrostomicoLabel} + ${tutorInterno}`;
  if (tieneNefrostomico && !tutorInterno) return nefrostomicoLabel;
  if (!tieneNefrostomico && tutorInterno) return 'Tubeless';
  return 'Total tubeless';
}

function parseStoneProcedureRaw(procedimiento: string): StoneProcedureRaw {
  const normalized = procedimiento.toUpperCase();
  if (normalized === 'ECIRS') return { urs: false, rirs: true, nlpc: true };
  return {
    urs: normalized.includes('URS'),
    rirs: normalized.includes('RIRS'),
    nlpc: normalized.includes('NLPC'),
  };
}

function stoneDetailsToForm(details: StoneDetails | null, procedimiento: string): typeof STONE_EMPTY {
  const raw = details?.procedimiento_raw ?? parseStoneProcedureRaw(procedimiento);
  return {
    lat_dcha: details?.lateralidad === 'Derecha' || details?.lateralidad === 'Bilateral',
    lat_izq: details?.lateralidad === 'Izquierda' || details?.lateralidad === 'Bilateral',
    proc_urs: raw.urs,
    proc_rirs: raw.rirs,
    proc_nlpc: raw.nlpc,
    nefromax: details?.nefromax_fr != null,
    nefromax_fr: details?.nefromax_fr ? String(details.nefromax_fr) : '',
    amplatz: details?.amplatz_fr != null,
    amplatz_fr: details?.amplatz_fr ? String(details.amplatz_fr) : '',
    enhebrado: details?.enhebrado ?? false,
    tamanio_mm: details?.tamanio_mm ? String(details.tamanio_mm) : '',
    drenaje: !!details?.tutor_interno,
    tutor_interno: details?.tutor_interno ?? '',
    drenaje_nefrostomico: details?.drenaje_nefrostomico ?? '',
    sonda_fr: details?.sonda_fr ? String(details.sonda_fr) : '',
    stonefree: details?.stonefree == null ? '' : details.stonefree ? 'si' : 'no',
  };
}

function buildStoredProcedure(form: FormState): string {
  if (form.categoria === LITIASIS) {
    return getProcedimientoLitiasis(form);
  }
  if (form.procedimiento === 'Otros') return `Otros: ${form.otro_especificar.trim()}`;
  if (form.procedimiento !== 'Orquiectomía') return form.procedimiento;
  if (form.orquiectomia_protesis) return ORQUIECTOMIA_INGUINAL_PROTESIS;
  if (form.orquiectomia_inguinal) return ORQUIECTOMIA_INGUINAL;
  return ORQUIECTOMIA_SIMPLE;
}

export default function Nuevo() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  const [form, setForm] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [abordajeBloqueado, setAbordajeBloqueado] = useState(false);

  const isLitiasis = form.categoria === LITIASIS;
  const procedimientoLitiasis = getProcedimientoLitiasis(form);
  const requiereStone = isLitiasis && requiereDetallesStone(form);
  const abordajeLitiasisCalculado = isLitiasis ? calcularAbordajeLitiasis(procedimientoLitiasis, form.rol) : '';
  const abordajeLitiasisEditable = isLitiasis && puedeElegirAbordajeLitiasis(procedimientoLitiasis, form.rol);
  const abordajeLitiasis = abordajeLitiasisCalculado || (abordajeLitiasisEditable ? form.abordaje : '');
  const lateralidad = calcularLateralidad(form.lat_dcha, form.lat_izq);
  const etiquetaDrenaje = calcularEtiquetaDrenaje(
    form.proc_nlpc,
    form.drenaje ? form.tutor_interno : '',
    form.proc_nlpc ? form.drenaje_nefrostomico : '',
    form.sonda_fr
  );

  useEffect(() => {
    if (!isEdit || !id) return;

    let cancelled = false;
    (async () => {
      const data = await getProcedureById(id);
      if (!data || cancelled) return;

      const esOtro = data.procedimiento?.startsWith('Otros: ');
      const parsedProcedure = parseStoredProcedure(data.procedimiento || '');
      const stoneForm = data.categoria === LITIASIS
        ? stoneDetailsToForm(await getStoneDetailsByProcedureId(id), data.procedimiento || '')
        : { ...STONE_EMPTY };
      if (cancelled) return;
      const tieneComplicaciones = !!data.complicaciones && data.complicaciones !== 'No';

      setForm({
        ...EMPTY,
        ...stoneForm,
        fecha: String(data.fecha).slice(0, 10),
        categoria: data.categoria || '',
        procedimiento: data.categoria === LITIASIS ? data.procedimiento || '' : esOtro ? 'Otros' : parsedProcedure.procedimiento,
        abordaje: data.abordaje || '',
        duracion: data.duracion ? String(data.duracion) : '',
        rol: data.rol || '',
        cirujano_senior: data.cirujano_senior || '',
        primer_ayudante: data.primer_ayudante || '',
        segundo_ayudante: data.segundo_ayudante || '',
        complicaciones: tieneComplicaciones,
        complicaciones_detalle: tieneComplicaciones && data.complicaciones !== 'Si' ? data.complicaciones || '' : '',
        otro_especificar: esOtro ? data.procedimiento.replace('Otros: ', '') : '',
        orquiectomia_inguinal: parsedProcedure.orquiectomia_inguinal,
        orquiectomia_protesis: parsedProcedure.orquiectomia_protesis,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  useEffect(() => {
    if (form.categoria === LITIASIS) {
      setAbordajeBloqueado(true);
      return;
    }

    if (!form.categoria || !form.procedimiento) {
      setAbordajeBloqueado(false);
      return;
    }

    const regla = REGLAS_ABORDAJE[form.categoria]?.[form.procedimiento];
    if (regla && regla !== SELECTABLE) {
      setForm(f => ({ ...f, abordaje: regla }));
      setAbordajeBloqueado(true);
    } else {
      setAbordajeBloqueado(false);
    }
  }, [form.categoria, form.procedimiento]);

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const setStoneProcedure = (key: StoneProcedureKey, value: boolean) => setForm(f => {
    const next = { ...f, [key]: value };
    const procedimiento = calcularProcedimientoLitiasis(next.proc_urs, next.proc_rirs, next.proc_nlpc);
    return { ...next, procedimiento, abordaje: calcularAbordajeLitiasis(procedimiento, next.rol) };
  });

  const setLitiasisSimpleProcedure = (procedimiento: LitiasisSimpleProcedure) => setForm(f => {
    const nextProcedimiento = f.procedimiento === procedimiento && !requiereDetallesStone(f) ? '' : procedimiento;
    return {
      ...f,
      ...STONE_EMPTY,
      procedimiento: nextProcedimiento,
      abordaje: calcularAbordajeLitiasis(nextProcedimiento, f.rol),
    };
  });

  const handleCategoriaChange = (cat: string) => setForm(f => ({
    ...f,
    ...STONE_EMPTY,
    categoria: cat,
    procedimiento: '',
    abordaje: '',
    otro_especificar: '',
    orquiectomia_inguinal: false,
    orquiectomia_protesis: false,
  }));

  const handleProcedimientoChange = (procedimiento: string) => setForm(f => ({
    ...f,
    procedimiento,
    otro_especificar: procedimiento === 'Otros' ? f.otro_especificar : '',
    orquiectomia_inguinal: procedimiento === 'Orquiectomía' ? f.orquiectomia_inguinal : false,
    orquiectomia_protesis: procedimiento === 'Orquiectomía' ? f.orquiectomia_protesis : false,
  }));

  const setOrquiectomiaInguinal = (checked: boolean) => setForm(f => ({
    ...f,
    orquiectomia_inguinal: checked,
    orquiectomia_protesis: checked ? f.orquiectomia_protesis : false,
  }));

  const setOrquiectomiaProtesis = (checked: boolean) => setForm(f => ({
    ...f,
    orquiectomia_inguinal: checked ? true : f.orquiectomia_inguinal,
    orquiectomia_protesis: checked,
  }));

  const buildStonePayload = (procedureId: string): Omit<StoneDetails, 'created_at' | 'updated_at'> => ({
    procedure_id: procedureId,
    lateralidad: requiereStone ? lateralidad : null,
    procedimiento_raw: {
      urs: form.proc_urs,
      rirs: form.proc_rirs,
      nlpc: form.proc_nlpc,
    },
    nefromax_fr: form.proc_nlpc && form.nefromax && form.nefromax_fr ? parseInt(form.nefromax_fr, 10) : null,
    amplatz_fr: form.proc_nlpc && form.amplatz && form.amplatz_fr ? parseInt(form.amplatz_fr, 10) : null,
    enhebrado: form.proc_nlpc ? form.enhebrado : false,
    tamanio_mm: form.tamanio_mm ? parseFloat(form.tamanio_mm) : null,
    tutor_interno: form.drenaje && form.tutor_interno ? form.tutor_interno : null,
    drenaje_nefrostomico: form.proc_nlpc && form.drenaje_nefrostomico ? form.drenaje_nefrostomico : null,
    sonda_fr: form.proc_nlpc && form.drenaje_nefrostomico === 'Sonda' && form.sonda_fr ? parseInt(form.sonda_fr, 10) : null,
    etiqueta_drenaje: etiquetaDrenaje || null,
    stonefree: requiereStone ? form.stonefree === 'si' : null,
  });

  const validateStoneFields = (): string | null => {
    if (!procedimientoLitiasis) return 'Selecciona al menos un procedimiento de litiasis.';
    if (procedimientoLitiasis === 'ECIRS' && !form.rol) return null;
    if (!abordajeLitiasis) return 'No se pudo calcular el abordaje para este procedimiento y rol.';
    if (!requiereStone) return null;
    if (!lateralidad) return 'Selecciona la lateralidad.';
    if (form.stonefree === '') return 'Indica si el resultado stonefree es Sí o No.';
    if (form.drenaje && !form.tutor_interno) return 'Selecciona el tipo de tutor interno.';
    if (form.proc_nlpc && form.nefromax && !form.nefromax_fr) return 'Selecciona el calibre de Nefromax.';
    if (form.proc_nlpc && form.amplatz && !form.amplatz_fr) return 'Selecciona el calibre de Amplatz.';
    if (form.proc_nlpc && form.drenaje_nefrostomico === 'Sonda' && !form.sonda_fr) return 'Selecciona el calibre de la sonda.';
    return null;
  };

  const validateTeamFields = (): string | null => {
    if (!form.rol) return 'Selecciona tu rol.';
    if (!form.cirujano_senior.trim()) return 'Indica el cirujano senior.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isLitiasis) {
      const stoneError = validateStoneFields();
      if (stoneError) {
        setError(stoneError);
        return;
      }
    }

    if (!isLitiasis && form.procedimiento === 'Otros' && !form.otro_especificar.trim()) {
      setError('Especifica el procedimiento.');
      return;
    }

    const teamError = validateTeamFields();
    if (teamError) {
      setError(teamError);
      return;
    }

    const procFinal = buildStoredProcedure(form);
    const abordajeFinal = isLitiasis
      ? calcularAbordajeLitiasis(procFinal, form.rol) || form.abordaje
      : form.abordaje;
    if (!abordajeFinal) {
      setError('Selecciona el abordaje.');
      return;
    }

    setLoading(true);

    const payload: ProcedureDraft = {
      fecha: form.fecha,
      categoria: form.categoria,
      procedimiento: procFinal,
      abordaje: abordajeFinal,
      duracion: form.duracion ? parseInt(form.duracion, 10) : null,
      rol: form.rol,
      cirujano_senior: form.cirujano_senior.trim() || null,
      primer_ayudante: requierePrimerAyudante(form.rol) ? form.primer_ayudante.trim() || null : null,
      segundo_ayudante: muestraSegundoAyudante(form.rol) ? form.segundo_ayudante.trim() || null : null,
      complicaciones: form.complicaciones ? form.complicaciones_detalle.trim() || 'Si' : 'No',
      otro_especificar: !isLitiasis ? form.otro_especificar.trim() || null : null,
    };

    try {
      const ownerId = getDatabaseOwner();
      const procedures = await getAllProcedures();
      assertDatabaseOwner(ownerId);
      const potentialDuplicates = findPotentialDuplicates(payload, procedures, id);
      if (potentialDuplicates.length > 0 && !window.confirm(buildDuplicateWarning(potentialDuplicates))) {
        return;
      }

      const existing = isEdit ? procedures.find(item => item.id === id) : undefined;
      if (isEdit && !existing) throw new Error('Este registro ya no está disponible. Vuelve al listado.');
      const procedureId = existing?.id ?? crypto.randomUUID();
      const oldStone = existing ? await getStoneDetailsByProcedureId(procedureId) : null;
      assertDatabaseOwner(ownerId);
      const now = new Date().toISOString();
      const procedure: Procedure = {
        ...payload, id: procedureId, created_at: existing?.created_at ?? now,
        updated_at: now, deleted_at: null,
      };
      const details: StoneDetails[] = isLitiasis ? [{
        ...buildStonePayload(procedureId), created_at: oldStone?.created_at ?? now, updated_at: now,
      }] : [];
      await mergeDatabaseContents([procedure], details, isLitiasis ? [] : [procedureId]);
      assertDatabaseOwner(ownerId);

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        if (!isEdit) setForm({ ...EMPTY, fecha: new Date().toISOString().slice(0, 10) });
        else navigate('/listado');
      }, 1500);
    } catch (err) {
      console.error('[Nuevo] Save error:', err);
      setError(err instanceof Error ? err.message : 'Error guardando en la base local.');
    } finally {
      setLoading(false);
    }
  };

  const abordajesDisponibles = abordajeBloqueado
    ? TODOS_ABORDAJES
    : (REGLAS_ABORDAJE[form.categoria]?.[form.procedimiento] === SELECTABLE ? ABORDAJES_SELECCIONABLES : TODOS_ABORDAJES);

  return (
    <div>
      <h2 style={{ marginBottom: 20, fontSize: 20 }}>{isEdit ? 'Editar registro' : 'Nuevo registro'}</h2>
      {success && <div className="success-toast">Guardado correctamente</div>}
      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Fecha *</p>
          <input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} required />
        </div>

        <div className="form-group">
          <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Categoria *</p>
          <select value={form.categoria} onChange={e => handleCategoriaChange(e.target.value)} required>
            <option value="">Seleccionar categoria</option>
            {Object.keys(CATEGORIAS).map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        {isLitiasis ? (
          <>
            <div className="card-section">
              <div className="card-section-title">Procedimiento *</div>
              <div className="check-group">
                {[
                  { key: 'proc_urs' as const, label: 'URS' },
                  { key: 'proc_rirs' as const, label: 'RIRS' },
                  { key: 'proc_nlpc' as const, label: 'NLPC' },
                ].map(({ key, label }) => (
                  <button
                    type="button"
                    key={key}
                    className={`check-pill ${form[key] ? 'active' : ''}`}
                    onClick={() => setStoneProcedure(key, !form[key])}
                  >
                    {form[key] ? '✓' : '○'} {label}
                  </button>
                ))}
                {LITIASIS_SIMPLE_PROCEDURES.map(proc => (
                  <button
                    type="button"
                    key={proc}
                    className={`check-pill ${form.procedimiento === proc && !requiereStone ? 'active' : ''}`}
                    onClick={() => setLitiasisSimpleProcedure(proc)}
                  >
                    {form.procedimiento === proc && !requiereStone ? '✓' : '○'} {proc}
                  </button>
                ))}
              </div>
              {procedimientoLitiasis && (
                <div className="field-result">
                  {procedimientoLitiasis}
                </div>
              )}
            </div>

            {requiereStone && (
              <div className="card-section">
                <div className="card-section-title">Lateralidad *</div>
                <div className="check-group">
                  {[
                    { key: 'lat_dcha', label: 'Derecha' },
                    { key: 'lat_izq', label: 'Izquierda' },
                  ].map(({ key, label }) => (
                    <button
                      type="button"
                      key={key}
                      className={`check-pill ${form[key as keyof typeof STONE_EMPTY] ? 'active' : ''}`}
                      onClick={() => set(key, !form[key as keyof typeof STONE_EMPTY])}
                    >
                      {form[key as keyof typeof STONE_EMPTY] ? '✓' : '○'} {label}
                    </button>
                  ))}
                </div>
                {lateralidad && <div className="field-result">{lateralidad}</div>}
              </div>
            )}

            <div className="card-section">
              <div className="card-section-title">Tamaño litiasico</div>
              <input
                type="number"
                inputMode="numeric"
                value={form.tamanio_mm}
                onChange={e => set('tamanio_mm', e.target.value)}
                placeholder="Tamaño en mm"
                min="0"
                step="1"
              />
            </div>

            {form.proc_nlpc && (
              <div className="card-section">
                <div className="card-section-title">Dilatacion</div>
                <div className="stone-subgroup">
                  <button
                    type="button"
                    className={`check-pill ${form.nefromax ? 'active' : ''}`}
                    onClick={() => set('nefromax', !form.nefromax)}
                  >
                    {form.nefromax ? '✓' : '○'} Nefromax
                  </button>
                  {form.nefromax && (
                    <div className="radio-group">
                      {['24', '30'].map(fr => (
                        <button
                          type="button"
                          key={fr}
                          className={`radio-pill ${form.nefromax_fr === fr ? 'active' : ''}`}
                          onClick={() => set('nefromax_fr', fr)}
                        >
                          {fr} Fr
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="stone-subgroup">
                  <button
                    type="button"
                    className={`check-pill ${form.amplatz ? 'active' : ''}`}
                    onClick={() => set('amplatz', !form.amplatz)}
                  >
                    {form.amplatz ? '✓' : '○'} Amplatz
                  </button>
                  {form.amplatz && (
                    <div className="radio-group">
                      {['18', '20', '22', '24', '26', '28', '30'].map(fr => (
                        <button
                          type="button"
                          key={fr}
                          className={`radio-pill ${form.amplatz_fr === fr ? 'active' : ''}`}
                          onClick={() => set('amplatz_fr', fr)}
                        >
                          {fr} Fr
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={`check-pill ${form.enhebrado ? 'active' : ''}`}
                  onClick={() => set('enhebrado', !form.enhebrado)}
                >
                  {form.enhebrado ? '✓' : '○'} Enhebrado
                </button>
              </div>
            )}

            {requiereStone && (
              <>
                <div className="card-section">
                  <div className="card-section-title">Drenaje</div>

                  <p className="field-title">Interno</p>
                  <div className="check-group">
                    <button
                      type="button"
                      className={`check-pill ${form.drenaje ? 'active' : ''}`}
                      onClick={() => {
                        set('drenaje', !form.drenaje);
                        if (form.drenaje) set('tutor_interno', '');
                      }}
                    >
                      {form.drenaje ? '✓' : '○'} Tutor interno
                    </button>
                  </div>

                  {form.drenaje && (
                    <div className="radio-group">
                      {['JJ', 'MonoJ', 'Cat externo'].map(tutor => (
                        <button
                          type="button"
                          key={tutor}
                          className={`radio-pill ${form.tutor_interno === tutor ? 'active' : ''}`}
                          onClick={() => set('tutor_interno', tutor)}
                        >
                          {tutor}
                        </button>
                      ))}
                    </div>
                  )}

                  {form.proc_nlpc && (
                    <>
                      <p className="field-title" style={{ marginTop: 16 }}>Nefrostomico</p>
                      <div className="radio-group">
                        {['Sonda', 'NPC', 'Ninguno'].map(drenaje => (
                          <button
                            type="button"
                            key={drenaje}
                            className={`radio-pill ${form.drenaje_nefrostomico === drenaje ? 'active' : ''}`}
                            onClick={() => set('drenaje_nefrostomico', drenaje)}
                          >
                            {drenaje}
                          </button>
                        ))}
                      </div>

                      {form.drenaje_nefrostomico === 'Sonda' && (
                        <div className="radio-group">
                          {['10', '12', '14', '16'].map(fr => (
                            <button
                              type="button"
                              key={fr}
                              className={`radio-pill ${form.sonda_fr === fr ? 'active' : ''}`}
                              onClick={() => set('sonda_fr', fr)}
                            >
                              {fr} Fr
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {etiquetaDrenaje && <div className="field-result">{etiquetaDrenaje}</div>}
                </div>

                <div className="card-section">
                  <div className="card-section-title">Stonefree *</div>
                  <div className="radio-group">
                    {[
                      { value: 'si', label: 'Si' },
                      { value: 'no', label: 'No' },
                    ].map(item => (
                      <button
                        type="button"
                        key={item.value}
                        className={`radio-pill ${form.stonefree === item.value ? 'active' : ''}`}
                        onClick={() => set('stonefree', item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="two-cols">
              <div className="form-group">
                <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Abordaje *</p>
                <select
                  value={abordajeLitiasis}
                  onChange={e => set('abordaje', e.target.value)}
                  disabled={!abordajeLitiasisEditable}
                  required
                >
                  <option value="">Seleccionar abordaje</option>
                  {(abordajeLitiasisEditable ? ['Endoscópico', 'Percutáneo'] : TODOS_ABORDAJES).map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Duración (min)</p>
                <input type="number" value={form.duracion} onChange={e => set('duracion', e.target.value)} min="0" />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Procedimiento *</p>
              <select value={form.procedimiento} onChange={e => handleProcedimientoChange(e.target.value)} disabled={!form.categoria} required>
                <option value="">{form.categoria ? 'Seleccionar procedimiento' : 'Primero elige una categoria'}</option>
                {(CATEGORIAS[form.categoria] || []).map(proc => <option key={proc} value={proc}>{proc}</option>)}
              </select>
            </div>

            {form.procedimiento === 'Orquiectomía' && (
              <div className="card" style={{ marginBottom: 16 }}>
                <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 10 }}>Detalles de orquiectomía</p>
                <label className="checkbox-row">
                  <input type="checkbox" checked={form.orquiectomia_inguinal} onChange={e => setOrquiectomiaInguinal(e.target.checked)} />
                  <span>Inguinal</span>
                </label>
                <label className="checkbox-row" style={{ marginBottom: 0 }}>
                  <input type="checkbox" checked={form.orquiectomia_protesis} onChange={e => setOrquiectomiaProtesis(e.target.checked)} />
                  <span>Colocación de prótesis</span>
                </label>
              </div>
            )}

            {form.procedimiento === 'Otros' && (
              <div className="form-group">
                <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Especificar *</p>
                <input value={form.otro_especificar} onChange={e => set('otro_especificar', e.target.value)} required />
              </div>
            )}

            <div className="two-cols">
              <div className="form-group">
                <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Abordaje *</p>
                <select value={form.abordaje} onChange={e => set('abordaje', e.target.value)} disabled={abordajeBloqueado} required>
                  <option value="">Seleccionar abordaje</option>
                  {abordajesDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="form-group">
                <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Duración (min)</p>
                <input type="number" value={form.duracion} onChange={e => set('duracion', e.target.value)} min="0" />
              </div>
            </div>
          </>
        )}

        <div className="form-group">
          <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Mi rol *</p>
          <select value={form.rol} onChange={e => set('rol', e.target.value)} required>
            <option value="">Seleccionar rol</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="form-group">
          <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Cirujano senior *</p>
          <input value={form.cirujano_senior} onChange={e => set('cirujano_senior', e.target.value)} />
        </div>

        {requierePrimerAyudante(form.rol) && (
          <div className="form-group">
            <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Primer ayudante</p>
            <input value={form.primer_ayudante} onChange={e => set('primer_ayudante', e.target.value)} />
          </div>
        )}

        {muestraSegundoAyudante(form.rol) && (
          <div className="form-group">
            <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Segundo ayudante</p>
            <input value={form.segundo_ayudante} onChange={e => set('segundo_ayudante', e.target.value)} />
          </div>
        )}

        <div className="form-group">
          <label className="checkbox-row" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={form.complicaciones}
              onChange={e => setForm(f => ({
                ...f,
                complicaciones: e.target.checked,
                complicaciones_detalle: e.target.checked ? f.complicaciones_detalle : '',
              }))}
            />
            <span>Complicaciones</span>
          </label>
        </div>

        {form.complicaciones && (
          <div className="form-group">
            <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Detalle de complicaciones</p>
            <textarea
              value={form.complicaciones_detalle}
              onChange={e => set('complicaciones_detalle', e.target.value)}
              placeholder="Opcional"
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={loading}>
            {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Guardar registro'}
          </button>
          {isEdit && <button type="button" className="btn-ghost" onClick={() => navigate('/listado')}>Cancelar</button>}
        </div>
      </form>
    </div>
  );
}
