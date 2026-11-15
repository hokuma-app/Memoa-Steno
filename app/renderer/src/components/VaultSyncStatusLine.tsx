import * as React from 'react';
import { ipc, type VaultSyncStatus } from '@/lib/ipc';
import { t } from '@/i18n';

// One quiet line under the note: is this meeting in the Obsidian vault yet?
// Renders nothing when the custom vault sync is not installed.
export function VaultSyncStatusLine({ summaryFile }: { summaryFile: string }) {
  const [sync, setSync] = React.useState<VaultSyncStatus | null>(null);
  React.useEffect(() => {
    let stale = false;
    const load = () =>
      void ipc().meetings.vaultSyncStatus(summaryFile).then((res) => {
        if (!stale && res.success) setSync(res.sync);
      });
    load();
    // The sync runs ~30 s after a note changes; refresh while the note is open.
    const timer = setInterval(load, 20_000);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [summaryFile]);

  if (!sync) return null;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const text =
    sync.status === 'synced'
      ? t('vaultSyncStatusLine.inVaultSynced', { time: time(sync.syncedAt) })
      : sync.status === 'pending'
        ? t('vaultSyncStatusLine.vaultWaitingForTheNext')
        : sync.status === 'waiting'
          ? t('vaultSyncStatusLine.vaultNotExportedYet', { reason: sync.reason })
          : t('vaultSyncStatusLine.vaultSyncFailed', { message: sync.message });
  return (
    <p
      className="text-[12px]"
      data-testid="vault-sync-status"
      title={sync.status === 'synced' && sync.notePath ? sync.notePath : undefined}
      style={{ color: sync.status === 'error' ? 'var(--danger)' : 'var(--fg-muted)' }}
    >
      {text}
    </p>
  );
}
