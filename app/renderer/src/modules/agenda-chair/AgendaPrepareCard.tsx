import { useEffect, useId, useRef, useState } from 'react';
import { useModuleEnabled } from '@/hooks/useProductSettings';
import { ipc } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { AGENDA_LIMITS, AGENDA_OUTCOMES } from './contracts';
import type { Agenda, AgendaItem, AgendaOutcome } from './contracts';
import { agendaText as t } from './locales/nl';
import './agenda.css';

/** Home: the agenda that stands ready for the next recording. Nothing is read or shown while the module is off. */
export function AgendaPrepareCard() {
  const enabled = useModuleEnabled('agenda-chair');
  return enabled ? <Card /> : null;
}

type Mode = 'view' | 'input' | 'edit';
const norm = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const nextId = (items: AgendaItem[]) => {
  const used = new Set(items.map((item) => item.id));
  for (let index = items.length + 1; ; index++) if (!used.has(`p${index}`)) return `p${index}`;
};
const minutesOf = (value: string): number | null => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 1 ? Math.min(AGENDA_LIMITS.minutes, number) : null;
};

/** File.text() where the engine has it (Electron), FileReader otherwise. */
const readText = (file: File): Promise<string> => (typeof file.text === 'function' ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error ?? new Error('read'));
  reader.readAsText(file);
}));

