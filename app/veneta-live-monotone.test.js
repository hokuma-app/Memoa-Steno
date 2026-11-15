'use strict';
// 0.10.1: within one conversation "said" is a fact that does not disappear. Levels are monotone per point:
// notHeard < mentioned < explained < explainedConfirmed. A later check may only raise a point, never lower it, as long
// as the quoted segment still exists unchanged in this session's transcript. Synthetic text only; the model boundary is
// the only fake, the real planner, validators and overview builder are in the loop.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveChecklistPlanner, carryForward, mapFinals } = require('./veneta-live-checklist');
const { validateAssessmentResponse, validateRequest } = require('./veneta-product-ipc');
const { buildOverview } = require('./veneta-checklist-overview');

function clock() {
  let time = 1_000_000; let id = 0; const timers = new Map();
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    now: () => time, setTimeout: (fn, ms) => { id++; timers.set(id, { at: time + ms, fn }); return id; }, clearTimeout: (h) => { timers.delete(h); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); time = Math.max(time, due[1].at); due[1].fn();
      }
      time = end; await settle();
    },
  };
}
const CRITERIA = [{ id: 'c1', label: 'Behoefte uitgevraagd', required: true }, { id: 'c2', label: 'Werkwijze uitgelegd', required: true }];
const say = (index, text, speaker = 'You') => ({ text, start: index * 3, end: index * 3 + 2, isFinal: true, speaker });
const base = { explanation: 'x', customerConfirmed: false, customerEvidence: [] };
const none = (criterionId) => ({ criterionId, status: 'unmentioned', evidence: [], kind: 'none', ...base });
const mention = (criterionId, segment, quote = segment.text) => ({ criterionId, status: 'partial', evidence: [{ segmentId: segment.id, quote }], kind: 'mentioned', ...base });
const explain = (criterionId, segment, quote = segment.text) => ({ criterionId, status: 'covered', evidence: [{ segmentId: segment.id, quote }], kind: 'explained', ...base });
const confirm = (assessment, segment) => ({ ...assessment, customerConfirmed: true, customerEvidence: [{ segmentId: segment.id, quote: segment.text }] });
const unsureButNamed = (criterionId, segment) => ({ criterionId, status: 'uncertain', evidence: [{ segmentId: segment.id, quote: segment.text }], kind: 'mentioned', ...base });

function harness() {
  const c = clock();
  const h = { c, finals: [], persisted: [], emitted: [], logs: [], script: [] };
  const planner = createLiveChecklistPlanner({
    now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, finalGraceMs: 0, busyRetryMs: 5000,
    moduleEnabled: () => true, getMicIsSeller: () => true, attach: () => ({ criteria: CRITERIA, templateName: 'Proef' }),
    getFinals: () => h.finals,
    // The model: each check pops the next scripted answer, built from the segments of that very request.
    evaluate: async (request) => {
      const answer = h.script.shift();
      const assessments = answer ? answer(request) : request.criteria.map((item) => none(item.id));
      return { ok: true, response: { revision: request.revision, assessments } };
    },
    persist: (request, response) => { validateRequest(request); validateAssessmentResponse(response, request); h.persisted.push({ request, response }); },
    emit: (state) => h.emitted.push(state), log: (event, fields) => h.logs.push({ event, fields }), keyOf: (id) => `key:${id}`,
  });
  h.planner = planner;
  h.add = (...segments) => { h.finals = [...h.finals, ...segments]; planner.notify(); };
  h.check = async () => { await c.advance(10_000); };
  h.last = () => h.persisted.at(-1);
  h.byId = (criterionId, entry = h.last()) => entry.response.assessments.find((a) => a.criterionId === criterionId);
  h.segmentOf = (index) => mapFinals(h.finals, true)[index];
  return h;
}

test('RED origin: a point explained once stays explained when a later check on the same text says unmentioned', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Wij komen gratis meten bij u thuis.'), say(1, 'Wat is uw woonsituatie op dit moment?'));
  h.script.push((r) => [explain('c1', r.segments[0], 'gratis meten'), none('c2')]);
  await h.check();
  h.add(say(2, 'Dan kijken we naar de planning.'));
  h.script.push((r) => r.criteria.map((item) => none(item.id)));
  await h.check();
  assert.equal(h.persisted.length, 2);
  const kept = h.byId('c1');
  assert.equal(kept.status, 'covered');
  assert.equal(kept.evidence[0].quote, 'gratis meten');
  assert.equal(h.planner.getState().result.response.assessments.find((a) => a.criterionId === 'c1').status, 'covered', 'the sidebar shows the same');
  assert.equal(h.planner.getState().counters.held, 1, 'the diagnostic counter names the blocked lowering');
});

