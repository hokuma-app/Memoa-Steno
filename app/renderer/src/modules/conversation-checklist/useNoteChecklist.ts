import { useCallback, useEffect, useState } from 'react';
import { useModuleEnabled } from '@/hooks/useProductSettings';
import { ipc } from '@/lib/ipc';
import type { ChecklistNoteResult } from './contracts';

const POLL_MS = 2500;
/** Without a running last check, a note without an AI result is asked for this many more times (about a minute). */
const MAX_QUIET_POLLS = 24;

type Found = Extract<ChecklistNoteResult, { found: true }>;

/** The checklist result bound to one note, for the tab in the note. Nothing is read while the module is off. */
export function useNoteChecklist(noteFile: string) {
  const enabled = useModuleEnabled('conversation-checklist');
  const [state, setState] = useState<{ file: string; result: Found | null }>({ file: noteFile, result: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void ipc().checklists.noteResult({ noteFile }).then((answer) => {
      if (alive) setState({ file: noteFile, result: answer.success && answer.found ? answer : null });
    }).catch(() => { if (alive) setState({ file: noteFile, result: null }); });
    return () => { alive = false; };
  }, [enabled, noteFile]);
  // The last check of the conversation may still be running right after the recording stopped, or only claim after the
  // sidecar drained: ask again while the host says so, and (bounded) while the note has no AI result yet.
  const shown = enabled && state.file === noteFile ? state.result : null;
  const finalRunning = shown?.finalRunning === true;
  const unevaluated = shown !== null && shown.overview.evaluatedAt === null;
  const waiting = finalRunning || unevaluated;
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    let running = finalRunning;
    let quiet = 0;
    const timer = setInterval(() => {
      if (!running && ++quiet > MAX_QUIET_POLLS) { clearInterval(timer); return; }
      void ipc().checklists.noteResult({ noteFile }).then((answer) => {
        if (!alive || !answer.success || !answer.found) return;
        running = answer.finalRunning === true;
        if (running) quiet = 0;
        setState({ file: noteFile, result: answer });
      }).catch(() => { /* The next tick asks again. */ });
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [waiting, finalRunning, noteFile]);
  const update = useCallback((result: Found) => setState({ file: noteFile, result }), [noteFile]);
  // A result of another note must never show under this one while the new one loads.
  const result = shown;
  const label = result ? `${result.title} ${result.overview.score.covered}/${result.overview.score.total}` : null;
  return { result, label, update };
}
