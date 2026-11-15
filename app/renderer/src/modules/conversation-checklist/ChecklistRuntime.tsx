import { useModuleEnabled } from '@/hooks/useProductSettings';
import { ChecklistSidebar } from './ChecklistSidebar';
import { jumpToTranscriptSegment } from './transcriptJump';
import { useLiveChecklist } from './useLiveChecklist';
import { runtimeText as t } from './runtimeCopy';

/**
 * Shows the live checklist of the active recording. The host plans and runs the automatic checks (stable text or
 * thirty seconds, one at a time, local model only); this component only displays the state the host reports, so it
 * can unmount and mount as often as the layout needs without resetting anything.
 */
export function ChecklistRuntime() {
  const enabled = useModuleEnabled('conversation-checklist');
  const { known, failed, live } = useLiveChecklist(enabled);
  if (!enabled) return null;
  if (failed) return <p role="alert">{t('failed')}</p>;
  if (!known) return <p role="status">{t('loading')}</p>;
  if (!live.active) return null;
  return <ChecklistSidebar live={live} fallbackName={t('tabChecklist')} onJump={jumpToTranscriptSegment} />;
}
