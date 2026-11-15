import { useState } from 'react';
import { Check } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { MAX_NOT_APPLICABLE_REASON } from './contracts';
import type { ChecklistCitedQuote, ChecklistLevel, ChecklistNoteResult, ChecklistOverviewRow } from './contracts';
import { refreshNoteScore } from './noteScores';
import { runtimeText as t } from './runtimeCopy';
import './checklist.css';

type Found = Extract<ChecklistNoteResult, { found: true }>;
const stamp = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
const who = (quote: ChecklistCitedQuote) => t(quote.speaker === 'seller' ? 'noteSellerSaid' : quote.speaker === 'other' ? 'noteCustomerSaid' : 'noteUnknownSaid');
const LEVEL_TEXT: Record<ChecklistLevel, Parameters<typeof t>[0]> = {
  notHeard: 'noteLevelNotHeard', mentioned: 'noteLevelMentioned', explained: 'noteLevelExplained', explainedConfirmed: 'noteLevelConfirmed',
};

/** The result of the conversation checklist, inside the note itself. The only human actions are rejecting an AI tick and Niet van toepassing. */
export function ChecklistNoteTab({ noteFile, result, onChanged }: { noteFile: string; result: Found; onChanged: (result: Found) => void }) {
  const { overview } = result;
  const [editing, setEditing] = useState<{ id: string; mode: 'reject' | 'notApplicable'; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const counts = overview.counts;
  const missed = counts.unmentioned + counts.uncertain + counts.pending;

  const copy = async () => {
    try { await navigator.clipboard.writeText(result.markdown); setMessage({ text: t('noteCopied'), failed: false }); }
    catch { setMessage({ text: t('noteCopyFailed'), failed: true }); }
  };
  const correct = async (criterionId: string, action: 'reject' | 'notApplicable' | 'clear', reason?: string) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const answer = await ipc().checklists.correctNote({ noteFile, criterionId, action, ...(reason !== undefined ? { reason } : {}) });
      if (!answer.success || !answer.found) throw new Error('correct');
      onChanged(answer);
      refreshNoteScore(noteFile);
      setEditing(null);
    } catch { setMessage({ text: t('noteCorrectionFailed'), failed: true }); }
    finally { setBusy(false); }
  };

  return <section data-testid="checklist-note-tab" aria-label={result.title} className="space-y-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div data-testid="checklist-pills" className="flex flex-wrap gap-2">
        <span className="veneta-pill veneta-pill-good">{t('notePillCovered', { count: counts.covered })}</span>
        <span className="veneta-pill veneta-pill-warn">{t('notePillPartial', { count: counts.partial })}</span>
        <span className="veneta-pill veneta-pill-bad">{t('notePillMissed', { count: missed })}</span>
        {counts.notApplicable > 0 && <span className="veneta-pill">{t('notePillNotApplicable', { count: counts.notApplicable })}</span>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>{t('noteCopy')}</Button>
    </div>
    {result.finalRunning && <p data-testid="checklist-final-running" role="status">{t('noteFinalRunning')}</p>}
    {message && <p role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
    <ul className="space-y-2">
      {overview.rows.map((row) => <Row key={row.criterionId} row={row} busy={busy}
        editing={editing?.id === row.criterionId ? editing : null}
        onEdit={(mode) => setEditing({ id: row.criterionId, mode, reason: '' })}
        onReason={(reason) => setEditing((current) => (current ? { ...current, reason } : current))}
        onCancel={() => setEditing(null)}
        onCorrect={(action, reason) => void correct(row.criterionId, action, reason)} />)}
    </ul>
    <p className="text-[12px] text-[color:var(--fg-2)]">{t('noteAiDisclaimer')}</p>
  </section>;
}

type RowProps = {
  row: ChecklistOverviewRow; busy: boolean; editing: { mode: 'reject' | 'notApplicable'; reason: string } | null;
  onEdit: (mode: 'reject' | 'notApplicable') => void; onReason: (reason: string) => void; onCancel: () => void;
  onCorrect: (action: 'reject' | 'notApplicable' | 'clear', reason?: string) => void;
};
function Row({ row, busy, editing, onEdit, onReason, onCancel, onCorrect }: RowProps) {
  const notApplicable = row.effective === 'notApplicable';
  const aiTick = !row.rejected && !notApplicable && (row.effective === 'covered' || row.effective === 'partial');
  const levelText = notApplicable ? t('noteLevelNotApplicable') : row.effective === 'uncertain'
    ? t('noteLevelUncertain') : t(LEVEL_TEXT[row.level ?? 'notHeard']);
  const mark = row.effective === 'covered' ? 'done' : row.effective === 'partial' ? 'half' : 'open';
  const reason = editing?.reason.trim() ?? '';
  return <li data-state={row.effective} className="space-y-1 rounded-lg border border-border p-3">
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className={`veneta-live-mark veneta-live-mark-${mark}`}>{mark === 'done' && <Check size={13} strokeWidth={3} />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="break-words font-medium">{row.label}</span>
          <span data-level={row.level ?? 'notApplicable'} className="text-[12.5px] font-medium">{levelText}</span>
        </div>
        {row.evidence.map((quote, index) => <p key={index} className="break-words text-[12px] text-[color:var(--fg-2)]">
          {stamp(quote.start)} · {who(quote)}: <q>{quote.quote}</q></p>)}
        {row.customerEvidence.map((quote, index) => <p key={`c${index}`} className="break-words text-[12px] text-[color:var(--fg-2)]">
          {stamp(quote.start)} · {who(quote)}: <q>{quote.quote}</q></p>)}
        {!row.evidence.length && row.explanation && <p className="break-words text-[12px] text-[color:var(--fg-2)]">{row.explanation}</p>}
        {row.rejected && <p className="break-words text-[12px]">{t('noteRejected', { reason: row.rejected.reason })}
          {row.aiStatus && row.aiStatus !== 'unmentioned' && row.aiStatus !== 'uncertain' && <>{' · '}{t('noteAiHadMarked', { level: t(row.aiStatus === 'covered' ? 'noteLevelExplained' : 'noteLevelMentioned') })}</>}</p>}
        {notApplicable && row.correction?.reason && <p className="break-words text-[12px]">{t('noteReasonPrefix', { reason: row.correction.reason })}</p>}
        {row.ignoredManual && <p className="text-[12px] text-[color:var(--fg-2)]">{t('noteIgnoredManual')}</p>}
        {editing ? <div className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label={t('noteReason')} placeholder={t('noteReason')} maxLength={MAX_NOT_APPLICABLE_REASON} value={editing.reason}
            onChange={(event) => onReason(event.target.value)} className="min-w-[16rem] flex-1 rounded border border-border bg-transparent p-1.5" />
          <Button type="button" size="sm" disabled={busy || !reason} onClick={() => onCorrect(editing.mode, reason)}>
            {t(editing.mode === 'reject' ? 'noteRejectConfirm' : 'noteNotApplicableSave')}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>{t('noteCancel')}</Button>
        </div> : <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
          {aiTick && <button type="button" className="border-0 bg-transparent p-0 underline" onClick={() => onEdit('reject')}>{t('noteReject')}</button>}
          {row.rejected && <button type="button" className="border-0 bg-transparent p-0 underline" disabled={busy} onClick={() => onCorrect('clear')}>{t('noteUndoReject')}</button>}
          {notApplicable && <button type="button" className="border-0 bg-transparent p-0 underline" disabled={busy} onClick={() => onCorrect('clear')}>{t('noteUndoNotApplicable')}</button>}
          {!notApplicable && !row.rejected && <button type="button" className="border-0 bg-transparent p-0 underline" onClick={() => onEdit('notApplicable')}>{t('noteNotApplicable')}</button>}
        </div>}
      </div>
    </div>
  </li>;
}
