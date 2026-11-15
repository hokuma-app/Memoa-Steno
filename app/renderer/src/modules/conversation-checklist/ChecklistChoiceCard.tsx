import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Lock, Check } from 'lucide-react';
import { useModuleEnabled } from '@/hooks/useProductSettings';
import { ipc } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import type { ChecklistCriterion, ChecklistPrepared, ChecklistStandard, ChecklistTemplate } from './contracts';
import { runtimeText as t } from './runtimeCopy';

const NONE = '__none__';
const normalize = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
type Option = { id: string; name: string; meta: string; locked: boolean; disabled: boolean };

/** One card on Home: which checklist stands ready for the next recording. */
export function ChecklistChoiceCard() {
  const enabled = useModuleEnabled('conversation-checklist');
  return enabled ? <Card /> : null;
}

function Card() {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [standards, setStandards] = useState<ChecklistStandard[]>([]);
  const [prepared, setPrepared] = useState<ChecklistPrepared | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [editor, setEditor] = useState<{ id?: string; name: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useId();
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void ipc().checklists.listTemplates().then((result) => {
      if (!alive) return;
      if (result.success) { setTemplates(result.templates); setStandards(result.standards); setPrepared(result.preparation); }
      else setFailed(true);
    }).catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const options: Option[] = [
    ...standards.map((item): Option => ({ id: item.id, name: item.name, locked: true, disabled: !item.available,
      meta: item.available ? t('choiceStandardMeta', { count: item.criteriaCount }) : t('choicePending') })),
    ...templates.map((item): Option => ({ id: item.id, name: item.name, locked: false, disabled: false, meta: t('choiceOwnMeta', { count: item.criteria.length }) })),
    { id: NONE, name: t('choiceNone'), meta: '', locked: false, disabled: false },
  ];
  const selectedId = prepared?.templateId ?? NONE;
  const selected = options.find((item) => item.id === selectedId) ?? options[options.length - 1];
  const ownSelected = templates.find((item) => item.id === selectedId) ?? null;

  const choose = async (option: Option) => {
    setOpen(false);
    if (option.disabled || busy || option.id === selectedId) return;
    setBusy(true); setError(null);
    try {
      if (option.id === NONE) {
        const result = await ipc().checklists.clearPreparation();
        if (!result.success) throw new Error('clear');
        setPrepared(null);
      } else {
        const result = await ipc().checklists.prepare({ templateId: option.id });
        if (!result.success) throw new Error('prepare');
        const standard = standards.find((item) => item.id === option.id);
        const own = templates.find((item) => item.id === option.id);
        setPrepared({ templateId: option.id, name: option.name, locked: Boolean(standard), criteria: own?.criteria ?? [] });
      }
    } catch { setError(t('failed')); } finally { setBusy(false); button.current?.focus(); }
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (!open) { setActive(Math.max(0, options.findIndex((item) => item.id === selectedId))); setOpen(true); return; }
      setActive((index) => Math.min(options.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault(); void choose(options[active]);
    }
  };

  // ---- editor ----
  const typed = editor ? editor.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  // The same point twice (case and spacing ignored) is one point: merged, and said so, never silently.
  const lines = typed.filter((line, index) => typed.findIndex((other) => normalize(other) === normalize(line)) === index);
  const duplicates = typed.length - lines.length;
  const nameTaken = editor ? [...standards.map((item) => item.name), ...templates.filter((item) => item.id !== editor.id).map((item) => item.name)]
    .some((name) => normalize(name) === normalize(editor.name)) : false;
  const editorValid = !!editor && !!editor.name.trim() && editor.name.length <= 120 && !nameTaken && lines.length > 0 && lines.length <= 32 && lines.join('').length <= 24000;
  const startEdit = () => {
    if (!ownSelected) return;
    setEditor({ id: ownSelected.id, name: ownSelected.name, text: ownSelected.criteria.map((item) => item.label).join('\n') });
    setError(null);
  };
  const save = async () => {
    if (!editor || !editorValid || busy) return;
    setBusy(true); setError(null);
    const remaining = [...(templates.find((item) => item.id === editor.id)?.criteria ?? [])];
    const criteria: ChecklistCriterion[] = lines.map((label) => {
      const index = remaining.findIndex((item) => item.label === label);
      return index < 0 ? { id: crypto.randomUUID(), label, required: true } : remaining.splice(index, 1)[0];
    });
    try {
      const saved = await ipc().checklists.saveNamedTemplate({ ...(editor.id ? { id: editor.id } : {}), name: editor.name.trim(), criteria });
      if (!saved.success) {
        setError('code' in saved && saved.code === 'name_taken' ? t('choiceNameTaken') : t('failed'));
        return;
      }
      const template = saved.template;
      const prepare = await ipc().checklists.prepare({ templateId: template.id });
      setTemplates((current) => [...current.filter((item) => item.id !== template.id), template]);
      if (!prepare.success) throw new Error('prepare');
      setPrepared({ templateId: template.id, name: template.name, locked: false, criteria: template.criteria });
      setEditor(null);
    } catch { setError(t('failed')); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!ownSelected || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await ipc().checklists.deleteNamedTemplate({ id: ownSelected.id });
      if (!result.success) throw new Error('delete');
      setTemplates((current) => current.filter((item) => item.id !== ownSelected.id));
      setPrepared(null); setConfirmDelete(false);
    } catch { setError(t('failed')); } finally { setBusy(false); }
  };

  return <section data-testid="checklist-choice" aria-labelledby={heading} className="veneta-checklist-card mb-6 rounded-xl border border-border bg-[color:var(--surface-raised)] p-4 text-sm">
    <h2 id={heading} className="mb-2 text-[13px] font-medium text-[color:var(--fg-2)]">{t('choiceTitle')}</h2>
    {failed ? <p role="alert">{t('failed')}</p> : <>
      <div className="relative">
        <button ref={button} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
          aria-labelledby={heading} disabled={loading || busy} onKeyDown={onKey}
          onClick={() => { setActive(Math.max(0, options.findIndex((item) => item.id === selectedId))); setOpen((value) => !value); }}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left">
          {selected.locked && <Lock size={15} aria-hidden="true" className="shrink-0 text-[color:var(--fg-2)]" />}
          <span className="min-w-0 flex-1"><span className="block font-semibold">{selected.name}</span>
            {selected.meta && <span className="block text-[12px] text-[color:var(--fg-2)]">{selected.meta}</span>}</span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0" />
        </button>
        {open && <ul id={listId} role="listbox" aria-label={t('choiceOptions')} className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          {options.map((option, index) => <li key={option.id} role="option" aria-selected={option.id === selectedId} aria-disabled={option.disabled || undefined}
            onClick={() => void choose(option)} onMouseEnter={() => setActive(index)}
            className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${index === active ? 'bg-[color:var(--surface-hover)]' : ''} ${option.disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
            {option.locked && <Lock size={14} aria-hidden="true" className="shrink-0 text-[color:var(--fg-2)]" />}
            <span className="min-w-0 flex-1"><span className="block font-medium">{option.name}</span>
              {option.meta && <span className="block text-[12px] text-[color:var(--fg-2)]">{option.meta}</span>}</span>
            {option.id === selectedId && <Check size={14} aria-hidden="true" />}
          </li>)}
        </ul>}
      </div>
      <p className="mt-2 flex items-center gap-2 text-[12.5px]" role="status">
        {prepared ? <><Check size={14} aria-hidden="true" className="text-[color:var(--success,#2f7d4f)]" /><span>{t('choiceReady')}</span></>
          : <span className="text-[color:var(--fg-2)]">{t('choiceNoneHint')}</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="border-0 bg-transparent p-0 text-[12.5px] font-medium underline" onClick={() => { setEditor({ name: '', text: '' }); setError(null); }}>{t('choiceCreate')}</button>
        {ownSelected && !editor && <>
          <button type="button" className="border-0 bg-transparent p-0 text-[12.5px] underline" onClick={startEdit}>{t('choiceEdit')}</button>
          <button type="button" className="border-0 bg-transparent p-0 text-[12.5px] underline" onClick={() => setConfirmDelete(true)}>{t('choiceDelete')}</button>
        </>}
        {prepared?.locked && <span className="flex items-center gap-1 text-[12px] text-[color:var(--fg-2)]"><Lock size={12} aria-hidden="true" />{t('choiceLocked')}</span>}
      </div>
      {confirmDelete && <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]"><span>{t('choiceConfirmDelete')}</span>
        <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>{t('choiceConfirmYes')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>{t('choiceCancel')}</Button></div>}
      {editor && <div className="mt-3 space-y-2 border-t border-border pt-3">
        <label className="block text-[12.5px]">{t('choiceName')}
          <input className="mt-1 w-full rounded border border-border bg-transparent p-2" value={editor.name} maxLength={200} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
        <label className="block text-[12.5px]">{t('choicePoints')}
          <textarea className="mt-1 min-h-24 w-full rounded border border-border bg-transparent p-2" value={editor.text} onChange={(event) => setEditor({ ...editor, text: event.target.value })} /></label>
        {nameTaken && <p role="note" className="text-[12.5px]">{t('choiceNameTaken')}</p>}
        {duplicates > 0 && <p role="note" data-testid="checklist-duplicates" className="text-[12.5px]">{t(duplicates === 1 ? 'choiceDuplicates' : 'choiceDuplicatesMany', { count: duplicates })}</p>}
        <p className="text-[12px] text-[color:var(--fg-2)]">{t('choiceLimits')}</p>
        <div className="flex gap-2"><Button type="button" disabled={!editorValid || busy} onClick={() => void save()}>{t('choiceSave')}</Button>
          <Button type="button" variant="outline" onClick={() => { setEditor(null); setError(null); }}>{t('choiceCancel')}</Button></div>
      </div>}
      {error && <p role="alert" className="mt-2 text-[12.5px]">{error}</p>}
    </>}
  </section>;
}
