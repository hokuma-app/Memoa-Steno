import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ipc } from '@/lib/ipc';
import { AGENDA_LIMITS } from './contracts';
import type { AgendaFindingGroups, AgendaMinutesFinding, AgendaMinutesItem, AgendaNoteFound } from './contracts';
import { speakerText, stamp } from './format';
import { agendaText as t } from './locales/nl';
import './agenda.css';

type Edit = { id: string; mode: 'correct' | 'reject'; text: string; owner: string; due: string; reason: string };

/**
 * The minutes of the meeting, per agenda item, inside the note. Every decision, action and question carries its quote,
 * time and speaker. Human review per finding: confirm, reject, correct (text, owner, deadline) or undo. A human
 * correction always wins; unconfirmed findings stay marked as a proposal. Copy as markdown.
 */
export function AgendaNoteTab({ noteFile, result, onChanged }: { noteFile: string; result: AgendaNoteFound; onChanged: (result: AgendaNoteFound) => void }) {
  const { minutes } = result;
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.markdown); setMessage({ text: t('noteCopied'), failed: false }); }
    catch { setMessage({ text: t('noteCopyFailed'), failed: true }); }
  };
  const review = async (findingId: string, action: 'confirm' | 'reject' | 'correct' | 'clear', extra: { text?: string; owner?: string | null; due?: string | null; reason?: string } = {}) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const answer = await ipc().agenda.correctNote({ noteFile, findingId, action, ...extra });
      if (!answer.success || !answer.found) throw new Error('correct');
      onChanged(answer); setEdit(null);
    } catch { setMessage({ text: t('noteCorrectionFailed'), failed: true }); }
    finally { setBusy(false); }
  };
  const actions = { busy, edit, setEdit, review };
  const hasOther = minutes.other.decisions.length + minutes.other.actions.length + minutes.other.questions.length > 0;
  return <section data-testid="agenda-note-tab" aria-label={t('noteTab')} className="veneta-agenda-note space-y-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div data-testid="agenda-pills" className="flex flex-wrap gap-2">
        <span className="veneta-agenda-pill">{t('notePillDecisions', { count: minutes.counts.decisions })}</span>
        <span className="veneta-agenda-pill">{t('notePillActions', { count: minutes.counts.actions })}</span>
        <span className="veneta-agenda-pill">{t('notePillQuestions', { count: minutes.counts.questions })}</span>
        <span className="veneta-agenda-pill veneta-agenda-pill-warn">{t('notePillProposals', { count: minutes.counts.proposals })}</span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>{t('noteCopy')}</Button>
    </div>
    {result.finalRunning && <p role="status" data-testid="agenda-final-running">{t('noteFinalRunning')}</p>}
    {message && <p role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
    <ol className="space-y-4">
      {minutes.items.map((item) => <Item key={item.id} item={item} ownerMissing={minutes.ownerMissing} {...actions} />)}
    </ol>
    {hasOther && <section aria-label={t('noteOther')} className="space-y-2">
      <h3 className="font-semibold">{t('noteOther')}</h3>
      <Groups groups={minutes.other} ownerMissing={minutes.ownerMissing} {...actions} />
    </section>}
    <p className="text-[12px] text-[color:var(--fg-2)]">{t('noteDisclaimer')}</p>
  </section>;
}

type Actions = { busy: boolean; edit: Edit | null; setEdit: (edit: Edit | null) => void; review: (id: string, action: 'confirm' | 'reject' | 'correct' | 'clear', extra?: { text?: string; owner?: string | null; due?: string | null; reason?: string }) => Promise<void> };

function Item({ item, ownerMissing, ...actions }: { item: AgendaMinutesItem; ownerMissing: string[] } & Actions) {
  const meta = [t(`outcome_${item.outcome}`), item.minutes ? t('noteMetaMinutes', { minutes: item.minutes }) : null,
    item.owner ? t('noteMetaOwner', { owner: item.owner }) : null, item.required ? t('noteMetaRequired') : null].filter(Boolean).join(t('noteMetaJoin'));
  const empty = !item.decisions.length && !item.actions.length && !item.questions.length;
  const heading = t('noteItemHeading', { number: item.number, title: item.title });
  return <li className="veneta-agenda-note-item rounded-lg p-3" data-agenda-note-item={item.id} aria-label={heading}>
    <h3 className="font-semibold">{heading}</h3>
    <p className="text-[12px] text-[color:var(--fg-2)]">{meta}</p>
    <p className="mt-1 flex flex-wrap gap-2 text-[12px]">
      <span className="veneta-agenda-status">{item.status === 'loopt' ? t('noteStatusRunning') : t(`status_${item.status}`)}</span>
      <span>{item.minutes ? t('noteSpent', { spent: stamp(item.spentSec), limit: stamp(item.minutes * 60) }) : t('noteSpentOpen', { spent: stamp(item.spentSec) })}</span>
      {item.overTime && <span className="veneta-agenda-signal" data-signal="over_tijd">{t('noteOverTime')}</span>}
      {item.missingOutcome && <span className="veneta-agenda-signal" data-signal="uitkomst_ontbreekt">{t('noteMissingOutcome')}</span>}
    </p>
    {empty ? <p className="mt-2 text-[color:var(--fg-2)]">{t('noteNothing')}</p> : <Groups groups={item} ownerMissing={ownerMissing} {...actions} />}
  </li>;
}

