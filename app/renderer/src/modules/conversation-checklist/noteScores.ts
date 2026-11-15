import { useSyncExternalStore } from 'react';
import { ipc } from '@/lib/ipc';
import type { ChecklistNoteScore } from './contracts';

// Scores of the notes in a list, fetched in one batch per render pass and kept for the session.
const BATCH = 200;
const known = new Map<string, ChecklistNoteScore | null>();
const wanted = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const publish = () => listeners.forEach((listener) => listener());

async function flush() {
  timer = undefined;
  const files = [...wanted];
  wanted.clear();
  for (let at = 0; at < files.length; at += BATCH) {
    const noteFiles = files.slice(at, at + BATCH);
    try {
      const result = await ipc().checklists.noteScores({ noteFiles });
      for (const file of noteFiles) known.set(file, result.success ? (result.scores[file] ?? null) : null);
    } catch {
      for (const file of noteFiles) known.set(file, null);
    }
  }
  publish();
}

export function requestNoteScore(file: string): void {
  if (known.has(file) || wanted.has(file)) return;
  wanted.add(file);
  timer ??= setTimeout(() => void flush(), 0);
}
/** A correction on the note changed the result: ask again. */
export function refreshNoteScore(file: string): void {
  known.delete(file);
  requestNoteScore(file);
}
export function resetNoteScores(): void {
  known.clear(); wanted.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  publish();
}
export function useNoteScore(file: string): ChecklistNoteScore | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => known.get(file) ?? null,
  );
}
