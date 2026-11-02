import type { Procedure } from './types';

export const ACCESS_ROUTES = ['Transperitoneal', 'Retroperitoneal'] as const;
export type AccessRoute = typeof ACCESS_ROUTES[number];

const ROUTE_PROCEDURES: Record<string, ReadonlySet<string>> = {
  'Patología renal': new Set([
    'Nefrectomía radical', 'Nefroureterectomía', 'Nefrectomía parcial',
    'Tumorectomía renal', 'Quistectomía renal', 'Suprarrenalectomía',
  ]),
  'Patología ureteral': new Set(['Pieloplastia', 'Pielo/ureterolitotomía']),
  'Cirugía de trasplante': new Set(['Extracción renal donante vivo']),
};

export function supportsAccessRoute(categoria: string, procedimiento: string): boolean {
  return ROUTE_PROCEDURES[categoria]?.has(procedimiento) ?? false;
}

export function isAbdominalApproach(abordaje: string): boolean {
  return ['Abierto', 'Laparoscópico', 'Robótico', 'Retroperitoneal'].includes(abordaje);
}

export function accessRouteOf(procedure: Pick<Procedure, 'abordaje' | 'via_acceso'>): AccessRoute | null {
  if (procedure.via_acceso === 'Transperitoneal' || procedure.via_acceso === 'Retroperitoneal') return procedure.via_acceso;
  return procedure.abordaje === 'Retroperitoneal' ? 'Retroperitoneal' : null;
}

export function formatApproach(procedure: Pick<Procedure, 'abordaje' | 'via_acceso'>): string {
  const route = accessRouteOf(procedure);
  return [procedure.abordaje, route && route !== procedure.abordaje ? route : null].filter(Boolean).join(' · ');
}
