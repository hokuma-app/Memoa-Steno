import { useCallback, useEffect, useState } from 'react';
import { useModuleEnabled } from '@/hooks/useProductSettings';
import { ipc } from '@/lib/ipc';
import type { AgendaNoteFound } from './contracts';
import { agendaText as t } from './locales/nl';

const POLL_MS = 2500;
const MAX_POLLS = 48;

/** The minutes bound to one note, for the tab in the note. Nothing is read while the module is off. */
export function useNoteAgenda(noteFile: string) {
  const enabled = useModuleEnabled('agenda-chair');
  const [state, setState] = useState<{ file: string; result: AgendaNoteFound | null }>({ file: noteFile, result: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void Promise.resolve().then(() => ipc().agenda.noteResult({ noteFile })).then((answer) => {
      if (alive) setState({ file: noteFile, result: answer.success && answer.found ? answer : null });
    }).catch(() => { if (alive) setState({ file: noteFile, result: null }); });
    return () => { alive = false; };
  }, [enabled, noteFile]);
  const shown = enabled && state.file === noteFile ? state.result : null;
  const finalRunning = shown?.finalRunning === true;
  // The last check may still run right after the recording stopped: ask again while the host says so (bounded).
  useEffect(() => {
    if (!finalRunning) return;
    let alive = true; let polls = 0;
    const timer = setInterval(() => {
      if (++polls > MAX_POLLS) { clearInterval(timer); return; }
      void ipc().agenda.noteResult({ noteFile }).then((answer) => {
        if (!alive || !answer.success || !answer.found) return;
        setState({ file: noteFile, result: answer });
        if (!answer.finalRunning) clearInterval(timer);
      }).catch(() => { /* The next tick asks again. */ });
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [finalRunning, noteFile]);
  const update = useCallback((result: AgendaNoteFound) => setState({ file: noteFile, result }), [noteFile]);
  return { result: shown, label: shown ? t('noteTab') : null, update };
}
