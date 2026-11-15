import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { meetingsKeys } from '@/hooks/meetingKeys';
import { ipc } from '@/lib/ipc';
import { navigate } from '@/lib/router';
import { t } from '@/i18n';

export const MEETING_TRANSFER_COPY = {
  importAction: t('useMeetingTransfer.importStenoPackage'),
  importDescription: t('useMeetingTransfer.openAStenoNotePackage'),
  importBlocked: t('useMeetingTransfer.waitUntilRecordingAndProcessing'),
  exportAction: t('useMeetingTransfer.shareStenoPackage'),
  drop: t('useMeetingTransfer.dropAudioOrASteno'),
  failed: t('useMeetingTransfer.stenoPackageTransferFailed'),
} as const;

function showFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  window.alert(`${MEETING_TRANSFER_COPY.failed}: ${detail}`);
}

async function ensureSuccess<T extends { success: boolean; error?: string }>(
  operation: Promise<T>
): Promise<T> {
  try {
    const result = await operation;
    if (!result.success) throw new Error(result.error || MEETING_TRANSFER_COPY.failed);
    return result;
  } catch (error) {
    showFailure(error);
    throw error;
  }
}

export function importMeetingPackage(filePath?: string) {
  return ensureSuccess(ipc().meetingTransfer.importPackage(filePath));
}

export function useImportMeetingPackage() {
  return useMutation({ mutationFn: (filePath?: string) => importMeetingPackage(filePath) });
}

export function useExportMeetingPackage() {
  return useMutation({
    mutationFn: (summaryFile: string) =>
      ensureSuccess(ipc().meetingTransfer.exportPackage(summaryFile)),
  });
}

export function useMeetingTransferEvents() {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.stenoai) return;

    const off = ipc().on.meetingTransferImported(({ summaryFile }) => {
      void queryClient.invalidateQueries({ queryKey: meetingsKeys.all }).then(() => {
        navigate(`/meetings/${encodeURIComponent(summaryFile)}`);
      });
    });

    void ensureSuccess(ipc().meetingTransfer.ready()).catch(() => {
      // ensureSuccess already surfaced the failure.
    });
    return off;
  }, [queryClient]);
}