function Groups({ groups, ownerMissing, ...actions }: { groups: AgendaFindingGroups; ownerMissing: string[] } & Actions) {
  const section = (title: string, rows: AgendaMinutesFinding[]) => rows.length > 0 && <div className="mt-2">
    <h4 className="text-[13px] font-medium">{title}</h4>
    <ul className="mt-1 space-y-2">{rows.map((row) => <Finding key={row.id} row={row} ownerMissing={ownerMissing.includes(row.id)} {...actions} />)}</ul>
  </div>;
  return <>
    {section(t('noteDecisions'), groups.decisions)}
    {section(t('noteActions'), groups.actions)}
    {section(t('noteQuestions'), groups.questions)}
  </>;
}

function Finding({ row, ownerMissing, busy, edit, setEdit, review }: { row: AgendaMinutesFinding; ownerMissing: boolean } & Actions) {
  const editing = edit && edit.id === row.id ? edit : null;
  const rejected = row.review === 'afgewezen';
  const changed = row.review === 'gecorrigeerd' && row.ai.text !== row.text;
  return <li className={`veneta-agenda-note-finding rounded-md p-2${rejected ? ' veneta-agenda-rejected' : ''}`} data-finding={row.id} data-review={row.review}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <span className={rejected ? 'line-through' : ''}>{row.text}</span>
      <span className={`veneta-agenda-tag veneta-agenda-review-${row.review}`}>{t(`review_${row.review}`)}</span>
    </div>
    {row.kind !== 'vraag' && <p className="text-[12px] text-[color:var(--fg-2)]">
      {t('noteOwner', { owner: row.owner ?? t('noteNotSaid') })}{t('noteMetaJoin')}{t('noteDue', { due: row.due ?? t('noteNotSaid') })}
    </p>}
    {ownerMissing && row.review !== 'afgewezen' && <p className="veneta-agenda-signal mt-1 inline-block" data-signal="besluit_zonder_eigenaar">{t('noteOwnerMissing')}</p>}
    <blockquote className="veneta-agenda-quote mt-1 text-[12px]">
      {t('noteQuote', { quote: row.evidence.quote })}
      <span className="block text-[color:var(--fg-2)]">{t('noteQuoteMeta', { time: stamp(row.evidence.start), speaker: speakerText(row.evidence.speaker) })}</span>
    </blockquote>
    {changed && <p className="text-[12px] text-[color:var(--fg-2)]">{t('noteAiWas', { text: row.ai.text })}</p>}
    {row.reason && <p className="text-[12px] text-[color:var(--fg-2)]">{t('noteReasonPrefix', { reason: row.reason })}</p>}
    {!editing && <div className="mt-1 flex flex-wrap gap-1">
      {row.review === 'voorstel' && <>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void review(row.id, 'confirm')}>{t('noteConfirm')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEdit({ id: row.id, mode: 'correct', text: row.text, owner: row.owner ?? '', due: row.due ?? '', reason: '' })}>{t('noteCorrect')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEdit({ id: row.id, mode: 'reject', text: '', owner: '', due: '', reason: '' })}>{t('noteReject')}</Button>
      </>}
      {row.review !== 'voorstel' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void review(row.id, 'clear')}>{t('noteUndo')}</Button>}
    </div>}
    {editing && editing.mode === 'correct' && <form className="mt-2 grid gap-2" onSubmit={(event) => {
      event.preventDefault();
      void review(row.id, 'correct', { text: editing.text, ...(row.kind !== 'vraag' ? { owner: editing.owner.trim() || null, due: editing.due.trim() || null } : {}) });
    }}>
      <label className="grid gap-1"><span>{t('noteFieldText')}</span>
        <input type="text" value={editing.text} maxLength={300} required onChange={(event) => setEdit({ ...editing, text: event.target.value })} className="veneta-agenda-input rounded-md px-2 py-1" /></label>
      {row.kind !== 'vraag' && <>
        <label className="grid gap-1"><span>{t('noteFieldOwner')}</span>
          <input type="text" value={editing.owner} maxLength={AGENDA_LIMITS.ownerChars} onChange={(event) => setEdit({ ...editing, owner: event.target.value })} className="veneta-agenda-input rounded-md px-2 py-1" /></label>
        <label className="grid gap-1"><span>{t('noteFieldDue')}</span>
          <input type="text" value={editing.due} maxLength={80} onChange={(event) => setEdit({ ...editing, due: event.target.value })} className="veneta-agenda-input rounded-md px-2 py-1" /></label>
      </>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !editing.text.trim()}>{t('noteSave')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>{t('noteCancel')}</Button>
      </div>
    </form>}
    {editing && editing.mode === 'reject' && <form className="mt-2 grid gap-2" onSubmit={(event) => {
      event.preventDefault();
      void review(row.id, 'reject', editing.reason.trim() ? { reason: editing.reason.trim() } : {});
    }}>
      <label className="grid gap-1"><span>{t('noteFieldReason')}</span>
        <input type="text" value={editing.reason} maxLength={200} onChange={(event) => setEdit({ ...editing, reason: event.target.value })} className="veneta-agenda-input rounded-md px-2 py-1" /></label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{t('noteRejectConfirm')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>{t('noteCancel')}</Button>
      </div>
    </form>}
  </li>;
}
