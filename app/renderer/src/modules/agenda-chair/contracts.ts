/** Contracts of the agenda chair (stand 1), mirrored from the host (app/veneta-agenda-chair.js). */
export type AgendaOutcome = 'besluit' | 'informatie' | 'discussie' | 'actie';
export type AgendaStatus = 'open' | 'loopt' | 'afgerond' | 'overgeslagen' | 'doorgeschoven';
export type AgendaFindingKind = 'besluit' | 'actie' | 'vraag';
export type AgendaSpeaker = 'self' | 'other' | 'unknown';
export type AgendaRecognition = 'mens' | 'agent_bevestigd' | null;
export type AgendaReview = 'voorstel' | 'bevestigd' | 'afgewezen' | 'gecorrigeerd';
export type AgendaAction = 'start' | 'finish' | 'skip' | 'defer' | 'confirmSuggestion' | 'dismissSuggestion';

export const AGENDA_LIMITS = { items: 32, sourceChars: 24_000, fileBytes: 256 * 1024, titleChars: 200, ownerChars: 80, minutes: 480 } as const;
export const AGENDA_OUTCOMES: readonly AgendaOutcome[] = ['besluit', 'informatie', 'discussie', 'actie'];

export interface AgendaItem {
  id: string;
  title: string;
  outcome: AgendaOutcome;
  minutes: number | null;
  owner: string | null;
  required: boolean;
}
export interface Agenda {
  schemaVersion: 1;
  agendaId: string;
  title: string | null;
  source: { kind: 'text' | 'file'; name: string | null; text: string };
  version: number;
  createdAt: string;
  items: AgendaItem[];
}
export interface AgendaEvidence { segmentId: string; quote: string; start: number; end: number; speaker: AgendaSpeaker }
export interface AgendaFinding {
  id: string;
  kind: AgendaFindingKind;
  itemId: string | null;
  text: string;
  owner: string | null;
  due: string | null;
  evidence: AgendaEvidence;
  origin: 'ai';
}
export type AgendaSignal =
  | { code: 'tijd_bijna_om' | 'tijd_om' | 'uitkomst_ontbreekt'; itemId: string }
  | { code: 'besluit_zonder_eigenaar'; itemId: string | null; findingId: string; missing: ('eigenaar' | 'termijn')[] }
  | { code: 'vereist_punt_open'; itemIds: string[] };
export type AgendaPhase = 'noText' | 'waiting' | 'busy' | 'finalBusy' | 'listening' | 'error' | 'tooLarge' | 'ended';
export interface AgendaItemState {
  status: AgendaStatus;
  spentMs: number;
  running: boolean;
  recognition: AgendaRecognition;
  startOffset: number | null;
}
export interface AgendaSuggestion { itemId: string; segmentId: string; quote: string; start: number; speaker: AgendaSpeaker; at: string }
export type AgendaLive =
  | { active: false; seq: number }
  | {
      active: true;
      seq: number;
      sessionId: string;
      hostNow: number;
      ended: boolean;
      stateVersion: number;
      agenda: { title: string | null; version: number; items: AgendaItem[] };
      items: Record<string, AgendaItemState>;
      currentItemId: string | null;
      suggestion: AgendaSuggestion | null;
      findings: AgendaFinding[];
      signals: AgendaSignal[];
      planned: { totalMinutes: number; meetingMs: number };
      phase: AgendaPhase;
      lastRunAt: string | null;
      failure: { reason: string; at: string } | null;
      counters: { lines: number; checks: number; failures: number; stale: number; skipped: number };
      lastReason: string | null;
    };
export type AgendaLiveActive = Extract<AgendaLive, { active: true }>;

export interface AgendaMinutesFinding {
  id: string;
  kind: AgendaFindingKind;
  text: string;
  owner: string | null;
  due: string | null;
  ai: { text: string; owner: string | null; due: string | null };
  evidence: AgendaEvidence;
  review: AgendaReview;
  reason: string | null;
}
export interface AgendaFindingGroups { decisions: AgendaMinutesFinding[]; actions: AgendaMinutesFinding[]; questions: AgendaMinutesFinding[] }
export interface AgendaMinutesItem extends AgendaItem, AgendaFindingGroups {
  number: number;
  status: AgendaStatus;
  spentSec: number;
  recognition: AgendaRecognition;
  startOffset: number | null;
  overTime: boolean;
  missingOutcome: boolean;
}
export interface AgendaMinutes {
  schemaVersion: 1;
  title: string | null;
  items: AgendaMinutesItem[];
  other: AgendaFindingGroups;
  counts: { decisions: number; actions: number; questions: number; proposals: number; confirmed: number };
  totals: { plannedMinutes: number; spentSec: number };
  ownerMissing: string[];
}
export type AgendaNoteResult =
  | { found: false }
  | { found: true; title: string | null; minutes: AgendaMinutes; markdown: string; finalRunning: boolean };
export type AgendaNoteFound = Extract<AgendaNoteResult, { found: true }>;
export type AgendaCorrection = { noteFile: string; findingId: string; action: 'confirm' | 'reject' | 'correct' | 'clear'; text?: string; owner?: string | null; due?: string | null; reason?: string };