test('levels only go up: mentioned, explained, explained and confirmed by the customer; the newest quote is kept when a point rises', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Even over de werkwijze: wij meten eerst op.'), say(1, 'Daarna maken we een offerte met alle details.'), say(2, 'Dat is helder, gaat u maar door.', 'Others'));
  h.script.push((r) => [none('c1'), mention('c2', r.segments[0], 'Even over de werkwijze')]);
  await h.check();
  assert.equal(h.byId('c2').status, 'partial');
  h.add(say(10 + 1, `Tussenzin nummer ${1} van het gesprek.`));
  h.script.push((r) => [none('c1'), explain('c2', r.segments[1], 'maken we een offerte')]);
  await h.check();
  assert.equal(h.byId('c2').status, 'covered');
  assert.equal(h.byId('c2').evidence[0].quote, 'maken we een offerte', 'raised: the newest quote');
  h.add(say(10 + 2, `Tussenzin nummer ${2} van het gesprek.`));
  h.script.push((r) => [none('c1'), confirm(explain('c2', r.segments[0], 'wij meten eerst op'), r.segments[2])]);
  await h.check();
  assert.equal(h.byId('c2').customerConfirmed, true);
  assert.equal(h.byId('c2').evidence[0].quote, 'wij meten eerst op', 'raised again: the newest quote');
  // Lower again (explained without confirmation, then mentioned, then nothing): nothing is lost.
  h.add(say(10 + 3, `Tussenzin nummer ${3} van het gesprek.`));
  h.script.push((r) => [none('c1'), explain('c2', r.segments[1], 'met alle details')]);
  await h.check();
  assert.equal(h.byId('c2').customerConfirmed, true, 'customer confirmation counts as the highest level and stays');
  assert.equal(h.byId('c2').evidence[0].quote, 'wij meten eerst op');
  h.add(say(10 + 4, `Tussenzin nummer ${4} van het gesprek.`));
  h.script.push((r) => [none('c1'), mention('c2', r.segments[0], 'Even over de werkwijze')]);
  await h.check();
  h.add(say(10 + 5, `Tussenzin nummer ${5} van het gesprek.`));
  h.script.push((r) => r.criteria.map((item) => none(item.id)));
  await h.check();
  assert.equal(h.byId('c2').customerConfirmed, true);
  assert.equal(h.planner.getState().counters.held, 3);
});

test('at an equal level the first quote is kept', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Wij komen gratis meten bij u thuis.'), say(1, 'Daarna maken we een offerte met alle details.'));
  h.script.push((r) => [explain('c1', r.segments[0], 'gratis meten'), none('c2')]);
  await h.check();
  h.script.push((r) => [explain('c1', r.segments[1], 'maken we een offerte'), none('c2')]);
  await h.check();
  assert.equal(h.byId('c1').evidence[0].quote, 'gratis meten');
  assert.equal(h.planner.getState().counters.held, 0, 'nothing was lowered');
});

test('an unsure judgment that still names the point counts as mentioned and is held against a later unmentioned', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Wat is uw woonsituatie op dit moment?'));
  h.script.push((r) => [unsureButNamed('c1', r.segments[0]), none('c2')]);
  await h.check();
  h.add(say(1, 'Nog een zin erbij.'));
  h.script.push((r) => r.criteria.map((item) => none(item.id)));
  await h.check();
  assert.equal(h.byId('c1').status, 'uncertain');
  assert.equal(h.byId('c1').evidence.length, 1);
});

test('a segment that was rewritten or is gone may be judged again, and a point never held without a quote', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Wij komen gratis meten bij u thuis.'), say(1, 'Wat is uw woonsituatie op dit moment?'));
  h.script.push((r) => [explain('c1', r.segments[0], 'gratis meten'), none('c2')]);
  await h.check();
  // The host rewrote the segment (other text): the old quote no longer stands on anything.
  h.finals = [say(0, 'Wij komen ongeveer volgende week langs.'), h.finals[1]];
  h.planner.notify();
  h.script.push((r) => r.criteria.map((item) => none(item.id)));
  await h.check();
  assert.equal(h.byId('c1').status, 'unmentioned', 'reassessed after the text changed');
  assert.equal(h.planner.getState().counters.held, 0);
});

