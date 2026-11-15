import { useState } from 'react';
import { useModuleEnabled } from '@/hooks/useProductSettings';
import { ipc } from '@/lib/ipc';
import { AgendaSidebar } from './AgendaSidebar';
import type { AgendaAction } from './contracts';
import { useLiveAgenda } from './useLiveAgenda';
import { agendaText as t } from './locales/nl';

/**
 * The agenda of the active recording. The host plans the checks and keeps the meeting state; this component only shows
 * it and forwards human actions, so it can unmount and mount as often as the layout needs without resetting anything.
 */
export function AgendaRuntime() {
  const enabled = useModuleEnabled('agenda-chair');
  const { known, failed, live, receivedAt, apply } = useLiveAgenda(enabled);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return null;
  if (failed) return <p role="alert">{t('failed')}</p>;
  if (!known) return <p role="status">{t('loading')}</p>;
  if (!live.active) return null;
  const act = async (action: AgendaAction, itemId?: string) => {
    setError(null);
    try {
      const answer = await ipc().agenda.liveAction({ action, ...(itemId ? { itemId } : {}) });
      if (answer.success) apply(answer.live);
      else setError(answer.error || t('actionFailed'));
    } catch { setError(t('actionFailed')); }
  };
  return <AgendaSidebar live={live} receivedAt={receivedAt} error={error} onAction={(action, itemId) => void act(action, itemId)} />;
}
