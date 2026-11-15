import { describe, expect, it } from 'vitest';
import { groundEvaluation, isWholeWordQuote, levelOf, liveState } from '../domain';
import type { ChecklistAssessment, ChecklistEvaluationRequest } from '../contracts';

const request: ChecklistEvaluationRequest = {
  sessionId: 'm', revision: 'r1', mappingConfirmed: true,
  criteria: [{ id: 'c1', label: 'Levertijd', required: true }],
  segments: [
    { id: 's1', text: 'De levering duurt twee weken.', speaker: 'seller', start: 5, end: 9 },
    { id: 's2', text: 'Twee weken is akkoord voor ons.', speaker: 'other', start: 10, end: 13 },
  ],
};
const row = (changes: Partial<ChecklistAssessment>): ChecklistAssessment => ({
  criterionId: 'c1', status: 'covered', evidence: [{ segmentId: 's1', quote: 'twee weken' }], explanation: 'x',
  kind: 'explained', customerConfirmed: true, customerEvidence: [{ segmentId: 's2', quote: 'akkoord voor ons' }], ...changes,
});
const ground = (changes: Partial<ChecklistAssessment>, req = request) =>
  groundEvaluation(req, { revision: 'r1', assessments: [row(changes)] })!.assessments[0];

describe('three separate levels', () => {
  it('keeps genoemd, uitgelegd and door klant bevestigd apart', () => {
    const a = ground({});
    expect([a.status, a.kind, a.customerConfirmed, a.customerEvidence]).toEqual(['covered', 'explained', true, [{ segmentId: 's2', quote: 'akkoord voor ons' }]]);
  });
  it('customer-only naming is mentioned, never explained, and its evidence survives', () => {
    const a = ground({ status: 'partial', kind: 'mentioned', evidence: [{ segmentId: 's2', quote: 'Twee weken' }], customerConfirmed: false, customerEvidence: [] });
    expect([a.status, a.kind, a.evidence.length]).toEqual(['partial', 'mentioned', 1]);
  });
  it.each([
    ['customer evidence from the seller', { customerEvidence: [{ segmentId: 's1', quote: 'twee weken' }] }],
    ['confirmed without evidence', { customerEvidence: [] }],
    ['evidence without confirmation', { customerConfirmed: false }],
    ['forged customer quote', { customerEvidence: [{ segmentId: 's2', quote: 'nooit gezegd' }] }],
    ['explained but not covered', { status: 'partial' as const }],
    ['covered but only mentioned', { kind: 'mentioned' as const }],
    ['unknown level', { kind: 'begrepen' as never }],
  ])('fails closed on %s', (_name, changes) => {
    const a = ground(changes);
    expect([a.status, a.kind, a.customerConfirmed, a.evidence]).toEqual(['uncertain', 'none', false, []]);
  });
  it('gives older results without level fields conservative defaults', () => {
    const { kind: _k, customerConfirmed: _c, customerEvidence: _e, ...old } = row({});
    const a = groundEvaluation(request, { revision: 'r1', assessments: [old] })!.assessments[0];
    expect([a.kind, a.customerConfirmed, a.customerEvidence]).toEqual(['explained', false, []]);
  });
});

describe('citations are whole words of at least three characters', () => {
  it.each([
    ['a word fragment', 'weke', 'Welke weken zijn akkoord.', false],
    ['a fragment at the end', 'eken', 'Welke weken zijn akkoord.', false],
    ['shorter than three characters', 'is', 'Dat is akkoord.', false],
    ['only whitespace around two characters', ' ok ', 'Dat is ok voor ons.', false],
    ['one whole word', 'akkoord', 'Dat is akkoord.', true],
    ['a phrase with punctuation', 'akkoord.', 'Dat is akkoord.', true],
    ['the whole segment', 'Dat is akkoord.', 'Dat is akkoord.', true],
    ['a word with accents', 'één', 'Het is één maand.', true],
    ['a word inside a longer accented word', 'één', 'Het is eenéén.', false],
  ])('%s', (_name, quote, text, expected) => {
    expect(isWholeWordQuote(text, quote)).toBe(expected);
  });
  it('grounding turns a fragment citation into an uncertain judgment', () => {
    const a = ground({ evidence: [{ segmentId: 's1', quote: 'weke' }], status: 'partial', kind: 'mentioned', customerConfirmed: false, customerEvidence: [] },
      { ...request, segments: [{ ...request.segments[0], text: 'Welke weken kloppen.' }, request.segments[1]] });
    expect(a.status).toBe('uncertain');
    expect(a.evidence).toEqual([]);
  });
});

describe('levelOf: what was actually said', () => {
  it.each([
    ['covered', true, 'explainedConfirmed'], ['covered', false, 'explained'], ['partial', false, 'mentioned'],
    ['uncertain', false, 'notHeard'], ['unmentioned', false, 'notHeard'],
  ] as const)('%s with customer confirmation %s is %s', (status, confirmed, level) => {
    expect(levelOf({ criterionId: 'c', status, evidence: [], explanation: '', customerConfirmed: confirmed })).toBe(level);
  });
  it('is notHeard without any judgment yet', () => {
    expect(levelOf(undefined)).toBe('notHeard');
  });
  it('shows an uncertain judgment that named the point with a quote as mentioned, never as explained', () => {
    const quote = [{ segmentId: 's1', quote: 'twee weken' }];
    expect(levelOf({ criterionId: 'c', status: 'uncertain', kind: 'mentioned', evidence: quote, explanation: '', customerConfirmed: false })).toBe('mentioned');
    expect(levelOf({ criterionId: 'c', status: 'uncertain', kind: 'mentioned', evidence: [], explanation: '', customerConfirmed: false })).toBe('notHeard');
    expect(levelOf({ criterionId: 'c', status: 'uncertain', kind: 'none', evidence: quote, explanation: '', customerConfirmed: false })).toBe('notHeard');
    expect(levelOf({ criterionId: 'c', status: 'unmentioned', kind: 'mentioned', evidence: quote, explanation: '', customerConfirmed: false })).toBe('notHeard');
  });
});

describe('liveState explains the always-on check', () => {
  const base = { busy: false, failure: null, segmentCount: 2, withinLimits: true, lastRun: null };
  const at = new Date('2026-10-29T14:32:00');
  it.each([
    ['noText', { segmentCount: 0 }],
    ['waiting', {}],
    ['busy', { busy: true, failure: { reason: 'timeout' as const, at } }],
    ['tooLarge', { withinLimits: false }],
    ['listening', { lastRun: at }],
    ['error', { failure: { reason: 'model_missing' as const, at } }],
  ])('%s', (kind, changes) => {
    expect(liveState({ ...base, ...changes }).kind).toBe(kind);
  });
  it('keeps the last check time visible next to waiting for new text', () => {
    expect(liveState({ ...base, lastRun: at })).toEqual({ kind: 'listening', lastRun: at });
  });
});