test('the last check at stop follows the same rule and lands in the same session file', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Wij komen gratis meten bij u thuis.'));
  h.script.push((r) => [explain('c1', r.segments[0], 'gratis meten'), none('c2')]);
  await h.check();
  h.add(say(1, 'Tot ziens en bedankt voor het gesprek.'));
  h.script.push((r) => r.criteria.map((item) => none(item.id)));
  await h.planner.finish();
  assert.equal(h.persisted.length, 2);
  assert.equal(h.last().request.sessionId, 'recording:1');
  assert.equal(h.byId('c1').status, 'covered');
  // What the note tab and the score read is this same persisted result.
  const overview = buildOverview({ criteria: CRITERIA, manualOverrides: {}, evaluation: { savedAt: 'x', request: h.last().request, response: h.last().response } });
  assert.equal(overview.rows[0].level, 'explained');
  assert.equal(overview.score.covered, 1);
});

test('a failed check changes nothing, and a human rejection or not-applicable still wins over the held result', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Wij komen gratis meten bij u thuis.'));
  h.script.push((r) => [explain('c1', r.segments[0], 'gratis meten'), none('c2')]);
  await h.check();
  const entry = h.last();
  const rejected = buildOverview({ criteria: CRITERIA, manualOverrides: { c1: { origin: 'human', status: 'unmentioned', rejected: true, reason: 'Niet echt uitgelegd' } },
    evaluation: { savedAt: 'x', request: entry.request, response: entry.response } });
  assert.equal(rejected.rows[0].effective, 'unmentioned');
  assert.equal(rejected.rows[0].level, 'notHeard');
  const notApplicable = buildOverview({ criteria: CRITERIA, manualOverrides: { c1: { origin: 'human', status: 'notApplicable', reason: 'Niet nodig' } },
    evaluation: { savedAt: 'x', request: entry.request, response: entry.response } });
  assert.equal(notApplicable.rows[0].effective, 'notApplicable');
  assert.equal(notApplicable.rows[0].level, null);
});

test('carryForward: a different speaker mapping carries nothing; an old quote that still stands is kept even inside the window', () => {
  const first = { id: 'sa', text: 'Wij komen gratis meten bij u thuis.', start: 0, end: 1, speaker: 'seller' };
  const later = { id: 'sb', text: 'Dat was het voor vandaag.', start: 40, end: 41, speaker: 'seller' };
  const previous = { mappingConfirmed: true, segments: [first], response: { revision: 'r1', assessments: [explain('c1', first, 'gratis meten'), none('c2')] } };
  const request = { sessionId: 's', revision: 'r2', mappingConfirmed: true, criteria: CRITERIA, segments: [first, later] };
  const response = { revision: 'r2', assessments: [none('c1'), mention('c2', later, 'voor vandaag')] };
  const transcript = new Map([[first.id, first.text], [later.id, later.text]]);
  const merged = carryForward(previous, request, response, transcript);
  assert.equal(merged.response.assessments[0].status, 'covered');
  assert.equal(merged.held, 1);
  assert.equal(merged.response.assessments[1].status, 'partial');
  validateRequest(merged.request); validateAssessmentResponse(merged.response, merged.request);
  assert.equal(carryForward({ ...previous, mappingConfirmed: false }, request, response, transcript).held, 0);
  // The quoted segment changed text in the transcript: judged again.
  assert.equal(carryForward(previous, request, response, new Map([[first.id, 'Een andere tekst.'], [later.id, later.text]])).response.assessments[0].status, 'unmentioned');
});

test('the diagnostics stay content-free: the new counter is a number and no log carries a quote', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(say(0, 'Geheime klantzin over de prijs.'));
  h.script.push((r) => [explain('c1', r.segments[0], 'Geheime klantzin'), none('c2')]);
  await h.check();
  h.add(say(1, 'Nog iets erbij.'));
  await h.check();
  const logged = JSON.stringify(h.logs);
  assert.equal(logged.includes('Geheime'), false);
  assert.ok(h.logs.some((e) => e.event === 'check_done' && typeof e.fields.held === 'number' && e.fields.held === 1));
  assert.equal(typeof h.planner.getState().counters.held, 'number');
});
