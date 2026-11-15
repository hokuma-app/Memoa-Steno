import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import type { ChecklistLive } from './contracts';

/**
 * The host-planned live check, for display. The host keeps the state per recording and pushes every change, so any
 * mount, remount, route change or hidden window starts from the host's truth instead of from nothing. A snapshot
 * that arrives after a newer push never replaces it (every state carries a growing `seq`).
 */
export function useLiveChecklist(enabled: boolean): { known: boolean; failed: boolean; live: ChecklistLive } {
  const [state, setState] = useState<{ known: boolean; failed: boolean; live: ChecklistLive }>({ known: false, failed: false, live: { active: false, seq: -1 } });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const apply = (next: ChecklistLive) => setState((current) => (next.seq >= current.live.seq ? { known: true, failed: false, live: next } : { ...current, known: true }));
    // Subscribe first so a push that lands while the snapshot is in flight is not lost.
    const off = ipc().on.checklistLiveState((next) => { if (alive) apply(next); });
    void ipc().checklists.liveState().then((answer) => {
      if (!alive) return;
      if (answer.success) apply(answer.live);
      else setState((current) => ({ ...current, known: true, failed: true }));
    }).catch(() => { if (alive) setState((current) => ({ ...current, known: true, failed: true })); });
    return () => { alive = false; off?.(); };
  }, [enabled]);
  return enabled ? state : { known: false, failed: false, live: { active: false, seq: -1 } };
}
