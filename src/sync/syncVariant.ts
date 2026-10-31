import type { Procedure, StoneDetails } from '../lib/types';
import { casesFromLocal, validateCases, type Baseline, type CaseData, type SyncData } from './syncModel';
import { commitCommon, readChannel } from './syncRemote';
import type { SyncEnvelope } from './syncCrypto';

export const validators = { cases: validateCases };
export function splitData(procedures: Procedure[], stones: StoneDetails[], _baseline: Baseline | null): SyncData {
  return { cases: casesFromLocal(procedures, stones) };
}
export function joinData(data: SyncData): { procedures: Procedure[]; stoneDetails: StoneDetails[] } {
  const cases = Object.values(data.cases) as CaseData[];
  return { procedures: cases.map(item => item.procedure), stoneDetails: cases.flatMap(item => item.stone ? [item.stone] : []) };
}
export async function readRemote(userId: string, signal: AbortSignal) {
  return { cases: await readChannel('urofolium_sync_state', userId, signal) };
}
export function commitRemote(userId: string, expected: Record<string, number>, updates: Record<string, SyncEnvelope>, signal: AbortSignal) {
  return commitCommon(userId, expected.cases, updates.cases, signal);
}

export { describeCase as describeSyncValue } from './syncPresentation';
