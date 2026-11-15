import { describe, expect, it } from 'vitest';
import { groundEvaluation } from '../domain';
import type { ChecklistEvaluationRequest, ChecklistEvaluationResponse } from '../contracts';

const request: ChecklistEvaluationRequest = {
  sessionId: 'meeting',
  revision: 'r1',
  mappingConfirmed: true,
  criteria: [{ id: 'c1', label: 'Bespreek de vervolgstap', required: true }],
  segments: [{ id: 's1', text: 'Ik bel u morgen terug.', speaker: 'seller', start: 12, end: 15 }],
};
const response: ChecklistEvaluationResponse = {
  revision: 'r1',
  assessments: [
    {
      criterionId: 'c1',
      status: 'covered',
      evidence: [{ segmentId: 's1', quote: 'Ik bel u morgen terug.' }],
      explanation: 'Er is een vervolgstap afgesproken.',
    },
  ],
};

describe('groundEvaluation', () => {
  it('accepts semantic model judgments with exact seller evidence without keyword matching', () => {
    expect(groundEvaluation(request, response)?.assessments[0].status).toBe('covered');
  });
  it.each(['other', 'unknown'] as const)('rejects %s speaker as seller evidence', (speaker) => {
    const result = groundEvaluation(
      { ...request, segments: [{ ...request.segments[0], speaker }] },
      response
    );
    expect(result?.assessments[0].status).toBe('uncertain');
    expect(result?.assessments[0].evidence).toEqual([]);
  });
  it('requires an explicit mapping acknowledgment', () => {
    expect(
      groundEvaluation({ ...request, mappingConfirmed: false }, response)?.assessments[0].status
    ).toBe('uncertain');
  });
  it.each([
    { segmentId: 'missing', quote: 'Ik bel u morgen terug.' },
    { segmentId: 's1', quote: 'Wij geven korting.' },
  ])('rejects hallucinated evidence %j', (evidence) => {
    expect(
      groundEvaluation(request, {
        ...response,
        assessments: [{ ...response.assessments[0], evidence: [evidence] }],
      })?.assessments[0].status
    ).toBe('uncertain');
  });
  it('rejects an outdated revision entirely', () => {
    expect(groundEvaluation(request, { ...response, revision: 'old' })).toBeNull();
  });
  it('fails closed on malformed model output and fills missing criteria as uncertain', () => {
    expect(
      groundEvaluation(request, { revision: 'r1', assessments: [] })?.assessments[0].status
    ).toBe('uncertain');
    expect(
      groundEvaluation(request, {
        revision: 'r1',
        assessments: null,
      } as unknown as ChecklistEvaluationResponse)
    ).toBeNull();
  });
  it('does not accept covered with no evidence or duplicate assessments', () => {
    expect(
      groundEvaluation(request, {
        ...response,
        assessments: [{ ...response.assessments[0], evidence: [] }],
      })?.assessments[0].status
    ).toBe('uncertain');
    expect(
      groundEvaluation(request, {
        ...response,
        assessments: [response.assessments[0], response.assessments[0]],
      })?.assessments[0].status
    ).toBe('uncertain');
  });
});
export { request, response };
