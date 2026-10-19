import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getAllProcedures } from '../db/procedureRepository';
import { getAllStoneDetails } from '../db/stoneRepository';
import { assertDatabaseOwner, getDatabaseOwner, mergeDatabaseContents } from '../db/database';
import { REQUIRED_IMPORT_COLUMNS, getProcedureWorkbookColumns, materializeProcedureImport, readProcedureWorkbook, type ProcedureImportRow } from '../lib/procedureWorkbook';
import { ABORDAJES_SELECCIONABLES, CATEGORIAS, REGLAS_ABORDAJE, ROLES, SELECTABLE } from '../lib/categorias';
import type { Procedure } from '../lib/types';

type RowPreview = ProcedureImportRow;

type ImportSummary = {
  total: number;
  updates: number;
  creates: number;
  withId: number;
  withoutId: number;
};

const COLUMNAS_REQUERIDAS = REQUIRED_IMPORT_COLUMNS;

function getVisibleImportColumns(): string[] {
  return [...getProcedureWorkbookColumns(), 'ayudante'];
}

function summarizeRows(rows: RowPreview[], existingById: Map<string, Procedure>): ImportSummary {
  const updates = rows.filter(row => row.values.id && existingById.has(row.values.id)).length;
  const withId = rows.filter(row => row.values.id).length;

  return {
    total: rows.length,
    updates,
    creates: rows.length - updates,
    withId,
    withoutId: rows.length - withId,
  };
}

function formatImportSummary(summary: ImportSummary): string {
  if (summary.updates === 0) {
    return `Se crearan ${summary.creates} registros nuevos.`;
  }

  if (summary.creates === 0) {
    return `Se actualizaran ${summary.updates} registros existentes.`;
  }

  return `Se actualizaran ${summary.updates} registros existentes y se crearan ${summary.creates} nuevos.`;
}

function createTemplateRow(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(getVisibleImportColumns().map(column => [column, values[column] ?? '']));
}

function getTemplateApproaches(categoria: string, procedimiento: string): string {
  const rule = REGLAS_ABORDAJE[categoria]?.[procedimiento];
  if (!rule || rule === SELECTABLE) return ABORDAJES_SELECCIONABLES.join(', ');
  return rule;
}

function buildTemplateRows(): Record<string, string>[] {
  return [
    createTemplateRow({
      fecha: '2026-07-01',
      categoria: 'Endourología',
      procedimiento: 'RTU vesical',
      abordaje: 'Endoscópico',
      duracion: '60',
      rol: 'Cirujano principal',
      cirujano_senior: 'Cirujano senior',
      ayudante: 'Segundo ayudante',
      complicaciones: 'No',
    }),
    createTemplateRow({
      fecha: '2026-07-02',
      categoria: 'Genital masculina',
      procedimiento: 'Vasectomía',
      abordaje: 'Abierto',
      duracion: '45',
      rol: 'Segundo ayudante',
      cirujano_senior: 'Cirujano senior',
      ayudante: 'Primer ayudante',
      complicaciones: 'No',
    }),
  ];
}

function buildInstructions(): string[][] {
  return [
    ['Cómo usar esta plantilla'],
    ['1. Rellena la hoja Plantilla con una fila por cirugía. Puedes borrar las filas de ejemplo.'],
    ['2. No introduzcas nombre, NHC, DNI, fecha de nacimiento, teléfono ni ningún dato que identifique a un paciente.'],
    ['3. Importa solo datos quirúrgicos no identificativos.'],
    [`4. Las columnas obligatorias son: ${COLUMNAS_REQUERIDAS.join(', ')}.`],
    ['5. Usa una sola columna ayudante. UroFolium la guardará como primer_ayudante o segundo_ayudante según tu rol.'],
    ['6. También se aceptan las plantillas antiguas. Los campos opcionales que no aparecen como columnas se conservan al actualizar un id existente; una celda vacía borra ese campo.'],
    ['7. Fecha aceptada: YYYY-MM-DD o DD/MM/YYYY.'],
    ['8. Revisa la vista previa antes de confirmar la importación.'],
    ['9. La hoja Valores validos contiene categorías, procedimientos, abordajes y roles disponibles.'],
    ['10. Conserva id para actualizar el mismo registro. Sin id se creará uno nuevo; reimportar una plantilla sin id vuelve a crear registros.'],
    ['11. Las columnas stone_ guardan los detalles de litiasis. stone_detalles=Sí incluye los detalles; No los elimina. Si dejas todo el bloque vacío, los detalles existentes se conservan.'],
    ['12. Las fechas de creación y modificación (created_at y updated_at) son opcionales. Conserva las exportadas para mantener las fechas originales.'],
    [],
    ['Valores permitidos para rol'],
    ...ROLES.map(rol => [rol]),
    [],
    ['Valores sugeridos para complicaciones'],
    ['No'],
    ['Sí'],
    ['Texto breve no identificativo'],
  ];
}

