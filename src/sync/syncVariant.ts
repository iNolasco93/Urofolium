import { supabase } from '../auth/authService';
import type { Procedure, StoneDetails } from '../lib/types';
import type { PersonalProcedure } from '../lib/personalProcedures';
import { casesFromLocal, type Baseline, type CaseData, type SyncData } from './syncModel';
import { readChannel, requestSignal } from './syncRemote';
import type { SyncEnvelope } from './syncCrypto';
import { casesWithCatalogMarker, catalogEntries, describeCatalogValue, validateCatalogEntries, validateCasesWithCatalogMarker, withoutCatalogMarker } from './syncCatalog';
import { describeCase } from './syncPresentation';

export const validators = { cases: validateCasesWithCatalogMarker, catalog: validateCatalogEntries };
export function splitData(procedures: Procedure[], stones: StoneDetails[], _baseline: Baseline | null, catalog: PersonalProcedure[]): SyncData {
  return { cases: casesWithCatalogMarker(casesFromLocal(procedures, stones), catalog), catalog: catalogEntries(catalog) };
}
export function joinData(data: SyncData): { procedures: Procedure[]; stoneDetails: StoneDetails[]; personalProcedures: PersonalProcedure[] } {
  const cases = Object.values(withoutCatalogMarker(data.cases)) as CaseData[];
  return { procedures: cases.map(item => item.procedure), stoneDetails: cases.flatMap(item => item.stone ? [item.stone] : []), personalProcedures: Object.values(validateCatalogEntries(data.catalog)) as PersonalProcedure[] };
}
export async function readRemote(userId: string, signal: AbortSignal) {
  return { cases: await readChannel('urofolium_sync_state', userId, signal), catalog: await readChannel('urofolium_sync_catalog', userId, signal) };
}
export async function commitRemote(userId: string, expected: Record<string, number>, updates: Record<string, SyncEnvelope>, signal: AbortSignal) {
  const { data, error } = await supabase.rpc('urofolium_sync_commit_catalog', {
    owner_id: userId, expected_revision: expected.cases, next_envelope: updates.cases ?? null,
    expected_catalog_revision: expected.catalog, next_catalog_envelope: updates.catalog ?? null,
  }).abortSignal(requestSignal(signal));
  if (error) throw new Error(`No se pudo guardar la sincronización: ${error.message}`);
  return data as Record<string, number> | null;
}
export function describeSyncValue(value: unknown): [string, string][] {
  return value && typeof value === 'object' && 'abordajes' in value ? describeCatalogValue(value) : describeCase(value);
}
export const prepareLocal = undefined;
export const reconcile = undefined;
