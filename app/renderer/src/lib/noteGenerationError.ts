import { ResultError } from './result';
import { t } from '@/i18n';

// Fixed English copy, ready to move into the locale catalogue. Never render
// backend error.message, event.message, or an unknown code as user-facing text.
const messages = {
  generation_connection_failed: t('noteGenerationError.couldNotReachTheAi'),
  generation_model_unavailable: t('noteGenerationError.theSelectedAiModelIs'),
  generation_auth_failed: t('noteGenerationError.theAiServiceDeniedAccess'),
  generation_timeout: t('noteGenerationError.theAiServiceTookToo'),
  generation_out_of_memory: t('noteGenerationError.thereWasNotEnoughMemory'),
  generation_not_configured: t('noteGenerationError.theAiServiceIsNot'),
  processing_stopped: t('noteGenerationError.processingWasStoppedTheRecording'),
  generation_failed: t('noteGenerationError.notesCouldNotBeGenerated'),
} as const;

export type NoteGenerationErrorCode = keyof typeof messages;

export function noteGenerationErrorCode(value: unknown): NoteGenerationErrorCode {
  return typeof value === 'string' && Object.hasOwn(messages, value)
    ? value as NoteGenerationErrorCode
    : 'generation_failed';
}

export function noteGenerationErrorFromResult(error: unknown): NoteGenerationErrorCode {
  return noteGenerationErrorCode(error instanceof ResultError ? error.code : undefined);
}

export function noteGenerationErrorMessage(code: NoteGenerationErrorCode): string {
  return messages[code];
}

// The stream event, terminal event and rejected IPC result can all report the
// same failure. A generic terminal signal must not erase a known stream cause.
export function keepNoteGenerationCause(previous: NoteGenerationErrorCode | null, value: unknown): NoteGenerationErrorCode {
  const next = noteGenerationErrorCode(value);
  return next === 'generation_failed' ? previous ?? next : next;
}
