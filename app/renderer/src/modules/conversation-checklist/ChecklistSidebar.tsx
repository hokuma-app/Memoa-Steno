import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { ChecklistLiveState, ChecklistSegment } from './contracts';
import { levelOf } from './domain';
import { overviewText as t } from './overviewCopy';
import './checklist.css';

export interface ChecklistSidebarProps {
  /** Everything shown comes from the host planner; this component plans, checks and remembers nothing. */
  live: ChecklistLiveState;
  /** The name of the chosen checklist when the host did not send one. */
  fallbackName: string;
  /** Scroll the transcript to this segment; false when the transcript cannot show it right now. */
  onJump?: (segment: ChecklistSegment) => boolean;
}

const MARK = { notHeard: 'open', mentioned: 'half', explained: 'done', explainedConfirmed: 'done' } as const;
const stamp = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const sameLabel = (label: string) => label.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Sidebar beside the notes: display only. A remount loses nothing, because the host keeps the state. */
export function ChecklistSidebar({ live, fallbackName, onJump }: ChecklistSidebarProps) {
  const title = live.title ?? fallbackName;
  const result = live.result;
  // The same point twice is one point, whatever the saved list looks like.
  const seen = new Set<string>();
  const criteria = live.criteria.filter((item) => { const key = sameLabel(item.label); if (seen.has(key)) return false; seen.add(key); return true; });
  const mappingConfirmed = live.mappingConfirmed;
  const [jumpFailed, setJumpFailed] = useState(false);
  useEffect(() => {
    if (!jumpFailed) return;
    const timer = setTimeout(() => setJumpFailed(false), 6000);
    return () => clearTimeout(timer);
  }, [jumpFailed]);

  const state = { kind: live.phase };
  const statusText = (() => {
    switch (live.phase) {
      case 'noText': return t('liveNoText');
      case 'waiting': return t('liveWaiting');
      case 'busy': return t('liveBusy');
      case 'finalBusy': return t('liveFinalBusy');
      case 'tooLarge': return t('liveTooLarge');
      case 'listening':
      case 'ended': return live.lastRunAt ? t('liveListening', { time: clock(live.lastRunAt) }) : t('liveEnded');
      case 'error': return live.failure ? t('liveError', { time: clock(live.failure.at), advice: t(`reason_${live.failure.reason}`) }) : t('liveEnded');
    }
  })();
  const diagnostics = t('liveDiagnostics', { lines: live.counters.lines, checks: live.counters.checks, reason: live.lastReason ?? 'geen' })
    + (live.counters.window ? t('liveDiagnosticsWindow', { window: live.counters.window }) : '');
  const rows = criteria.map((criterion) => {
    const assessment = result?.response.assessments.find((a) => a.criterionId === criterion.id);
    const level = levelOf(assessment);
    const quote = assessment?.evidence.find((e) => result?.segments.some((s) => s.id === e.segmentId));
    const segment = quote ? result?.segments.find((s) => s.id === quote.segmentId) : undefined;
    const customerQuote = level === 'explainedConfirmed'
      ? assessment?.customerEvidence?.find((e) => result?.segments.some((s) => s.id === e.segmentId && s.speaker === 'other'))
      : undefined;
    return { criterion, assessment, level, quote, segment, customerQuote };
  });
  const done = rows.filter((row) => row.level === 'explained' || row.level === 'explainedConfirmed').length;
  return (
    <section data-checklist-runtime aria-label={title} className="veneta-live-checklist flex flex-col gap-3 py-3 text-sm">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold">{title}</h2>
          <span className="shrink-0 font-semibold tabular-nums">{t('liveCounter', { done, total: criteria.length })}</span>
        </div>
        <div role="progressbar" aria-label={t('liveProgress')} aria-valuemin={0} aria-valuemax={criteria.length} aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded-full bg-[color:var(--border-subtle)]">
          <div className="h-full rounded-full bg-[color:var(--fg-1)] transition-[width]" style={{ width: `${criteria.length ? (done / criteria.length) * 100 : 0}%` }} />
        </div>
        <p role="status" aria-label={t('liveStatusTitle')} data-checklist-status={state.kind}
          className="flex min-w-0 items-start gap-2 break-words text-[12.5px] text-[color:var(--fg-2)]">
          <span aria-hidden="true" className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${state.kind === 'error' ? 'bg-[color:var(--danger,#b42318)]' : 'bg-[color:var(--success,#2f7d4f)]'}`} />
          <span>{statusText}</span>
        </p>
        <p data-checklist-diagnostics className="text-[11.5px] text-[color:var(--fg-2)]">{diagnostics}</p>
        {!mappingConfirmed && <p className="text-[12px] text-[color:var(--fg-2)]">{t('liveSellerOff')}</p>}
      </header>
      <ul className="flex flex-col gap-1" aria-live="polite">
        {rows.map(({ criterion, level, quote, segment, customerQuote, assessment }) => {
          const state = MARK[level];
          const body = <>
            <span aria-hidden="true" className={`veneta-live-mark veneta-live-mark-${state}`}>{state === 'done' && <Check size={13} strokeWidth={3} />}</span>
            <span className="min-w-0 flex-1 text-left">
            <span className="sr-only">{assessment?.status === 'uncertain' ? t('noteLevelUncertain') : t(state === 'open' ? 'liveStateOpen' : state === 'half' ? 'liveStateHalf' : 'liveStateDone')}: </span>
            <span className="block break-words font-medium">{criterion.label}</span>
            {assessment?.status === 'uncertain' && <span className="block text-[12px] text-[color:var(--cl-warn)]">{t('noteLevelUncertain')}</span>}
            {state === 'half' && <span className="block text-[12px] text-[color:var(--cl-warn)]">{t('liveMentioned')}</span>}
            {assessment?.status === 'uncertain' && <span className="block break-words text-[12px] text-[color:var(--fg-2)]">{assessment.explanation}</span>}
              {level === 'explainedConfirmed' && <span data-customer-confirmed className="block break-words text-[12px] text-[color:var(--success,#2f7d4f)]">
                {t('liveCustomerConfirmed')}{customerQuote && <>{': '}<q>{customerQuote.quote}</q></>}
              </span>}
              {quote && segment && <span className="block break-words text-[12px] text-[color:var(--fg-2)]">
                <q>{quote.quote}</q>{' '}{stamp(segment.start)} · {t(segment.speaker === 'seller' ? 'liveSeller' : segment.speaker === 'other' ? 'liveCustomer' : 'liveUnknown')}
              </span>}
            </span>
          </>;
          return <li key={criterion.id} data-state={state}>
            {segment ? <button type="button" className="veneta-live-point flex w-full items-start gap-2 rounded-md border-0 bg-transparent p-1.5 text-left hover:bg-[color:var(--surface-hover)]"
              onClick={() => setJumpFailed(onJump ? !onJump(segment) : true)}>{body}</button>
              : <div className="veneta-live-point flex items-start gap-2 p-1.5">{body}</div>}
          </li>;
        })}
      </ul>
      {jumpFailed && <p className="text-[12px] text-[color:var(--fg-2)]">{t('liveTranscriptClosed')}</p>}
      <p className="text-[11.5px] text-[color:var(--fg-2)]">{t('liveHint')}</p>
    </section>
  );
}
