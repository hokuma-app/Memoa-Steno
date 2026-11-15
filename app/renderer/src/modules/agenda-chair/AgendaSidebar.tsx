import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AgendaAction, AgendaFinding, AgendaItem, AgendaLiveActive, AgendaSignal } from './contracts';
import { reasonAdvice, stamp } from './format';
import { agendaText as t } from './locales/nl';
import './agenda.css';

const clockOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '');

function statusLine(live: AgendaLiveActive): string {
  switch (live.phase) {
    case 'listening': return t('liveListening', { time: clockOf(live.lastRunAt) });
    case 'noText': return t('liveNoText');
    case 'waiting': return t('liveWaiting');
    case 'busy': return t('liveBusy');
    case 'finalBusy': return t('liveFinalBusy');
    case 'tooLarge': return t('liveTooLarge');
    case 'error': return t('liveError', { time: clockOf(live.failure?.at ?? null), advice: reasonAdvice(live.failure?.reason ?? 'failed') });
    default: return t('liveEnded');
  }
}
function signalText(signal: AgendaSignal, items: AgendaItem[]): string {
  if (signal.code === 'besluit_zonder_eigenaar') return t('signal_besluit_zonder_eigenaar', { missing: signal.missing.map((key) => t(`missing_${key}`)).join(t('missingJoin')) });
  if (signal.code === 'vereist_punt_open') {
    return t('signal_vereist_punt_open', { titles: signal.itemIds.map((id) => items.find((item) => item.id === id)?.title ?? id).join(t('listJoin')) });
  }
  return t(`signal_${signal.code}`);
}

/**
 * The silent chair during a recording: running item, time per item against its time block, the host's signals, the
 * suggested switch (one tap to confirm) and manual start, finish, skip and defer. It only shows what the host reports;
 * the running clock ticks locally between pushes, for display only.
 */
export function AgendaSidebar({ live, receivedAt, onAction, error }: {
  live: AgendaLiveActive; receivedAt: number; onAction: (action: AgendaAction, itemId?: string) => void; error: string | null;
}) {
  const running = Object.values(live.items).some((item) => item.running) && !live.ended;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const since = Math.max(0, now - receivedAt);
  const items = live.agenda.items;
  const numberOf = (id: string) => items.findIndex((item) => item.id === id) + 1;
  const suggestion = live.suggestion;
  const suggested = suggestion ? items.find((item) => item.id === suggestion.itemId) : null;
  const requiredOpen = live.signals.find((signal) => signal.code === 'vereist_punt_open');
  const elapsedMs = live.planned.meetingMs + (live.ended ? 0 : since);

  return <section className="veneta-agenda-live space-y-3 p-4 text-sm" data-agenda-runtime aria-label={t('liveRegion')}>
    <header>
      <h2 className="text-[16px] font-semibold">{live.agenda.title || t('liveHeading')}</h2>
      <p className="text-[12px] text-[color:var(--fg-2)]">{t('liveDisclosure')}</p>
      {live.planned.totalMinutes > 0 && <p className="text-[12px] text-[color:var(--fg-2)]" data-agenda-total>
        {t('liveTotal', { planned: stamp(live.planned.totalMinutes * 60), elapsed: stamp(elapsedMs / 1000) })}
      </p>}
    </header>
    <p role="status" aria-label={t('liveStatusTitle')}>{statusLine(live)}</p>
    <p className="text-[11px] text-[color:var(--fg-2)]" data-agenda-diagnostics>
      {t('liveDiagnostics', { lines: live.counters.lines, checks: live.counters.checks, reason: live.lastReason ?? t('liveNone') })}
    </p>
    {suggestion && suggested && <div className="veneta-agenda-suggestion rounded-md p-3" role="region" aria-label={t('liveSuggestion', { number: numberOf(suggested.id), title: suggested.title })} data-testid="agenda-suggestion">
      <p className="font-medium">{t('liveSuggestion', { number: numberOf(suggested.id), title: suggested.title })}</p>
      <p className="text-[12px] text-[color:var(--fg-2)]">{t('liveSuggestionQuote', { quote: suggestion.quote, time: stamp(suggestion.start) })}</p>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={() => onAction('confirmSuggestion', suggestion.itemId)}>{t('liveConfirm')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onAction('dismissSuggestion', suggestion.itemId)}>{t('liveDismiss')}</Button>
      </div>
    </div>}
    {requiredOpen && <p role="alert" className="veneta-agenda-warn rounded-md p-2" data-signal="vereist_punt_open">{signalText(requiredOpen, items)}</p>}
    {error && <p role="alert">{error}</p>}
    <ol className="space-y-2">
      {items.map((item, index) => <Row key={item.id} item={item} number={index + 1} live={live} since={since} onAction={onAction} />)}
    </ol>
  </section>;
}

