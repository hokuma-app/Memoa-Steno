import type { AgendaSpeaker } from './contracts';
import { agendaText as t } from './locales/nl';

/** 75 → "01:15", 3700 → "1:01:40". */
export function stamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(whole / 3600);
  const rest = `${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${rest}` : rest;
}
export const speakerText = (speaker: AgendaSpeaker) => t(speaker === 'self' ? 'speaker_self' : speaker === 'other' ? 'speaker_other' : 'speaker_unknown');
const REASONS = ['server_unreachable', 'server_start_failed', 'model_missing', 'model_not_local', 'timeout', 'invalid_answer', 'empty_answer', 'not_json',
  'wrong_shape', 'truncated', 'provider_not_local', 'invalid_request', 'config_invalid', 'module_disabled', 'busy', 'failed'] as const;
type Reason = (typeof REASONS)[number];
/** Concrete Dutch advice for a content-free failure reason. */
export function reasonAdvice(reason: string): string {
  const known = (REASONS as readonly string[]).includes(reason) ? (reason as Reason) : 'failed';
  return t(`reason_${known}`);
}
