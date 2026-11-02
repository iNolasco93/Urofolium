import { getProcedureWorkbookFields, usesStructuredProcedureDetails } from '../lib/procedureDetails';
import { accessRouteOf } from '../lib/accessRoutes';
import type { CaseData } from './syncModel';

export function describeCase(value: unknown): [string, string][] {
  const { procedure: p, stone: s } = value as CaseData;
  const show = (item: unknown) => item == null || item === '' ? 'Sin indicar' : typeof item === 'boolean' ? item ? 'Sí' : 'No' : String(item);
  const values: [string, unknown][] = [
    ['Fecha', p.fecha], ['Estado de cirugía', p.estado === 'programada' ? 'Programada' : 'Realizada'], ['Notas', p.notas], ['Categoría', p.categoria], ['Procedimiento', getProcedureWorkbookFields(p.procedimiento, p.otro_especificar).procedimientoFinal],
    ['Detalle del procedimiento', usesStructuredProcedureDetails(p.procedimiento) ? null : p.otro_especificar], ['Abordaje', p.abordaje], ['Vía de acceso', accessRouteOf(p)], ['Rol', p.rol],
    ['Duración (min)', p.duracion], ['Cirujano senior', p.cirujano_senior],
    ['Primer ayudante', p.primer_ayudante], ['Segundo ayudante', p.segundo_ayudante],
    ['Complicaciones', p.complicaciones], ['Estado', p.deleted_at ? 'Eliminado' : 'Activo'],
  ];
  if (s) values.push(
    ['Lateralidad', s.lateralidad], ['URS', s.procedimiento_raw.urs], ['RIRS', s.procedimiento_raw.rirs], ['NLPC', s.procedimiento_raw.nlpc],
    ['Tamaño litiásico (mm)', s.tamanio_mm], ['Nefromax (Fr)', s.nefromax_fr], ['Amplatz (Fr)', s.amplatz_fr],
    ['Enhebrado', s.enhebrado], ['Tutor interno', s.tutor_interno], ['Drenaje nefrostómico', s.drenaje_nefrostomico],
    ['Sonda (Fr)', s.sonda_fr], ['Drenaje', s.etiqueta_drenaje], ['Stone-free', s.stonefree],
  );
  else values.push(['Detalles de litiasis', 'Sin detalles']);
  return values.map(([label, item]) => [label, show(item)]);
}
