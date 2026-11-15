import { useEffect, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import type { SummaryDetail } from '@/lib/summaryFoldingContracts';
import { SummaryDetailControl } from '@/modules/summary-folding/SummaryDetailControl';
import { Button } from '@/components/ui/button';
import { summaryFoldingText as t } from './summaryFoldingCopy';
export function SummaryDetailSettings() {
  const [value, setValue] = useState<SummaryDetail>('detailed');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<'settingsLoadError' | 'settingsSaveError' | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    let active = true;
    void (async () => {
      try {
        const result = await ipc().summaryFolding.getSettings();
        if (!active) return;
        if (result.success) {
          setValue(result.summary_detail);
          setReady(true);
        } else setError('settingsLoadError');
      } catch {
        if (active) setError('settingsLoadError');
      }
    })();
    return () => {
      active = false;
      alive.current = false;
    };
  }, [attempt]);
  const save = async (next: SummaryDetail) => {
    if (!ready || busy.current || next === value) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await ipc().summaryFolding.setSettings(next);
      if (!alive.current) return;
      if (result.success) setValue(result.summary_detail);
      else setError('settingsSaveError');
    } catch {
      if (alive.current) setError('settingsSaveError');
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return (
    <div
      className="space-y-3 py-4"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
      data-testid="summary-detail-settings"
    >
      <p className="text-[14px]" style={{ color: 'var(--fg-1)' }}>
        {t('settingsTitle')}
      </p>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--fg-2)' }}>
        {t('settingsExplanation')}
      </p>
      <SummaryDetailControl
        value={value}
        onChange={(next) => void save(next)}
        disabled={!ready || saving}
      />
      {!ready && !error && (
        <p role="status" className="text-sm">
          {t('settingsLoading')}
        </p>
      )}
      {saving && (
        <p role="status" className="text-sm">
          {t('settingsSaving')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--fg-2)' }}>
          {t(error)}
        </p>
      )}
      {error === 'settingsLoadError' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setAttempt((current) => current + 1);
          }}
        >
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
