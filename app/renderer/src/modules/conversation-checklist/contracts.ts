export interface ChecklistTemplate {
  id: string;
  name: string;
  criteria: ChecklistCriterion[];
}
/** A fixed Veneta checklist shipped with the app; never editable, deletable or overwritable. */
export interface ChecklistStandard {
  id: string;
  name: string;
  version: number;
  locked: true;
  criteriaCount: number;
  /** False while the shipped definition has no points yet: listed, but not selectable. */
  available: boolean;
}
/** The checklist that is ready for the next recording. */
export interface ChecklistPrepared {
  templateId: string;
  name: string;
  locked: boolean;
  criteria: ChecklistCriterion[];
}
export interface ChecklistDraft {
  criteria: ChecklistCriterion[];
  manualOverrides: Record<string, ChecklistManualOverride>;
  templateId?: string;
  templateName?: string;
}
export interface ChecklistCriterion {
  id: string;
  label: string;
  required: boolean;
}
export interface ChecklistSegment {
  id: string;
  text: string;
  speaker: 'seller' | 'other' | 'unknown';
  start: number;
  end: number;
}
export type ChecklistStatus = 'unmentioned' | 'partial' | 'covered' | 'uncertain';
export interface ChecklistEvaluationRequest {
  sessionId: string;
  revision: string;
  mappingConfirmed: boolean;
  criteria: ChecklistCriterion[];
  segments: ChecklistSegment[];
}
/** Humans may also mark a point "Niet van toepassing" (with a reason); the AI never may. */
export type ChecklistHumanStatus = ChecklistStatus | 'notApplicable';
/** What was said: nobody named it, anyone named it, or the (confirmed) seller explained it. */
export type ChecklistKind = 'none' | 'mentioned' | 'explained';
export interface ChecklistQuote {
  segmentId: string;
  quote: string;
}
export interface ChecklistAssessment {
  criterionId: string;
  status: ChecklistStatus;
  evidence: ChecklistQuote[];
  explanation: string;
  /** genoemd / uitgelegd; separate from customer agreement. Absent in older results. */
  kind?: ChecklistKind;
  /** The customer explicitly agreed; never raises a point to explained. */
  customerConfirmed?: boolean;
  customerEvidence?: ChecklistQuote[];
}
/** Content-free reasons a check can fail; the interface maps each to concrete advice. */
export type ChecklistFailureReason =
  | 'server_unreachable' | 'server_start_failed' | 'model_missing' | 'model_not_local' | 'timeout'
  | 'invalid_answer' | 'empty_answer' | 'not_json' | 'wrong_shape' | 'truncated' | 'provider_not_local' | 'invalid_request' | 'config_invalid' | 'module_disabled'
  | 'busy' | 'failed';
export interface ChecklistEvaluationResponse {
  revision: string;
  assessments: ChecklistAssessment[];
  error?: string;
}
/** Human corrections remain separate and never rewrite an AI assessment. */
export interface ChecklistManualOverride {
  origin: 'human';
  status: ChecklistHumanStatus;
  /** Required (1-200 characters) for notApplicable and for a rejected AI tick. */
  reason?: string;
  /** A human rejected the AI tick: the point is back to not heard. */
  rejected?: true;
}
export const MAX_NOT_APPLICABLE_REASON = 200;

export type ChecklistOverviewRequest = { sessionId: string } | { sessionKey: string };
export type ChecklistEffectiveStatus = ChecklistHumanStatus | 'pending';
export interface ChecklistCitedQuote extends ChecklistQuote {
  speaker: 'seller' | 'other' | 'unknown';
  start: number;
  end: number;
}
export interface ChecklistOverviewRow {
  criterionId: string;
  label: string;
  required: boolean;
  effective: ChecklistEffectiveStatus;
  aiStatus: ChecklistStatus | null;
  correction: { status: ChecklistHumanStatus; reason?: string; rejected?: true } | null;
  /** A human rejected the AI tick (traceable: the AI evidence stays on the row). */
  rejected: { reason: string } | null;
  /** A 0.9.2 manual status that is shown but no longer counted. */
  ignoredManual: ChecklistHumanStatus | null;
  /** What was said: not heard, only mentioned, explained, or explained and confirmed by the customer. */
  level: ChecklistLevel | null;
  kind: ChecklistKind | null;
  customerConfirmed: boolean;
  explanation: string;
  evidence: ChecklistCitedQuote[];
  customerEvidence: ChecklistCitedQuote[];
}
export type ChecklistLevel = 'notHeard' | 'mentioned' | 'explained' | 'explainedConfirmed';
export interface ChecklistOverview {
  schemaVersion: 1;
  revision: string | null;
  evaluatedAt: string | null;
  checklistVersion: string;
  counts: Record<ChecklistEffectiveStatus, number>;
  /** Discussed over total; points marked Niet van toepassing are not in the total. */
  score: { covered: number; total: number };
  rows: ChecklistOverviewRow[];
}
export interface ChecklistOverviewListItem {
  sessionKey: string;
  updatedAt: string;
  criteriaCount: number;
  reviewed: boolean;
  manualCount: number;
}

export type ChecklistNoteResult =
  | { found: false }
  | { found: true; title: string; overview: ChecklistOverview; markdown: string;
      /** The last check of the conversation, started when the recording stopped, is still running. */
      finalRunning?: boolean };

/** What the host planner reports for the live check; the interface only displays it. */
export type ChecklistLivePhase = 'noText' | 'waiting' | 'busy' | 'listening' | 'error' | 'tooLarge' | 'finalBusy' | 'ended';
export interface ChecklistLiveState {
  active: true;
  /** Grows with every state the host publishes, so an older answer never replaces a newer push. */
  seq: number;
  sessionId: string;
  title: string | null;
  criteria: ChecklistCriterion[];
  mappingConfirmed: boolean;
  phase: ChecklistLivePhase;
  lastRunAt: string | null;
  failure: { reason: ChecklistFailureReason; at: string } | null;
  /** Counters only: text lines seen, checks started, checks failed, the newest-lines window when text outgrew one check, and
   *  how many times a lower later judgment was held back (levels per point only go up within one conversation). */
  counters: { lines: number; checks: number; failures: number; window: number | null; held?: number };
  /** A content-free code: stil, maxwacht, stop, te_veel_tekst, busy or a failure reason. */
  lastReason: string | null;
  result: { response: ChecklistEvaluationResponse; segments: ChecklistSegment[] } | null;
}
export type ChecklistLive = ChecklistLiveState | { active: false; seq: number };
export interface ChecklistNoteScore {
  title: string;
  covered: number;
  total: number;
}
