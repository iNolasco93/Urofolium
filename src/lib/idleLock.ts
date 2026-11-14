import { useEffect, useRef } from 'react';

/** Minutes without interaction before the web vault locks itself. */
export const IDLE_LOCK_MINUTES = 15;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * Calls onIdle once after `minutes` without user activity. Time is measured with timestamps,
 * so a tab left in the background is locked as soon as it becomes visible again.
 */
export function useIdleLock(enabled: boolean, onIdle: () => void, minutes = IDLE_LOCK_MINUTES): void {
  const callback = useRef(onIdle);
  callback.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    const limit = minutes * 60_000;
    let last = Date.now();
    let fired = false;
    const check = () => {
      if (fired || Date.now() - last < limit) return;
      fired = true;
      callback.current();
    };
    // Check before refreshing: a click after a long absence must lock, not extend the session.
    const activity = () => { check(); if (!fired) last = Date.now(); };
    const visibility = () => { if (document.visibilityState === 'visible') check(); };
    ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, activity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(check, 30_000);
    return () => {
      ACTIVITY_EVENTS.forEach(event => window.removeEventListener(event, activity, { capture: true }));
      document.removeEventListener('visibilitychange', visibility);
      clearInterval(timer);
    };
  }, [enabled, minutes]);
}
