const listeners = new Set<() => void>();
export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function emitLocalChange(): void { listeners.forEach(listener => listener()); }
export function emitRemoteChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('urofolium-remote-change'));
}

const lockListeners = new Set<() => void>();
export function onDatabaseLock(listener: () => void): () => void { lockListeners.add(listener); return () => { lockListeners.delete(listener); }; }
export function emitDatabaseLock(): void { lockListeners.forEach(listener => listener()); }