function Row({ item, number, live, since, onAction }: { item: AgendaItem; number: number; live: AgendaLiveActive; since: number; onAction: (action: AgendaAction, itemId?: string) => void }) {
  const state = live.items[item.id];
  const spentMs = state.spentMs + (state.running && !live.ended ? since : 0);
  const limitMs = item.minutes ? item.minutes * 60_000 : null;
  const ratio = limitMs ? Math.min(1, spentMs / limitMs) : 0;
  const signals = live.signals.filter((signal) => 'itemId' in signal && signal.itemId === item.id);
  const timeSignal = signals.find((signal) => signal.code === 'tijd_om') ? 'over' : signals.find((signal) => signal.code === 'tijd_bijna_om') ? 'near' : 'ok';
  const findings = live.findings.filter((finding) => finding.itemId === item.id);
  const isRunning = state.status === 'loopt';
  const label = t('liveItemLabel', { number, title: item.title });
  return <li className={`veneta-agenda-row rounded-md p-2${isRunning ? ' veneta-agenda-row-running' : ''}`} data-agenda-item={item.id} data-status={state.status} aria-label={label}>
    <div className="flex items-start justify-between gap-2">
      <span className="font-medium">{label}</span>
      <span className="veneta-agenda-status text-[12px]">{t(`status_${state.status}`)}</span>
    </div>
    <div className="mt-1 flex items-center gap-2 text-[12px] text-[color:var(--fg-2)]">
      <span data-agenda-time>{limitMs ? t('liveTime', { spent: stamp(spentMs / 1000), limit: stamp(limitMs / 1000) }) : t('liveTimeOpen', { spent: stamp(spentMs / 1000) })}</span>
      {state.recognition && <span>{t(state.recognition === 'mens' ? 'liveRecognitionHuman' : 'liveRecognitionAgent')}</span>}
    </div>
    {limitMs && <div className={`veneta-agenda-bar veneta-agenda-bar-${timeSignal}`} role="progressbar" aria-label={t('liveProgress', { number })}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <span style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>}
    {signals.length > 0 && <ul className="mt-1 flex flex-wrap gap-1">
      {signals.map((signal, at) => <li key={`${signal.code}-${at}`} className="veneta-agenda-signal" data-signal={signal.code}>{signalText(signal, live.agenda.items)}</li>)}
    </ul>}
    {findings.length > 0 && <Findings findings={findings} />}
    {!live.ended && <div className="mt-2 flex flex-wrap gap-1">
      {!isRunning && <Button type="button" size="sm" variant="outline" onClick={() => onAction('start', item.id)}>{t('liveStart')}</Button>}
      {(isRunning || state.status === 'open') && <Button type="button" size="sm" variant="ghost" onClick={() => onAction('finish', item.id)}>{t('liveFinish')}</Button>}
      {state.status !== 'overgeslagen' && state.status !== 'afgerond' && <Button type="button" size="sm" variant="ghost" onClick={() => onAction('skip', item.id)}>{t('liveSkip')}</Button>}
      {state.status !== 'doorgeschoven' && state.status !== 'afgerond' && <Button type="button" size="sm" variant="ghost" onClick={() => onAction('defer', item.id)}>{t('liveDefer')}</Button>}
    </div>}
  </li>;
}

function Findings({ findings }: { findings: AgendaFinding[] }) {
  const count = (kind: AgendaFinding['kind']) => findings.filter((finding) => finding.kind === kind).length;
  return <div className="mt-2 space-y-1">
    <p className="text-[12px] text-[color:var(--fg-2)]">{t('liveFindings', { decisions: count('besluit'), actions: count('actie'), questions: count('vraag') })}</p>
    <ul className="space-y-1">
      {findings.slice(-3).map((finding) => <li key={finding.id} className="veneta-agenda-finding rounded p-1 text-[12px]" data-finding-kind={finding.kind}>
        <span className="veneta-agenda-tag">{t(`kind_${finding.kind}`)}</span> <span className="veneta-agenda-tag">{t('liveFindingProposal')}</span> {finding.text}
        {finding.owner && <span className="block text-[color:var(--fg-2)]">{t('liveOwner', { owner: finding.owner })}</span>}
        {finding.due && <span className="block text-[color:var(--fg-2)]">{t('liveDue', { due: finding.due })}</span>}
      </li>)}
    </ul>
  </div>;
}
