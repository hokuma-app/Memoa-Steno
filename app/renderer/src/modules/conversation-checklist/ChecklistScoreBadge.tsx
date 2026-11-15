import { useEffect } from 'react';
import { useModuleEnabled } from '@/hooks/useProductSettings';
import { requestNoteScore, useNoteScore } from './noteScores';
import { overviewText as t } from './overviewCopy';

/** "Checklist 7/8" (discussed/total) on a note that has a checklist result; nothing otherwise. */
export function ChecklistScoreBadge({ summaryFile }: { summaryFile: string }) {
  const enabled = useModuleEnabled('conversation-checklist');
  useEffect(() => { if (enabled) requestNoteScore(summaryFile); }, [enabled, summaryFile]);
  const score = useNoteScore(summaryFile);
  if (!enabled || !score) return null;
  return <span data-testid="checklist-score" title={score.title}
    className="inline-flex items-center rounded-full bg-[color:var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[color:var(--fg-2)]">
    {t('scoreBadge', { covered: score.covered, total: score.total })}
  </span>;
}
