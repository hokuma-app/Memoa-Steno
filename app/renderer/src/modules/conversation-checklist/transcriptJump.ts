import type { ChecklistSegment } from './contracts';

const FLASH_MS = 1600;

/** Scrolls the live transcript to the row of a quoted segment. False when it is not on screen (panel closed). */
export function jumpToTranscriptSegment(segment: ChecklistSegment): boolean {
  if (!Number.isFinite(segment.start)) return false;
  const row = document.querySelector<HTMLElement>(`[data-testid="live-transcript-panel"] [data-live-start="${segment.start}"]`);
  if (!row) return false;
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  row.classList.add('veneta-jump-flash');
  window.setTimeout(() => row.classList.remove('veneta-jump-flash'), FLASH_MS);
  return true;
}
