import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { productText as t } from '@/i18n/product';
import { Switch } from '@/components/ui/switch';
import { useProductSettings } from '@/hooks/useProductSettings';
import { isProductModuleEnabled } from '@/lib/productProfiles';
import { COMPACT_TRIGGER, SectionHeading, SettingRow } from './primitives';
import { agendaText } from '@/modules/agenda-chair/locales/nl';

export interface ProductTabProps {
  busy?: boolean;
}
export function ProductTab({ busy = false }: ProductTabProps) {
  const { settings, hydrated, error, setProfile, setModuleEnabled } = useProductSettings();
  const [saving, setSaving] = useState(false);
  const enabled = isProductModuleEnabled(settings, hydrated, 'conversation-checklist');
  const agendaEnabled = isProductModuleEnabled(settings, hydrated, 'agenda-chair');
  const agendaLabel = agendaText('moduleName');
  const agendaDescription = agendaText('moduleDescription');
  const save = async (operation: () => Promise<void>) => {
    setSaving(true);
    try {
      await operation();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section data-settings-tab="product" aria-label={t('product.title')}>
      <SectionHeading first>{t('product.title')}</SectionHeading>
      <SettingRow label={t('product.profile')} description={t('product.description')}>
        <select
          aria-label={t('product.profile')}
          className={COMPACT_TRIGGER}
          style={{ color: 'var(--fg-1)', border: '1px solid var(--border-subtle)' }}
          value={settings.profile}
          disabled={busy || !hydrated || saving}
          onChange={(event) => {
            const id = event.target.value;
            if (id === 'default' || id === 'veneta') void save(() => setProfile(id));
          }}
        >
          <option value="default">{t('product.default')}</option>
          <option value="veneta">{t('product.veneta')}</option>
        </select>
      </SettingRow>
      <p className="text-[13px] leading-relaxed text-[color:var(--fg-2)]">
        {t('product.separation')}
      </p>
      <SectionHeading>{t('product.modules')}</SectionHeading>
      <SettingRow
        label={t('product.checklist')}
        description={t('product.checklistDescription')}
        noBorder
      >
        <Switch
          aria-label={t('product.checklist')}
          aria-describedby="product-module-permission"
          checked={enabled}
          disabled={!hydrated || settings.profile !== 'veneta' || saving || (busy && !enabled)}
          onCheckedChange={(next) =>
            void save(() => setModuleEnabled('conversation-checklist', next))
          }
        />
      </SettingRow>
      {enabled && settings.profile === 'veneta' && <SellerChannel />}
      <SettingRow label={agendaLabel} description={agendaDescription} noBorder>
        <Switch
          aria-label={agendaLabel}
          aria-describedby="product-module-permission"
          checked={agendaEnabled}
          disabled={!hydrated || settings.profile !== 'veneta' || saving || (busy && !agendaEnabled)}
          onCheckedChange={(next) => void save(() => setModuleEnabled('agenda-chair', next))}
        />
      </SettingRow>
      <p
        id="product-module-permission"
        className="text-[13px] leading-relaxed text-[color:var(--fg-2)]"
      >
        {t('product.permission')}
      </p>
      <p className="mt-3 text-[13px] text-[color:var(--fg-2)]">{t('product.retention')}</p>
      {busy && (
        <p role="status" className="mt-3 text-[13px] text-[color:var(--fg-2)]">
          {t('product.busy')}
        </p>
      )}
      {!hydrated && !error && <p role="status">{t('product.loading')}</p>}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[color:var(--fg-1)]">
          {t('product.error')}
        </p>
      )}
    </section>
  );
}

/** Which channel is the seller: the microphone by default; reversible once, here, never during a conversation. */
function SellerChannel() {
  const [micIsSeller, setMicIsSeller] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => ipc().checklists.getSettings()).then((result) => {
      if (!alive) return;
      if (result.success) setMicIsSeller(result.settings.micIsSeller); else setFailed(true);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  const change = async (next: boolean) => {
    setFailed(false);
    try {
      const result = await ipc().checklists.setSettings({ micIsSeller: next });
      if (!result.success) throw new Error('save');
      setMicIsSeller(result.settings.micIsSeller);
    } catch { setFailed(true); }
  };
  return (
    <>
      <SettingRow label={t('product.sellerMic')} description={t('product.sellerMicDescription')} noBorder>
        <Switch aria-label={t('product.sellerMic')} checked={micIsSeller === true} disabled={micIsSeller === null}
          onCheckedChange={(next) => void change(next)} />
      </SettingRow>
      {failed && <p role="alert" className="mt-2 text-[13px] text-[color:var(--fg-1)]">{t('product.sellerMicError')}</p>}
    </>
  );
}
