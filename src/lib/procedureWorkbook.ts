import * as XLSX from 'xlsx';
import type { Procedure, StoneDetails, StoneProcedureRaw } from './types';
import {
  getProcedureWorkbookFields, parseProcedureWorkbookFields, usesStructuredProcedureDetails,
} from './procedureDetails';
import { getMigrationReviewCases, migrateProcedureCatalog } from './migrationReview';

export const REQUIRED_IMPORT_COLUMNS = ['fecha', 'categoria', 'procedimiento', 'abordaje', 'rol'];
const REQUIRED_FIELDS = ['fecha', 'categoria', 'procedimiento', 'abordaje', 'rol'] as const;
type RequiredFields = Pick<Procedure, typeof REQUIRED_FIELDS[number]>;
type StoneImport = Omit<Partial<StoneDetails>, 'procedimiento_raw'> & { procedimiento_raw?: Partial<StoneProcedureRaw> };

export interface ProcedureImportRow {
  values: Partial<Procedure> & RequiredFields;
  generatedId: string;
  // undefined: old file without stone columns; null: explicitly no stone details.
  stone: StoneImport | null | undefined;
}

const PROCEDURE_COLUMNS = [
  'id', 'fecha', 'categoria', 'procedimiento', 'procedimiento_base',
  'tipo_derivacion_urinaria', 'tecnica', 'tipo_protesis', 'abordaje', 'duracion', 'rol',
  'cirujano_senior', 'primer_ayudante', 'segundo_ayudante', 'complicaciones',
  'otro_especificar', 'created_at', 'updated_at', 'deleted_at',
];
const STONE_COLUMNS = [
  'stone_detalles', 'stone_lateralidad', 'stone_urs', 'stone_rirs', 'stone_nlpc',
  'stone_nefromax_fr', 'stone_amplatz_fr', 'stone_enhebrado', 'stone_tamanio_mm',
  'stone_tutor_interno', 'stone_drenaje_nefrostomico', 'stone_sonda_fr',
  'stone_etiqueta_drenaje', 'stone_stonefree', 'stone_created_at', 'stone_updated_at',
];
const ALIASES: Record<string, string> = {
  mi_rol: 'rol', senior: 'cirujano_senior',
  duracion_min: 'duracion', 'duracion_(min)': 'duracion', ayudante_adicional: 'ayudante',
};

function normalizeHeader(value: unknown): string {
  const normalized = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, '_');
  return ALIASES[normalized] ?? normalized;
}

export function getProcedureWorkbookColumns(): string[] {
  return [...PROCEDURE_COLUMNS, ...STONE_COLUMNS];
}

