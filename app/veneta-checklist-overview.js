'use strict';
const crypto = require('node:crypto');

// Pure builder for the derived "overzicht na afloop". It reads already validated
// draft + evaluation data and never touches the canonical note or transcript.
const COUNT_KEYS = ['covered', 'partial', 'unmentioned', 'uncertain', 'notApplicable', 'pending'];
const STATUS_TEXT = {
  covered: 'Besproken', partial: 'Gedeeltelijk', unmentioned: 'Ontbrekend', uncertain: 'Onzeker',
  notApplicable: 'Niet van toepassing', pending: 'Niet beoordeeld',
};
const SPEAKER_TEXT = { seller: 'verkoper', other: 'klant', unknown: 'onbekend' };

function checklistVersion(criteria) {
  return crypto.createHash('sha256').update(JSON.stringify(criteria.map((c) => [c.id, c.label, c.required]))).digest('hex').slice(0, 12);
}

function cite(items, segments) {
  return items.map((item) => {
    const segment = segments.get(item.segmentId);
    return { segmentId: item.segmentId, quote: item.quote, speaker: segment ? segment.speaker : 'unknown',
      start: segment ? segment.start : 0, end: segment ? segment.end : 0 };
  });
}

// Only what was said counts: a manual tick never changes a point. A human may mark a point "Niet van
// toepassing" or reject an AI tick (back to not heard, with a reason). Older 0.9.2 manual statuses are kept
// in the draft but shown as ignored.
function levelOf(effective, row) {
  if (effective === 'notApplicable') return null;
  if (effective === 'covered') return row.customerConfirmed ? 'explainedConfirmed' : 'explained';
  if (effective === 'partial') return 'mentioned';
  // An unsure judgment that still named the point with a grounded quote shows as mentioned, never explained.
  if (effective === 'uncertain' && row.kind === 'mentioned' && row.evidence.length > 0) return 'mentioned';
  return 'notHeard';
}

function buildOverview({ criteria, manualOverrides, evaluation }) {
  const request = evaluation ? evaluation.request : null;
  const response = evaluation ? evaluation.response : null;
  const segments = new Map((request ? request.segments : []).map((segment) => [segment.id, segment]));
  const assessments = new Map((response ? response.assessments : []).map((item) => [item.criterionId, item]));
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
  const rows = criteria.map((criterion) => {
    const ai = assessments.get(criterion.id) || null;
    const override = Object.hasOwn(manualOverrides, criterion.id) ? manualOverrides[criterion.id] : null;
    const notApplicable = override && override.status === 'notApplicable';
    const rejected = override && override.rejected === true;
    const effective = notApplicable ? 'notApplicable' : rejected ? 'unmentioned' : ai ? ai.status : 'pending';
    counts[effective] += 1;
    const row = {
      criterionId: criterion.id, label: criterion.label, required: criterion.required,
      effective, aiStatus: ai ? ai.status : null,
      correction: notApplicable || rejected ? { status: override.status, reason: override.reason, ...(rejected ? { rejected: true } : {}) } : null,
      rejected: rejected ? { reason: override.reason } : null,
      ignoredManual: override && !notApplicable && !rejected ? override.status : null,
      kind: ai ? ai.kind : null, customerConfirmed: ai ? ai.customerConfirmed : false,
      explanation: ai ? ai.explanation : '',
      evidence: ai ? cite(ai.evidence, segments) : [],
      customerEvidence: ai ? cite(ai.customerEvidence, segments) : [],
    };
    return { ...row, level: levelOf(effective, row) };
  });
  return {
    schemaVersion: 1,
    revision: response ? response.revision : null,
    evaluatedAt: evaluation ? evaluation.savedAt : null,
    checklistVersion: checklistVersion(criteria),
    counts, score: { covered: counts.covered, total: rows.length - counts.notApplicable }, rows,
  };
}

const stamp = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
const KIND_TEXT = { explained: 'Uitgelegd door verkoper', mentioned: 'Alleen genoemd', none: 'Niet genoemd' };

// Model text, citations and human reasons are one line each: a line break would start a new heading or list item.
const oneLine = (text) => String(text).replace(/[\r\n\u2028\u2029]+/g, ' ');

function overviewMarkdown(overview, { title = 'Overzicht gesprekschecklist' } = {}) {
  const lines = [`# ${oneLine(title)}`, ''];
  lines.push(overview.revision
    ? `Beoordeeld: ${overview.evaluatedAt || 'onbekend'} · transcriptrevisie ${overview.revision} · checklistversie ${overview.checklistVersion}`
    : `Nog geen AI-beoordeling · checklistversie ${overview.checklistVersion}`);
  lines.push(`Samenvatting: ${COUNT_KEYS.filter((key) => overview.counts[key]).map((key) => `${overview.counts[key]} ${STATUS_TEXT[key].toLowerCase()}`).join(', ') || 'geen punten'}`);
  lines.push('AI kan fouten maken. Controleer citaten en betekenis zelf. Genoemd, uitgelegd en door de klant bevestigd zijn aparte beoordelingen.', '');
  overview.rows.forEach((row, index) => {
    lines.push(`## ${index + 1}. ${oneLine(row.label)}: ${STATUS_TEXT[row.effective]}`);
    if (row.rejected) {
      lines.push(`- Afgewezen door mens. Reden: ${oneLine(row.rejected.reason)}`);
      lines.push(`- AI-oordeel: ${row.aiStatus ? STATUS_TEXT[row.aiStatus] : 'geen'}`);
    } else if (row.correction) {
      lines.push(`- Menselijke correctie: ${STATUS_TEXT[row.correction.status]}${row.correction.reason ? `. Reden: ${oneLine(row.correction.reason)}` : ''}`);
      lines.push(`- AI-oordeel: ${row.aiStatus ? STATUS_TEXT[row.aiStatus] : 'geen'}`);
    }
    if (row.ignoredManual) lines.push(`- Handmatige markering genegeerd: ${STATUS_TEXT[row.ignoredManual]}. Alleen wat gezegd is telt mee.`);
    if (row.kind) {
      lines.push(`- Niveau: ${KIND_TEXT[row.kind]}`);
      lines.push(`- Door klant bevestigd: ${row.customerConfirmed ? 'ja' : 'nee'}`);
    }
    if (row.explanation) lines.push(`- Toelichting: ${oneLine(row.explanation)}`);
    for (const e of row.evidence) lines.push(`- Bewijs ${stamp(e.start)} ${SPEAKER_TEXT[e.speaker]}: "${oneLine(e.quote)}"`);
    for (const e of row.customerEvidence) lines.push(`- Klantbevestiging ${stamp(e.start)} ${SPEAKER_TEXT[e.speaker]}: "${oneLine(e.quote)}"`);
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { buildOverview, overviewMarkdown, checklistVersion, COUNT_KEYS };
