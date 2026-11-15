import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import type { AgendaLive } from './contracts';

type View = { known: boolean; failed: boolean; live: AgendaLive; receivedAt: number };
const IDLE: View = { known: false, failed: false, live: { active: false, seq: -1 }, receivedAt: 0 };

/**
 * The host-planned meeting state, for display. The host keeps it per recording and pushes every change, so a mount,
 * remount, route change or hidden window starts from the host's truth. An older snapshot never replaces a newer push
 * (every state carries a growing `seq`). `receivedAt` lets the display tick the running clock between pushes; the
 * signals themselves always come from the host.
 */
export function useLiveAgenda(enabled: boolean): View & { apply: (next: AgendaLive) => void } {
  const [state, setState] = useState<View>(IDLE);
  const apply = useCallback((next: AgendaLive) => setState((current) => (next.seq >= current.live.seq
    ? { known: true, failed: false, live: next, receivedAt: Date.now() } : { ...current, known: true })), []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // Subscribe first so a push that lands while the snapshot is in flight is not lost. A bridge without the channel
    // (older preload, test double) fails closed as "could not load", never as a crash of the recording page.
    let off: (() => void) | undefined;
    try { off = ipc().on.agendaLiveState((next) => { if (alive) apply(next); }); }
    catch { off = undefined; }
    void Promise.resolve().then(() => ipc().agenda.liveState()).then((answer) => {
      if (!alive) return;
      if (answer.success) apply(answer.live);
      else setState((current) => ({ ...current, known: true, failed: true }));
    }).catch(() => { if (alive) setState((current) => ({ ...current, known: true, failed: true })); });
    return () => { alive = false; off?.(); };
  }, [enabled, apply]);
  return enabled ? { ...state, apply } : { ...IDLE, apply };
}