export function createProcedureWorkbook(
  procedures: Procedure[], stoneDetails: StoneDetails[],
): XLSX.WorkBook {
  const stoneById = new Map(stoneDetails.map(item => [item.procedure_id, item]));
  const headers = getProcedureWorkbookColumns();
  const rows = procedures.map(procedure => {
    const stone = stoneById.get(procedure.id);
    const structured = getProcedureWorkbookFields(procedure.procedimiento, procedure.otro_especificar);
    const values: Record<string, unknown> = {
      ...procedure,
      procedimiento: structured.procedimientoFinal,
      procedimiento_base: structured.procedimientoBase,
      tipo_derivacion_urinaria: structured.tipoDerivacionUrinaria || null,
      tecnica: structured.tecnica || null,
      tipo_protesis: structured.tipoProtesis || null,
      otro_especificar: usesStructuredProcedureDetails(structured.procedimientoBase)
        ? null
        : procedure.otro_especificar,
      stone_detalles: !!stone,
    };
    if (stone) {
      for (const [key, value] of Object.entries(stone)) {
        if (key !== 'procedure_id' && key !== 'procedimiento_raw') values[`stone_${key}`] = value;
      }
      values.stone_urs = stone.procedimiento_raw.urs;
      values.stone_rirs = stone.procedimiento_raw.rirs;
      values.stone_nlpc = stone.procedimiento_raw.nlpc;
    }
    return headers.map(header => values[header] ?? null);
  });
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map(header => ({ wch: Math.min(32, Math.max(16, header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'UroFolium');
  const reviewCases = getMigrationReviewCases(procedures);
  if (reviewCases.length > 0) {
    const reviewRows = reviewCases.map(item => ({
      id: item.id,
      fecha: item.fecha,
      categoria_actual: item.categoriaActual,
      procedimiento_actual: item.procedimientoActual,
      abordaje_actual: item.abordajeActual,
      problemas: item.problemas.join(' '),
      categoria_sugerida: item.categoriaSugerida,
      procedimiento_sugerido: item.procedimientoSugerido,
      abordaje_sugerido: item.abordajeSugerido,
      accion_requerida: item.accionRequerida,
    }));
    const reviewSheet = XLSX.utils.json_to_sheet(reviewRows);
    reviewSheet['!cols'] = [
      { wch: 38 }, { wch: 12 }, { wch: 34 }, { wch: 40 }, { wch: 20 },
      { wch: 72 }, { wch: 34 }, { wch: 40 }, { wch: 20 }, { wch: 64 },
    ];
    XLSX.utils.book_append_sheet(workbook, reviewSheet, 'Pendientes de revisión');
  }
  return workbook;
}

export function readProcedureWorkbook(data: ArrayBuffer) {
  // Keep CSV values as text: automatic Excel date coercion can change calendar
  // dates across time zones and remove leading zeroes from identifiers.
  return parseProcedureWorkbook(XLSX.read(data, { type: 'array', cellDates: false, raw: true }));
}

function blank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function textOrNull(value: unknown): string | null {
  return blank(value) ? null : String(value);
}

function parseBoolean(value: unknown, nullable: boolean): boolean | null {
  if (blank(value)) return nullable ? null : false;
  const normalized = String(value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['si', 'yes', 'true', '1', 'x'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  throw new Error('usa Sí/No, true/false o 1/0');
}

function parseNumber(value: unknown, integer = false): number | null {
  if (blank(value)) return null;
  const number = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new Error(integer ? 'debe ser un entero mayor o igual a cero' : 'debe ser un número mayor o igual a cero');
  }
  return number;
}

function normalizeDate(value: unknown, date1904: boolean): string {
  let date: string;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!parsed) throw new Error('fecha no válida');
    date = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  } else if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('fecha no válida');
    date = value.toISOString().slice(0, 10);
  } else {
    const text = String(value ?? '').trim();
    const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/);
    const local = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    if (iso) date = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    else if (local) date = `${local[3].length === 2 ? `20${local[3]}` : local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
    else throw new Error('usa YYYY-MM-DD o DD/MM/YYYY');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('fecha no válida');
  return date;
}

function parseTimestamp(value: unknown): string | null {
  if (blank(value)) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error('usa una fecha y hora ISO con zona, por ejemplo 2026-07-01T12:00:00.000Z');
  }
  normalizeDate(text.slice(0, 10), false);
  return text;
}

export function parseProcedureWorkbook(workbook: XLSX.WorkBook): {
  rows: ProcedureImportRow[]; errors: string[];
} {
  const sheetName = ['UroFolium', 'Plantilla'].find(name => workbook.Sheets[name]) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { rows: [], errors: ['El archivo no contiene hojas.'] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const headers = (matrix[0] ?? []).map(normalizeHeader);
  const missing = REQUIRED_IMPORT_COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) return { rows: [], errors: [`Faltan columnas obligatorias: ${missing.join(', ')}`] };
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) return { rows: [], errors: [`Columnas repetidas: ${[...new Set(duplicateHeaders)].join(', ')}`] };
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const rows: ProcedureImportRow[] = [];

  matrix.slice(1).forEach((cells, index) => {
    if (cells.every(blank)) return;
    const source = Object.fromEntries(headers.filter(Boolean).map(header => [header, cells[headers.indexOf(header)]]));
    const has = (key: string) => Object.prototype.hasOwnProperty.call(source, key);
    const read = <T>(key: string, parser: (value: unknown) => T): T | undefined => {
      if (!has(key)) return undefined;
      try { return parser(source[key]); }
      catch (error) { errors.push(`Fila ${index + 2}, ${key}: ${error instanceof Error ? error.message : 'valor no válido'}.`); return undefined; }
    };
    const parsedProcedure = parseProcedureWorkbookFields(
      source.procedimiento,
      source.procedimiento_base,
      source.tipo_derivacion_urinaria,
      source.tecnica,
      source.tipo_protesis,
    );
    const values: Partial<Procedure> & RequiredFields = {
      fecha: read('fecha', value => normalizeDate(value, date1904)) ?? '',
      categoria: String(source.categoria ?? '').trim(),
      procedimiento: parsedProcedure.procedimiento,
      abordaje: String(source.abordaje ?? '').trim(),
      rol: String(source.rol ?? '').trim(),
    };
    for (const field of REQUIRED_FIELDS) {
      if (!values[field] && field !== 'fecha') errors.push(`Fila ${index + 2}: ${field} vacío.`);
    }
    const id = String(source.id ?? '').trim();
    if (id) {
      if (seenIds.has(id)) errors.push(`Fila ${index + 2}: id duplicado en el archivo.`);
      seenIds.add(id);
      values.id = id;
    }
    for (const field of ['cirujano_senior', 'primer_ayudante', 'segundo_ayudante', 'complicaciones'] as const) {
      if (has(field)) values[field] = textOrNull(source[field]);
    }
    const hasStructuredColumns = [
      'procedimiento_base', 'tipo_derivacion_urinaria', 'tecnica', 'tipo_protesis',
    ].some(has);
    if (hasStructuredColumns && usesStructuredProcedureDetails(parsedProcedure.procedimiento)) {
      values.otro_especificar = parsedProcedure.storedDetail;
    } else if (has('otro_especificar')) {
      values.otro_especificar = textOrNull(source.otro_especificar);
    } else if (parsedProcedure.storedDetail) {
      values.otro_especificar = parsedProcedure.storedDetail;
    }
    if (parsedProcedure.procedimiento === 'Cistectomía radical' && !values.otro_especificar) {
      errors.push(`Fila ${index + 2}: Cistectomía radical requiere tipo_derivacion_urinaria.`);
    }
    if (has('ayudante') && !blank(source.ayudante)) {
      const field = ['Segundo ayudante', 'Observador'].includes(values.rol) ? 'primer_ayudante' : 'segundo_ayudante';
      if (blank(source[field])) values[field] = textOrNull(source.ayudante);
    }
    if (has('duracion')) values.duracion = read('duracion', value => parseNumber(value, true));
    for (const field of ['created_at', 'updated_at'] as const) {
      const timestamp = read(field, parseTimestamp);
      if (timestamp) values[field] = timestamp;
    }
    if (has('deleted_at')) values.deleted_at = read('deleted_at', parseTimestamp) ?? null;

    let stone: StoneImport | null | undefined;
    const stoneValuesPresent = STONE_COLUMNS.some(column => column !== 'stone_detalles' && !blank(source[column]));
    const indicator = read('stone_detalles', value => parseBoolean(value, true));
    if (indicator === false) {
      stone = null;
      if (stoneValuesPresent) errors.push(`Fila ${index + 2}: stone_detalles es No pero contiene detalles de litiasis.`);
    } else if (indicator === true || stoneValuesPresent) {
      stone = {};
      for (const field of ['lateralidad', 'tutor_interno', 'drenaje_nefrostomico', 'etiqueta_drenaje'] as const) {
        if (has(`stone_${field}`)) stone[field] = textOrNull(source[`stone_${field}`]);
      }
      for (const field of ['nefromax_fr', 'amplatz_fr', 'sonda_fr', 'tamanio_mm'] as const) {
        if (has(`stone_${field}`)) stone[field] = read(`stone_${field}`, value => parseNumber(value, field !== 'tamanio_mm'));
      }
      if (has('stone_enhebrado')) stone.enhebrado = read('stone_enhebrado', value => parseBoolean(value, false)) ?? false;
      if (has('stone_stonefree')) stone.stonefree = read('stone_stonefree', value => parseBoolean(value, true)) ?? null;
      if (['urs', 'rirs', 'nlpc'].some(field => has(`stone_${field}`))) {
        stone.procedimiento_raw = {};
        for (const field of ['urs', 'rirs', 'nlpc'] as const) {
          if (has(`stone_${field}`)) stone.procedimiento_raw[field] = read(`stone_${field}`, value => parseBoolean(value, false)) ?? false;
        }
      }
      for (const field of ['created_at', 'updated_at'] as const) {
        const timestamp = read(`stone_${field}`, parseTimestamp);
        if (timestamp) stone[field] = timestamp;
      }
    }
    rows.push({ values, generatedId: id || crypto.randomUUID(), stone });
  });
  if (rows.length === 0) errors.push('El archivo está vacío o no tiene datos.');
  return { rows, errors };
}

export function materializeProcedureImport(
  rows: ProcedureImportRow[], existingProcedures: Procedure[], existingStoneDetails: StoneDetails[],
  now = new Date().toISOString(),
): { procedures: Procedure[]; stoneDetails: StoneDetails[]; removeStoneIds: string[] } {
  const byId = new Map(existingProcedures.map(item => [item.id, item]));
  const stoneById = new Map(existingStoneDetails.map(item => [item.procedure_id, item]));
  const stoneDetails: StoneDetails[] = [];
  const removeStoneIds: string[] = [];
  const procedures = rows.map(row => {
    const id = row.values.id || row.generatedId;
    const existing = byId.get(id);
    const procedureDraft: Procedure = {
      duracion: null, cirujano_senior: null, primer_ayudante: null, segundo_ayudante: null,
      complicaciones: null, otro_especificar: null, deleted_at: null,
      created_at: now, ...existing, updated_at: now, ...row.values, id,
    };
    const procedure = migrateProcedureCatalog(procedureDraft, now);
    if (row.stone === null) removeStoneIds.push(id);
    else if (row.stone !== undefined) {
      const existingStone = stoneById.get(id);
      const rawName = procedure.procedimiento.toUpperCase();
      stoneDetails.push({
        lateralidad: null,
        nefromax_fr: null, amplatz_fr: null, enhebrado: false, tamanio_mm: null,
        tutor_interno: null, drenaje_nefrostomico: null, sonda_fr: null, etiqueta_drenaje: null, stonefree: null,
        created_at: now, ...existingStone, updated_at: now, ...row.stone, procedure_id: id,
        procedimiento_raw: {
          urs: rawName.includes('URS'), rirs: rawName.includes('RIRS') || rawName === 'ECIRS',
          nlpc: rawName.includes('NLPC') || rawName === 'ECIRS',
          ...existingStone?.procedimiento_raw, ...row.stone.procedimiento_raw,
        },
      });
    }
    return procedure;
  });
  return { procedures, stoneDetails, removeStoneIds };
}