function Card() {
  const [prepared, setPrepared] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('view');
  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agenda | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useId();
  const pasteId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => ipc().agenda.getPreparation()).then((result) => {
      if (!alive) return;
      if (result.success) setPrepared(result.preparation); else setError(t('failed'));
    }).catch(() => { if (alive) setError(t('failed')); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > AGENDA_LIMITS.fileBytes) { setError(t('fileTooLarge')); return; }
    try {
      const content = await readText(file);
      if (content.length > AGENDA_LIMITS.sourceChars) { setError(t('fileTooLarge')); return; }
      setText(content); setSourceName(file.name);
    } catch { setError(t('fileUnreadable')); }
  };
  const parse = async () => {
    if (busy) return;
    setBusy(true); setError(null); setNotices([]);
    try {
      const result = await ipc().agenda.parse({ text, sourceName });
      if (!result.success) { setError(result.error || t('failed')); return; }
      setDraft(result.agenda);
      setNotices([...(result.dropped ? [t('parsedDropped', { count: result.dropped })] : []), ...(result.merged ? [t('parsedMerged', { count: result.merged })] : [])]);
      setMode('edit');
    } catch { setError(t('failed')); } finally { setBusy(false); }
  };
  const updateItem = (id: string, patch: Partial<AgendaItem>) =>
    setDraft((current) => (current ? { ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) } : current));
  const removeItem = (id: string) => setDraft((current) => (current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current));
  const addItem = () => setDraft((current) => (current && current.items.length < AGENDA_LIMITS.items
    ? { ...current, items: [...current.items, { id: nextId(current.items), title: t('itemNewTitle'), outcome: 'discussie', minutes: null, owner: null, required: false }] }
    : current));
  const problem = (agenda: Agenda | null): string | null => {
    if (!agenda || !agenda.items.length || agenda.items.some((item) => !item.title.trim())) return t('emptyTitles');
    if (agenda.items.length > AGENDA_LIMITS.items) return t('maxItems');
    return null;
  };
  const duplicates = draft ? draft.items.length - new Set(draft.items.map((item) => norm(item.title))).size : 0;
  const save = async () => {
    if (busy || !draft) return;
    const blocked = problem(draft);
    if (blocked) { setError(blocked); return; }
    setBusy(true); setError(null);
    try {
      const agenda: Agenda = { ...draft, title: draft.title && draft.title.trim() ? draft.title.trim() : null,
        items: draft.items.map((item) => ({ ...item, title: item.title.trim(), owner: item.owner && item.owner.trim() ? item.owner.trim() : null })) };
      const result = await ipc().agenda.prepare({ agenda });
      if (!result.success) { setError(result.error || t('failed')); return; }
      setPrepared(result.preparation); setDraft(null); setText(''); setSourceName(null); setNotices([]); setMode('view');
    } catch { setError(t('failed')); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await ipc().agenda.clearPreparation();
      if (!result.success) throw new Error('clear');
      setPrepared(null);
    } catch { setError(t('failed')); } finally { setBusy(false); }
  };

  return <section data-testid="agenda-prepare" aria-labelledby={heading} className="veneta-agenda-card mb-6 rounded-lg p-4 text-sm">
    <h2 id={heading} className="mb-2 text-[15px] font-semibold">{t('prepareTitle')}</h2>
    {loading && <p role="status">{t('loading')}</p>}
    {!loading && mode === 'view' && <>
      {prepared
        ? <div data-testid="agenda-prepared">
            <p className="font-medium">{prepared.title ? t('prepareReadyTitle', { title: prepared.title }) : t('prepareUntitled')}</p>
            <p className="text-[color:var(--fg-2)]">{t('prepareReady', { count: prepared.items.length })}</p>
          </div>
        : <p className="text-[color:var(--fg-2)]">{t('prepareNone')}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setMode('input'); setError(null); }}>{t('prepareLoad')}</Button>
        {prepared && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(prepared); setNotices([]); setMode('edit'); }}>{t('prepareEdit')}</Button>}
        {prepared && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void clear()}>{t('prepareClear')}</Button>}
      </div>
    </>}
    {!loading && mode === 'input' && <div className="space-y-2">
      <label htmlFor={pasteId} className="block font-medium">{t('pasteLabel')}</label>
      <textarea id={pasteId} value={text} rows={7} maxLength={AGENDA_LIMITS.sourceChars} placeholder={t('pastePlaceholder')}
        onChange={(event) => { setText(event.target.value); setSourceName(null); }}
        className="veneta-agenda-input block w-full rounded-md p-2 font-mono text-[13px]" />
      <p className="text-[12px] text-[color:var(--fg-2)]">{t('parseHint')}</p>
      <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only" tabIndex={-1}
        aria-label={t('chooseFile')} data-testid="agenda-file" onChange={(event) => void readFile(event.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>{t('chooseFile')}</Button>
        <Button type="button" size="sm" disabled={busy || !text.trim()} onClick={() => void parse()}>{t('parse')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setMode('view'); setError(null); }}>{t('cancel')}</Button>
      </div>
    </div>}
    {!loading && mode === 'edit' && draft && <div className="space-y-3">
      {notices.map((notice) => <p key={notice} role="status">{notice}</p>)}
      <label className="block">
        <span className="mb-1 block font-medium">{t('agendaTitleLabel')}</span>
        <input type="text" value={draft.title ?? ''} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          className="veneta-agenda-input w-full rounded-md px-2 py-1" />
      </label>
      <h3 className="font-medium">{t('itemsHeading')}</h3>
      <ol className="space-y-2" data-testid="agenda-edit-items">
        {draft.items.map((item, index) => <EditRow key={item.id} item={item} number={index + 1} onChange={(patch) => updateItem(item.id, patch)} onRemove={() => removeItem(item.id)} />)}
      </ol>
      {duplicates > 0 && <p role="alert">{t('duplicateItems')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy || draft.items.length >= AGENDA_LIMITS.items} onClick={addItem}>{t('itemAdd')}</Button>
        <Button type="button" size="sm" disabled={busy || duplicates > 0} onClick={() => void save()}>{t('save')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(null); setMode('view'); setError(null); }}>{t('cancel')}</Button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-2">{error}</p>}
  </section>;
}

function EditRow({ item, number, onChange, onRemove }: { item: AgendaItem; number: number; onChange: (patch: Partial<AgendaItem>) => void; onRemove: () => void }) {
  return <li className="veneta-agenda-edit-row grid gap-2 rounded-md p-2" data-testid="agenda-edit-row">
    <input type="text" value={item.title} maxLength={AGENDA_LIMITS.titleChars} aria-label={t('itemTitle', { number })}
      onChange={(event) => onChange({ title: event.target.value })} className="veneta-agenda-input rounded-md px-2 py-1" />
    <div className="flex flex-wrap items-center gap-2">
      <select value={item.outcome} aria-label={t('itemOutcome', { number })} onChange={(event) => onChange({ outcome: event.target.value as AgendaOutcome })}
        className="veneta-agenda-input rounded-md px-2 py-1">
        {AGENDA_OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{t(`outcome_${outcome}`)}</option>)}
      </select>
      <input type="number" min={1} max={AGENDA_LIMITS.minutes} value={item.minutes ?? ''} aria-label={t('itemMinutes', { number })} placeholder={t('minutesPlaceholder')}
        onChange={(event) => onChange({ minutes: minutesOf(event.target.value) })} className="veneta-agenda-input w-20 rounded-md px-2 py-1" />
      <input type="text" value={item.owner ?? ''} maxLength={AGENDA_LIMITS.ownerChars} aria-label={t('itemOwner', { number })} placeholder={t('ownerPlaceholder')}
        onChange={(event) => onChange({ owner: event.target.value || null })} className="veneta-agenda-input w-36 rounded-md px-2 py-1" />
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" checked={item.required} aria-label={t('itemRequiredLabel', { number })} onChange={(event) => onChange({ required: event.target.checked })} />
        <span>{t('itemRequired')}</span>
      </label>
      <Button type="button" variant="ghost" size="sm" aria-label={t('itemRemove', { number })} onClick={onRemove}>{t('itemRemove', { number })}</Button>
    </div>
  </li>;
}
