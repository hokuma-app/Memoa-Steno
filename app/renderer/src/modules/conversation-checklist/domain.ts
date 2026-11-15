import type {
  ChecklistAssessment,
  ChecklistEvaluationRequest,
  ChecklistEvaluationResponse,
  ChecklistFailureReason,
  ChecklistLevel,
  ChecklistStatus,
} from './contracts';
import { checklistText as t } from './locales/nl';

export const checklistStatuses: ChecklistStatus[] = [
  'unmentioned',
  'partial',
  'covered',
  'uncertain',
];

/** A failed check carries only a content-free reason, never model or source text. */
export class ChecklistCheckFailure extends Error {
  readonly reason: ChecklistFailureReason;
  constructor(reason: ChecklistFailureReason = 'failed') {
    super('checklist check failed');
    this.reason = reason;
  }
}

const KINDS = ['none', 'mentioned', 'explained'] as const;
const WORD = '[\\p{L}\\p{N}_]';
/** A citation is at least three characters and starts and ends on word boundaries inside its segment. */
export function isWholeWordQuote(text: string, quote: string): boolean {
  if (typeof quote !== 'string' || quote.trim().length < 3) return false;
  const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^${WORD}`, 'u').test(quote) ? `(?<!${WORD})` : '';
  const tail = new RegExp(`${WORD}$`, 'u').test(quote) ? `(?!${WORD})` : '';
  return new RegExp(head + escaped + tail, 'u').test(text);
}
const quoteOf = (request: ChecklistEvaluationRequest, e: unknown) => {
  const item = e as { segmentId?: unknown; quote?: unknown } | null;
  if (!item || typeof item.quote !== 'string' || !item.quote.trim() || typeof item.segmentId !== 'string')
    return null;
  const segments = request.segments.filter((s) => s.id === item.segmentId);
  const s = segments[0];
  return segments.length === 1 &&
    isWholeWordQuote(s.text, item.quote) &&
    Number.isFinite(s.start) &&
    Number.isFinite(s.end) &&
    s.start >= 0 &&
    s.end >= s.start
    ? s
    : null;
};

/** Provenance validation only: exact citations do not prove semantic relevance. */
export function groundEvaluation(
  request: ChecklistEvaluationRequest,
  response: ChecklistEvaluationResponse
): ChecklistEvaluationResponse | null {
  if (!response || response.revision !== request.revision || !Array.isArray(response.assessments))
    return null;
  const assessments = request.criteria.map((criterion): ChecklistAssessment => {
    const candidates = response.assessments.filter((a) => a && a.criterionId === criterion.id);
    const a = candidates[0];
    const uncertain = (explanation: string): ChecklistAssessment => ({
      criterionId: criterion.id,
      status: 'uncertain',
      evidence: [],
      explanation,
      kind: 'none',
      customerConfirmed: false,
      customerEvidence: [],
    });
    if (
      candidates.length !== 1 ||
      !a ||
      !checklistStatuses.includes(a.status) ||
      typeof a.explanation !== 'string' ||
      !Array.isArray(a.evidence)
    )
      return uncertain(t('missing'));
    const evidence = a.evidence.filter((e) => quoteOf(request, e));
    const sellerOnly =
      request.mappingConfirmed &&
      evidence.length > 0 &&
      evidence.every((e) => quoteOf(request, e)?.speaker === 'seller');
    if (
      response.error ||
      evidence.length !== a.evidence.length ||
      (a.status === 'partial' && evidence.length === 0) ||
      (a.status === 'covered' && !sellerOnly)
    )
      return uncertain(t('invalidEvidence'));
    // Levels: absent fields (older backend) get conservative defaults; invalid ones fail closed.
    const hasLevels = a.kind !== undefined || a.customerConfirmed !== undefined || a.customerEvidence !== undefined;
    const kind = hasLevels ? a.kind : a.status === 'covered' ? 'explained' : evidence.length ? 'mentioned' : 'none';
    const customerEvidence = hasLevels ? (a.customerEvidence ?? []) : [];
    const customerConfirmed = hasLevels ? a.customerConfirmed === true : false;
    const customerQuotes = Array.isArray(customerEvidence) ? customerEvidence.filter((e) => quoteOf(request, e)?.speaker === 'other') : [];
    if (
      !KINDS.some((k) => k === kind) ||
      (hasLevels && a.customerConfirmed !== undefined && typeof a.customerConfirmed !== 'boolean') ||
      !Array.isArray(customerEvidence) ||
      customerQuotes.length !== customerEvidence.length ||
      customerConfirmed !== customerQuotes.length > 0 ||
      // "Explained" is exactly the covered status; customer words never raise it.
      (kind === 'explained') !== (a.status === 'covered') ||
      (kind === 'none' && evidence.length > 0)
    )
      return uncertain(t('invalidEvidence'));
    return {
      criterionId: criterion.id,
      status: a.status,
      evidence: evidence.map((e) => ({ ...e })),
      explanation: a.explanation,
      kind,
      customerConfirmed,
      customerEvidence: customerQuotes.map((e) => ({ ...e })),
    };
  });
  return {
    revision: response.revision,
    assessments,
    ...(typeof response.error === 'string' ? { error: response.error } : {}),
  };
}

/** What was actually said about a point; derived from the AI judgment, never from a manual choice. */
export function levelOf(assessment: ChecklistAssessment | undefined): ChecklistLevel {
  if (!assessment) return 'notHeard';
  if (assessment.status === 'covered') return assessment.customerConfirmed ? 'explainedConfirmed' : 'explained';
  if (assessment.status === 'partial') return 'mentioned';
  // The model named the point with a grounded quote but was unsure it was explained: show what was said.
  if (assessment.status === 'uncertain' && assessment.kind === 'mentioned' && assessment.evidence.length > 0)
    return 'mentioned';
  return 'notHeard';
}

export type LiveState =
  | { kind: 'noText' }
  | { kind: 'waiting' }
  | { kind: 'busy' }
  | { kind: 'tooLarge' }
  | { kind: 'listening'; lastRun: Date }
  | { kind: 'error'; reason: ChecklistFailureReason; at: Date };

/** One honest answer to "is the check running, and if not, why?" for the always-on status line. */
export function liveState(input: {
  busy: boolean;
  failure: { reason: ChecklistFailureReason; at: Date } | null;
  segmentCount: number;
  withinLimits: boolean;
  lastRun: Date | null;
}): LiveState {
  if (input.busy) return { kind: 'busy' };
  if (input.failure) return { kind: 'error', ...input.failure };
  if (!input.withinLimits) return { kind: 'tooLarge' };
  if (input.lastRun) return { kind: 'listening', lastRun: input.lastRun };
  return input.segmentCount === 0 ? { kind: 'noText' } : { kind: 'waiting' };
}
