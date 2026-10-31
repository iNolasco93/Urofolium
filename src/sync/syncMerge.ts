import type { Conflict, Entries, Resolutions } from './syncModel';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([key]) => key !== 'updated_at').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function hashes(entries: Entries): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : 1).map(async ([id, value]) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
    return [id, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')];
  })));
}
export function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }
export async function mergeEntries(channel: string, local: Entries, remote: Entries, baseline: Record<string, string> = {}, resolutions: Resolutions = new Map()): Promise<{ merged: Entries; conflicts: Conflict[] }> {
  const [lh, rh] = await Promise.all([hashes(local), hashes(remote)]);
  const result: [string, unknown][] = [];
  const conflicts: Conflict[] = [];
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const left = Object.prototype.hasOwnProperty.call(local, id) ? local[id] : undefined;
    const right = Object.prototype.hasOwnProperty.call(remote, id) ? remote[id] : undefined;
    // Absence in an old backup or a newly linked device never means deletion.
    // A deleted surgery remains a complete case carrying deleted_at.
    if (left === undefined) { result.push([id, right]); continue; }
    if (right === undefined) { result.push([id, left]); continue; }
    if (lh[id] === rh[id] || rh[id] === baseline[id]) { result.push([id, left]); continue; }
    if (lh[id] === baseline[id]) { result.push([id, right]); continue; }
    const resolution = resolutions.get(JSON.stringify([channel, id]));
    if (resolution?.localHash === lh[id] && resolution.remoteHash === rh[id]) {
      result.push([id, resolution.choice === 'local' ? left : right]);
    } else conflicts.push({ channel, id, local: left, remote: right, localHash: lh[id], remoteHash: rh[id] });
  }
  return { merged: Object.fromEntries(result), conflicts };
}
