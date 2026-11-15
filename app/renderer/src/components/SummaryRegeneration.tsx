import { useEffect, useRef, useState } from 'react';
import type { SummaryDetail } from '@/lib/summaryFoldingContracts';
import { ipc } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { regenerationText as t } from './regenerationCopy';
export type RegenerationProps = { templates: { id: string; name: string }[]; disabled?: boolean; onGenerate: (detail: SummaryDetail, templateId: string) => void };
const DETAIL_OPTIONS = ['brief', 'balanced', 'detailed'] as const;
export function SummaryRegeneration(props: RegenerationProps) {
  const [open, setOpen] = useState(false);
  return <div className="relative z-50 my-4" data-testid="summary-regeneration">
    <Button type="button" variant="outline" disabled={props.disabled} onClick={() => setOpen(value => !value)}>{t('open')}</Button>
    {open && <RunOptions {...props} close={() => setOpen(false)} />}
  </div>;
}
function RunOptions({ templates, disabled, onGenerate, close }: RegenerationProps & { close: () => void }) {
  const [detail, setDetail] = useState<SummaryDetail>('detailed');
  const [template, setTemplate] = useState('standard');
  const [error, setError] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    let alive = true;
    void ipc().summaryFolding.getSettings().then(result => {
      if (!alive) return;
      if (result.success) { if (!edited.current) setDetail(result.summary_detail); }
      else setError(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-4 text-sm">
    <p>{t('help')}</p>
    {error && <p role="alert">{t('loadError')}</p>}
    <label className="block">{t('length')}<select className="ml-2 rounded border bg-background p-2" value={detail} onChange={event => { edited.current = true; setDetail(event.target.value as SummaryDetail); }}>
      {DETAIL_OPTIONS.map(value => <option key={value} value={value}>{t(value)}</option>)}
    </select></label>
    <label className="block">{t('template')}<select className="ml-2 rounded border bg-background p-2" value={template} onChange={event => setTemplate(event.target.value)}>
      {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <div className="flex gap-2"><Button type="button" disabled={disabled || !templates.some(item => item.id === template)} onClick={() => { onGenerate(detail, template); close(); }}>{t('generate')}</Button>
    <Button type="button" variant="outline" onClick={close}>{t('cancel')}</Button></div>
  </div>;
}