function buildValidValuesRows(): string[][] {
  const rows: string[][] = [
    ['Categorías, procedimientos y abordajes'],
    ['categoria', 'procedimiento', 'abordajes_validos'],
  ];

  Object.entries(CATEGORIAS).forEach(([categoria, procedimientos]) => {
    procedimientos.forEach(procedimiento => {
      rows.push([categoria, procedimiento, getTemplateApproaches(categoria, procedimiento)]);
    });
  });

  rows.push(
    [],
    ['Roles válidos'],
    ['rol'],
    ...ROLES.map(rol => [rol]),
    [],
    ['Valores Sí/No aceptados'],
    ['campo', 'valores'],
    ['complicaciones', 'No, Sí, texto breve no identificativo']
  );

  return rows;
}

function downloadTemplate(): void {
  const columns = getVisibleImportColumns();
  const templateSheet = XLSX.utils.json_to_sheet(buildTemplateRows(), { header: columns });
  templateSheet['!cols'] = columns.map(column => ({ wch: Math.max(14, Math.min(column.length + 8, 28)) }));

  const helpSheet = XLSX.utils.aoa_to_sheet(buildInstructions());
  helpSheet['!cols'] = [{ wch: 112 }];

  const valuesSheet = XLSX.utils.aoa_to_sheet(buildValidValuesRows());
  valuesSheet['!cols'] = [{ wch: 34 }, { wch: 48 }, { wch: 44 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, templateSheet, 'Plantilla');
  XLSX.utils.book_append_sheet(workbook, helpSheet, 'Instrucciones');
  XLSX.utils.book_append_sheet(workbook, valuesSheet, 'Valores validos');
  XLSX.writeFile(workbook, 'urofolium-modelo-importacion.xlsx');
}

export default function Importar() {
  const [rows, setRows] = useState<RowPreview[]>([]);
  const [errores, setErrores] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [imported, setImported] = useState(0);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [fileName, setFileName] = useState('');
  const [existingProcedures, setExistingProcedures] = useState<Procedure[]>([]);
  const [previewOwner, setPreviewOwner] = useState<string | null>(null);
  useEffect(() => {
    const owner = getDatabaseOwner();
    getAllProcedures().then(data => {
      assertDatabaseOwner(owner);
      setExistingProcedures(data);
    }).catch(() => setExistingProcedures([]));
  }, []);

  const existingById = useMemo(
    () => new Map(existingProcedures.map(procedure => [procedure.id, procedure])),
    [existingProcedures]
  );
  const importSummary = useMemo(() => summarizeRows(rows, existingById), [rows, existingById]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const owner = getDatabaseOwner();
    setFileName(file.name);
    setSuccess(false);
    setImportResult(null);
    setErrores([]);
    setRows([]);
    setPreviewOwner(null);
    setLoading(true);

    try {
      const bytes = await file.arrayBuffer();
      assertDatabaseOwner(owner);
      const parsed = readProcedureWorkbook(bytes);
      const existing = await getAllProcedures();
      assertDatabaseOwner(owner);
      setExistingProcedures(existing);
      setRows(parsed.rows);
      setErrores(parsed.errors);
      setPreviewOwner(owner);
    } catch (error) {
      setErrores([`No se pudo leer el archivo: ${error instanceof Error ? error.message : 'archivo no válido'}`]);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (errores.length > 0 || rows.length === 0 || !previewOwner) return;
    setLoading(true);

    try {
      assertDatabaseOwner(previewOwner);
      const [existing, existingStone] = await Promise.all([getAllProcedures(), getAllStoneDetails()]);
      assertDatabaseOwner(previewOwner);
      const currentById = new Map(existing.map(procedure => [procedure.id, procedure]));
      const summaryBeforeImport = summarizeRows(rows, currentById);
      const payload = materializeProcedureImport(rows, existing, existingStone);
      await mergeDatabaseContents(payload.procedures, payload.stoneDetails, payload.removeStoneIds);
      assertDatabaseOwner(previewOwner);
      setImported(payload.procedures.length);
      setImportResult(summaryBeforeImport);
      setSuccess(true);
      setRows([]);
      setFileName('');
      setPreviewOwner(null);
      const merged = new Map(existing.map(procedure => [procedure.id, procedure]));
      for (const procedure of payload.procedures) merged.set(procedure.id, procedure);
      setExistingProcedures([...merged.values()].filter(procedure => procedure.deleted_at === null));
    } catch (error) {
      setErrores([`Error al importar: ${error instanceof Error ? error.message : 'error desconocido'}`]);
    } finally {
      setLoading(false);
    }
  };

  const filasTienenErrores = errores.length > 0;
  const previewHeaders = [
    'Accion',
    'Fecha',
    'Categoria',
    'Procedimiento',
    'Senior',
    'Rol',
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 8, fontSize: 20 }}>Importar desde Excel o CSV</h2>
      <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 20 }}>
        Importa una exportación de UroFolium para conservar identificadores, campos quirúrgicos y detalles de litiasis. También se aceptan las plantillas Excel o CSV anteriores.
      </p>

      {success && (
        <div className="success-toast" style={{ marginBottom: 16 }}>
          {importResult
            ? `${importResult.total} procedimientos procesados: ${importResult.updates} actualizados y ${importResult.creates} creados.`
            : `${imported} procedimientos importados correctamente`}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Columnas del archivo</h3>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
          Tu archivo debe incluir las columnas obligatorias y puede traer estas columnas:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {getVisibleImportColumns().map(c => (
            <span
              key={c}
              style={{
                background: COLUMNAS_REQUERIDAS.includes(c) ? 'var(--success-bg)' : 'rgba(120,124,124,0.1)',
                color: COLUMNAS_REQUERIDAS.includes(c) ? 'var(--primary)' : 'var(--text2)',
                padding: '3px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 500
              }}
            >
              {c}{COLUMNAS_REQUERIDAS.includes(c) ? ' *' : ''}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 10 }}>
          Las marcadas con * son obligatorias. Usa fechas YYYY-MM-DD o DD/MM/YYYY. Conserva la columna id para actualizar registros sin duplicarlos. Las celdas vacías borran campos opcionales; las columnas omitidas conservan los valores existentes. No importes datos identificativos de pacientes.
        </p>
        <button
          type="button"
          className="btn-ghost"
          onClick={downloadTemplate}
          style={{ marginTop: 12 }}
        >
          Descargar modelo Excel
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 8 }}>Seleccionar archivo</p>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          disabled={loading}
          style={{ fontSize: 14 }}
        />
        {fileName && (
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 8 }}>
            Archivo: {fileName} — {rows.length} filas detectadas
          </p>
        )}
      </div>

      {filasTienenErrores && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <h3 style={{ fontSize: 15, marginBottom: 10, color: 'var(--danger)' }}>
            Errores detectados ({errores.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {errores.slice(0, 10).map((e, i) => (
              <p key={i} style={{ fontSize: 13, color: 'var(--danger)' }}>• {e}</p>
            ))}
            {errores.length > 10 && (
              <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                ...y {errores.length - 10} errores mas. Corrige el archivo y vuelve a subirlo.
              </p>
            )}
          </div>
        </div>
      )}

      {rows.length > 0 && !filasTienenErrores && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>
            Vista previa — {rows.length} filas listas para importar
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
            {formatImportSummary(importSummary)}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {previewHeaders.map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontWeight: 500 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{r.values.id && existingById.has(r.values.id) ? 'Actualizar' : 'Crear'}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{r.values.fecha}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{r.values.categoria}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{r.values.procedimiento}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{r.values.cirujano_senior}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{r.values.rol}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 5 && (
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                ...y {rows.length - 5} filas mas
              </p>
            )}
          </div>
        </div>
      )}

      {rows.length > 0 && !filasTienenErrores && (
        <button
          className="btn-primary"
          style={{ width: '100%' }}
          onClick={handleImport}
          disabled={loading}
        >
          {loading ? `Importando...` : `Importar ${rows.length} procedimientos`}
        </button>
      )}
    </div>
  );
}
