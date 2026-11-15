import { t } from '@/i18n';
import type { ParakeetPullProgressEvent, SpeakerModelsProgressEvent } from './ipc';

/** Measured byte totals, when the backend could read the Hub's file sizes. */
function byteTotals(progress?: ParakeetPullProgressEvent | null) {
  if (progress?.stage !== 'downloading') return null;
  const { downloaded_bytes: done, total_bytes: total } = progress;
  if (!Number.isFinite(done) || !Number.isFinite(total) || total! <= 0 || done! < 0) return null;
  return { done: Math.min(done!, total!), total: total! };
}

function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

/** Whole-download percent, or null when only file-level progress is known
 *  (older Hub releases, or the size lookup failed) - never an estimate. */
export function parakeetProgressPercent(progress?: ParakeetPullProgressEvent | null): number | null {
  const totals = byteTotals(progress);
  return totals ? (totals.done / totals.total) * 100 : null;
}

export function parakeetProgressLabel(progress?: ParakeetPullProgressEvent | null): string {
  if (progress?.stage === 'loading') return t('parakeetProgress.downloadCompletePreparingModel');
  if (progress?.stage === 'complete') return t('parakeetProgress.modelReady');
  if (progress?.stage !== 'downloading') return t('parakeetProgress.preparingDownload');
  const totals = byteTotals(progress);
  if (totals) {
    return t('downloads.parakeet.bytes', {
      downloaded: formatBytes(totals.done),
      total: formatBytes(totals.total),
    });
  }
  const files = Number.isInteger(progress.completed_files) && Number.isInteger(progress.total_files)
    && progress.completed_files! >= 0 && progress.total_files! > 0
    && progress.completed_files! <= progress.total_files!
    ? t('parakeetProgress.ofFilesReady', { completed_files: progress.completed_files, total_files: progress.total_files }) : '';
  const bytes = Number.isFinite(progress.file_bytes) && progress.file_bytes! > 0
    ? t('parakeetProgress.currentFileMbAvailable', { value: (progress.file_bytes! / 1_000_000).toFixed(1) }) : '';
  return t('parakeetProgress.downloadingModel', { files, bytes });
}

/** The percent measures the download only. Compiling the models for this
 *  Mac (often over a minute) has nothing to measure, so it reports null and
 *  the bar shows activity instead of a made-up number. */
export function speakerModelsProgressPercent(progress: SpeakerModelsProgressEvent): number | null {
  return progress.phase === 'compiling' ? null : progress.percent;
}

export function speakerModelsProgressLabel(progress: SpeakerModelsProgressEvent): string {
  return progress.phase === 'compiling'
    ? t('downloads.speakers.preparing')
    : t('downloads.speakers.downloading');
}
