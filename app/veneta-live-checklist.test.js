'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveChecklistPlanner, liveSessionId, mapFinals, planWindow, carryForward, uniqueCriteria, LIMITS } = require('./veneta-live-checklist');
const { validateAssessmentResponse, validateRequest } = require('./veneta-product-ipc');

/** A deterministic clock: timers only fire inside advance(), and promises settle between them. */
function clock() {
  let time = 1_000_000; let id = 0; const timers = new Map();
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    now: () => time,
    setTimeout: (fn, ms) => { id++; timers.set(id, { at: time + ms, fn }); return id; },
    clearTimeout: (handle) => { timers.delete(handle); },
    pending: () => timers.size,
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
const final = (index, text = `Synthetische zin ${index}.`, speaker = 'You') => ({ text, start: index * 3, end: index * 3 + 2, isFinal: true, speaker });

/** Everything the planner touches, as observable fakes. */
function harness(overrides = {}) {
  const c = clock();
  const h = {
    c, finals: [], enabled: true, micIsSeller: true, draft: { criteria: CRITERIA, templateName: 'Proef' },
    attached: [], evaluated: [], persisted: [], emitted: [], logs: [], reads: 0, outcome: null,
  };
  const planner = createLiveChecklistPlanner({
    now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, finalGraceMs: 0, busyRetryMs: 5000,
    moduleEnabled: () => { h.reads++; return h.enabled; },
    getMicIsSeller: () => h.micIsSeller,
    attach: (id) => { h.attached.push(id); return h.draft; },
    getFinals: () => h.finals,
    evaluate: async (request) => {
      h.evaluated.push(request);
      if (h.outcome) return typeof h.outcome === 'function' ? h.outcome(request) : h.outcome;
      return { ok: true, response: { revision: request.revision, assessments: request.criteria.map((item, index) => {
        const seller = request.segments.find((s) => s.speaker === 'seller');
        return index === 0 && seller
          ? { criterionId: item.id, status: 'covered', evidence: [{ segmentId: seller.id, quote: seller.text }], explanation: 'x', kind: 'explained', customerConfirmed: false, customerEvidence: [] }
          : { criterionId: item.id, status: 'unmentioned', evidence: [], explanation: 'x', kind: 'none', customerConfirmed: false, customerEvidence: [] };
      }) } };
    },
    persist: (request, response) => h.persisted.push({ request, response }),
    emit: (state) => h.emitted.push(state),
    log: (event, fields) => h.logs.push({ event, fields }),
    keyOf: (id) => `key:${id}`,
    ...overrides,
  });
  h.planner = planner;
  h.add = (...segments) => { h.finals = [...h.finals, ...segments]; planner.notify(); };
  return h;
}

test('session ids match the renderer keys: recording by start time, a continued note by a stable hash of its path', () => {
  assert.equal(liveSessionId({ appendTarget: null, startedAtMs: 1777777777777 }), 'recording:1777777777777');
  const a = liveSessionId({ appendTarget: '/notes/a_summary.md', startedAtMs: 1 });
  assert.match(a, /^note:[0-9a-f]{16}:19$/);
  assert.equal(a, liveSessionId({ appendTarget: '/notes/a_summary.md', startedAtMs: 2 }));
  assert.notEqual(a, liveSessionId({ appendTarget: '/notes/b_summary.md', startedAtMs: 1 }));
});

test('RED origin: continuous speech never leaves ten quiet seconds, yet a check runs by thirty seconds and keeps coming for ninety', async () => {
  const h = harness();
  assert.equal(h.planner.begin({ startedAtMs: 1 }), true);
  const marks = [];
  for (let i = 0; i < 30; i++) {
    h.add(final(i));
    await h.c.advance(3000);
    if (i === 9 || i === 19 || i === 29) marks.push(h.evaluated.length);
  }
  assert.deepEqual(h.evaluated.length >= 3, true);
  assert.ok(marks[0] >= 1, 'first check within thirty seconds of the first final');
  assert.ok(marks[1] > marks[0] && marks[2] > marks[1], `checks keep coming: ${marks}`);
  const state = h.planner.getState();
  assert.equal(state.counters.lines, 30);
  assert.equal(state.counters.checks, h.evaluated.length);
  assert.equal(state.phase, 'listening');
  assert.equal(state.lastReason, 'maxwacht');
  assert.equal(h.persisted.length, h.evaluated.length);
});

test('ten quiet seconds start a check; before that nothing runs, and phase is waiting', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  assert.equal(h.planner.getState().phase, 'noText');
  h.add(final(0), final(1));
  assert.equal(h.planner.getState().phase, 'waiting');
  await h.c.advance(9_900);
  assert.equal(h.evaluated.length, 0);
  await h.c.advance(200);
  assert.equal(h.evaluated.length, 1);
  assert.equal(h.planner.getState().lastReason, 'stil');
  assert.equal(h.planner.getState().phase, 'listening');
  assert.equal(h.evaluated[0].mappingConfirmed, true);
  assert.deepEqual(h.evaluated[0].segments.map((s) => s.speaker), ['seller', 'seller']);
  assert.equal(h.evaluated[0].sessionId, 'recording:1');
});

test('energy saver waits through short silences, checks by sixty seconds of continuous finals, and checks at stop', async () => {
  const h = harness({ energySaver: true });
  h.planner.begin({ startedAtMs: 1 });
  for (let i = 0; i < 20; i++) {
    h.add(final(i));
    await h.c.advance(3_000);
    if (i < 19) assert.equal(h.evaluated.length, 0, 'geen vroege modelaanroep');
  }
  assert.equal(h.evaluated.length, 1, 'lang spreken blijft live beoordeeld');
  h.add(final(20));
  await h.planner.finish();
  assert.equal(h.evaluated.length, 2, 'stop beoordeelt de laatste definitieve zin');
});

test('the seller setting is read per check: with it off nothing is seller and the request says unconfirmed', async () => {
  const h = harness();
  h.micIsSeller = false;
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  assert.equal(h.evaluated[0].mappingConfirmed, false);
  assert.deepEqual(h.evaluated[0].segments.map((s) => s.speaker), ['unknown']);
});

test('single flight: finals during a check wait; the next check follows, and never two at once', async () => {
  const h = harness();
  let release; let concurrent = 0; let peak = 0;
  h.outcome = (request) => new Promise((resolve) => {
    concurrent++; peak = Math.max(peak, concurrent);
    release = () => { concurrent--; resolve({ ok: true, response: { revision: request.revision, assessments: request.criteria.map((item) => ({ criterionId: item.id, status: 'unmentioned', evidence: [], explanation: 'x', kind: 'none', customerConfirmed: false, customerEvidence: [] })) } }); };
  });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  assert.equal(h.planner.getState().phase, 'busy');
  h.add(final(1));
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 1, 'no second check while one runs');
  release();
  await h.c.advance(0);
  // The waiting final is far past its thirty seconds: the next check follows at once, still one at a time.
  assert.equal(h.evaluated.length, 2);
  assert.equal(h.planner.getState().phase, 'busy');
  release();
  await h.c.advance(0);
  assert.equal(h.planner.getState().phase, 'listening');
  assert.equal(peak, 1);
});

test('a failure keeps its content-free reason, is not retried without new text, and the next text retries', async () => {
  const h = harness();
  h.outcome = { ok: false, reason: 'model_missing' };
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  let state = h.planner.getState();
  assert.equal(state.phase, 'error');
  assert.equal(state.failure.reason, 'model_missing');
  assert.equal(state.lastReason, 'model_missing');
  assert.deepEqual([state.counters.checks, state.counters.failures], [1, 1]);
  await h.c.advance(120_000);
  assert.equal(h.evaluated.length, 1);
  h.outcome = null;
  h.add(final(1));
  await h.c.advance(10_000);
  state = h.planner.getState();
  assert.equal(state.phase, 'listening');
  assert.equal(state.failure, null);
  assert.equal(h.evaluated.length, 2);
});

test('busy from the shared slot is retried with the same text and is not counted as a check or a failure', async () => {
  const h = harness();
  let busy = true;
  const real = h.outcome;
  h.outcome = (request) => (busy ? { ok: false, reason: 'busy' } : { ok: true, response: { revision: request.revision, assessments: request.criteria.map((item) => ({ criterionId: item.id, status: 'unmentioned', evidence: [], explanation: 'x', kind: 'none', customerConfirmed: false, customerEvidence: [] })) } });
  void real;
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  assert.equal(h.planner.getState().counters.checks, 0);
  assert.equal(h.planner.getState().counters.failures, 0);
  assert.equal(h.planner.getState().failure, null);
  busy = false;
  await h.c.advance(5_000);
  assert.equal(h.planner.getState().counters.checks, 1);
  assert.equal(h.planner.getState().phase, 'listening');
});

test('module off: nothing is attached, read, scheduled or evaluated', async () => {
  const h = harness();
  h.enabled = false;
  assert.equal(h.planner.begin({ startedAtMs: 1 }), false);
  h.add(final(0));
  await h.c.advance(120_000);
  assert.deepEqual([h.attached.length, h.evaluated.length, h.persisted.length, h.c.pending()], [0, 0, 0, 0]);
  assert.equal(h.planner.getState().active, false);
});

test('switching the module off mid-recording cancels the pending check and stops further ones', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  h.enabled = false;
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 0);
  h.enabled = true;
  h.add(final(1));
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 0, 'a cancelled session stays cancelled');
});

test('no prepared checklist: the recording gets none and nothing runs', async () => {
  const h = harness();
  h.draft = { criteria: [], manualOverrides: {} };
  assert.equal(h.planner.begin({ startedAtMs: 1 }), false);
  h.add(final(0));
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 0);
});

test('a new recording replaces the old session and its pending timer', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  h.planner.begin({ startedAtMs: 2 });
  h.finals = [];
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 0);
  assert.equal(h.planner.getState().sessionId, 'recording:2');
});

test('repeated renderer mounts cannot reset anything: state is queryable at any time and rewritten finals are re-checked', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0), final(1));
  await h.c.advance(5000);
  for (let mount = 0; mount < 5; mount++) { assert.equal(h.planner.getState().counters.lines, 2); await h.c.advance(1000); }
  // The engine rewrites the same number of finals: same count, other text.
  h.finals = [final(0, 'Herschreven zin.'), final(1)];
  h.planner.notify();
  await h.c.advance(10_000);
  assert.equal(h.evaluated.length, 2, 'the check at ten seconds came before the rewrite; the rewrite triggers another');
  assert.equal(h.evaluated[1].segments[0].text, 'Herschreven zin.');
  const seqs = h.emitted.map((s) => s.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'pushed states are ordered');
});

test('diagnostics and logs carry counters and codes only, never transcript text, criteria or quotes', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0, 'Geheime klantzin over de prijs.'));
  await h.c.advance(10_000);
  await h.planner.finish();
  const logged = JSON.stringify(h.logs);
  for (const secret of ['Geheime', 'prijs', 'Behoefte', 'Werkwijze', 'Synthetische']) assert.equal(logged.includes(secret), false, secret);
  for (const entry of h.logs) for (const value of Object.values(entry.fields)) assert.ok(['number', 'boolean', 'string'].includes(typeof value) && (typeof value !== 'string' || /^[a-z0-9_]{1,16}$/.test(value)), `${entry.event}`);
  assert.ok(h.logs.some((entry) => entry.event === 'check_start'));
});

test('the last check at stop covers unassessed finals, lands in the same session file and shows the final-busy phase', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0), final(1));
  await h.c.advance(10_000);
  assert.equal(h.evaluated.length, 1);
  h.add(final(2, 'Laatste woorden voor het stoppen.'));
  const done = h.planner.finish();
  assert.equal(h.planner.getState().phase, 'finalBusy');
  assert.equal(h.planner.finalRunningFor('key:recording:1'), true);
  assert.equal(h.planner.finalRunningFor('key:recording:2'), false);
  // The sidecar drains one more utterance after stop; the last check includes it.
  h.finals = [...h.finals, final(3, 'Nagekomen zin.')];
  await h.c.advance(3000);
  await done;
  assert.equal(h.evaluated.length, 2);
  assert.equal(h.evaluated[1].segments.length, 4);
  assert.equal(h.persisted.length, 2);
  assert.equal(h.persisted[1].request.sessionId, 'recording:1');
  assert.equal(h.planner.finalRunningFor('key:recording:1'), false);
  assert.equal(h.planner.getState().lastReason, 'stop');
  assert.equal(h.planner.getState().phase, 'ended');
  // A later notify cannot start anything on an ended session.
  h.add(final(9));
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 2);
});

test('no last check, and no claim that one runs, when everything was already assessed or nothing was said', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  const done = h.planner.finish();
  assert.equal(h.planner.getState().phase, 'ended', 'stopping stays quiet: no final-busy phase');
  assert.equal(h.planner.finalRunningFor('key:recording:1'), false);
  await h.c.advance(3000); await done;
  assert.equal(h.evaluated.length, 1);
  const empty = harness();
  empty.planner.begin({ startedAtMs: 1 });
  await empty.planner.finish();
  assert.equal(empty.evaluated.length, 0);
});

test('a last utterance drained by the sidecar after stop still gets its last check, claimed only from that moment', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  const done = h.planner.finish();
  assert.equal(h.planner.finalRunningFor('key:recording:1'), false);
  h.finals = [...h.finals, final(1, 'Nagekomen zin.')];
  await h.c.advance(3000);
  await done;
  assert.equal(h.evaluated.length, 2);
  assert.equal(h.evaluated[1].segments.length, 2);
  assert.equal(h.planner.getState().lastReason, 'stop');
  assert.equal(h.planner.finalRunningFor('key:recording:1'), false);
});

test('a last check that keeps meeting a busy slot waits and then runs, and finish stays pending meanwhile', async () => {
  const h = harness();
  let busy = 2;
  h.outcome = (request) => (busy-- > 0 ? { ok: false, reason: 'busy' } : { ok: true, response: { revision: request.revision, assessments: request.criteria.map((item) => ({ criterionId: item.id, status: 'unmentioned', evidence: [], explanation: 'x', kind: 'none', customerConfirmed: false, customerEvidence: [] })) } });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  const done = h.planner.finish();
  let finished = false; void done.then(() => { finished = true; });
  await h.c.advance(4_000);
  assert.equal(finished, false);
  await h.c.advance(12_000);
  assert.equal(finished, true);
  assert.equal(h.persisted.length, 1);
  assert.equal(h.planner.getState().counters.checks, 1);
});

test('cancel stops timers, drops a late answer and never persists it', async () => {
  const h = harness();
  let release;
  h.outcome = (request) => new Promise((resolve) => { release = () => resolve({ ok: true, response: { revision: request.revision, assessments: [] } }); });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  h.planner.cancel();
  release();
  await h.c.advance(60_000);
  assert.equal(h.persisted.length, 0);
});

test('limits: over the budget a check reads the newest tail that fits, and carries earlier findings with their own quotes', async () => {
  const labels = CRITERIA.reduce((sum, item) => sum + item.label.length, 0);
  const text = 'a'.repeat(1000);
  const finals = Array.from({ length: 40 }, (_, index) => ({ text: `${index === 0 ? 'Wij komen gratis meten bij u thuis. ' : ''}${text}`, start: index, end: index + 0.5, isFinal: true, speaker: 'You' }));
  const segments = mapFinals(finals, true);
  const plan = planWindow(CRITERIA, segments);
  assert.equal(plan.kind, 'ok');
  assert.ok(plan.dropped > 0);
  const chars = plan.segments.reduce((sum, s) => sum + s.text.length, 0);
  assert.ok(chars + labels <= LIMITS.characters);
  assert.equal(plan.segments.at(-1).id, segments.at(-1).id, 'the newest text is always in');
  assert.deepEqual(plan.segments.map((s) => s.id), segments.slice(segments.length - plan.segments.length).map((s) => s.id), 'a contiguous tail');
  // 300 short segments: the count limit applies.
  const many = mapFinals(Array.from({ length: 300 }, (_, i) => ({ text: `z${i}`, start: i, end: i + 1, isFinal: true, speaker: 'Others' })), true);
  assert.equal(planWindow(CRITERIA, many).segments.length, LIMITS.segments);
  // The newest segment alone cannot fit: skipped, not truncated.
  assert.equal(planWindow(CRITERIA, mapFinals([{ text: 'x'.repeat(24000), start: 0, end: 1, isFinal: true, speaker: 'You' }], true)).kind, 'tooLarge');
});

test('a windowed check keeps an earlier covered point and its quote; the stored request still validates with the manual-evaluation rules', () => {
  const first = { id: 'f0-0-1', text: 'Wij komen gratis meten bij u thuis.', start: 0, end: 1, speaker: 'seller' };
  const previous = {
    mappingConfirmed: true, segments: [first],
    response: { revision: 'r1', assessments: [
      { criterionId: 'c1', status: 'covered', evidence: [{ segmentId: first.id, quote: 'gratis meten' }], explanation: 'x', kind: 'explained', customerConfirmed: false, customerEvidence: [] },
      { criterionId: 'c2', status: 'unmentioned', evidence: [], explanation: 'x', kind: 'none', customerConfirmed: false, customerEvidence: [] }] },
  };
  const later = { id: 'f40-40-41', text: 'Dat was het voor vandaag.', start: 40, end: 41, speaker: 'seller' };
  const request = { sessionId: 's', revision: 'r2', mappingConfirmed: true, criteria: CRITERIA, segments: [later] };
  const response = { revision: 'r2', assessments: [
    { criterionId: 'c1', status: 'unmentioned', evidence: [], explanation: 'y', kind: 'none', customerConfirmed: false, customerEvidence: [] },
    { criterionId: 'c2', status: 'partial', evidence: [{ segmentId: later.id, quote: 'voor vandaag' }], explanation: 'y', kind: 'mentioned', customerConfirmed: false, customerEvidence: [] }] };
  const merged = carryForward(previous, request, response);
  assert.equal(merged.carried, 1);
  assert.equal(merged.response.assessments[0].status, 'covered');
  assert.equal(merged.response.assessments[1].status, 'partial', 'the newer, stronger finding wins');
  validateRequest(merged.request);
  validateAssessmentResponse(merged.response, merged.request);
  // Speaker mapping changed between checks: nothing is carried over.
  assert.equal(carryForward({ ...previous, mappingConfirmed: false }, request, response).carried, 0);
  // The window contains the old quote again and still says unmentioned: the quote still stands, so the point is kept (0.10.1).
  const again = carryForward(previous, { ...request, segments: [first, later] }, response);
  assert.equal(again.carried, 1);
  assert.equal(again.held, 1);
  assert.equal(again.response.assessments[0].status, 'covered');
  // The quoted segment no longer stands in the session's transcript (rewritten or gone): the new judgment stands.
  const gone = carryForward(previous, { ...request, segments: [first, later] }, response, new Map([[later.id, later.text]]));
  assert.equal(gone.carried, 0);
});

test('duplicate points (case and spacing ignored) are one point', () => {
  const merged = uniqueCriteria([{ id: 'a', label: 'Punt 1', required: true }, { id: 'b', label: ' punt   1 ', required: true }, { id: 'c', label: 'Punt 2', required: false }]);
  assert.deepEqual(merged.map((item) => item.id), ['a', 'c']);
});

// ---- 0.9.4 review round 2 ----
const covers = (id, text, criterionId = 'c1') => ({ criterionId, status: 'covered', evidence: [{ segmentId: id, quote: text }], explanation: 'x', kind: 'explained', customerConfirmed: false, customerEvidence: [] });
const none = (criterionId) => ({ criterionId, status: 'unmentioned', evidence: [], explanation: 'x', kind: 'none', customerConfirmed: false, customerEvidence: [] });
const many = (count, from = 0) => Array.from({ length: count }, (_, i) => final(from + i, `Unieke zin nummer ${from + i} voor de proef.`));

test('over 256 finals an earlier found point keeps its finding and its literal quote: the window leaves room for the carried segments', async () => {
  const h = harness();
  let round = 0;
  h.outcome = (request) => {
    round++;
    const assessments = round === 1
      ? [covers(request.segments[0].id, request.segments[0].text), none('c2')]
      : request.criteria.map((item) => none(item.id)); // the model only sees the newest window and says unmentioned
    return { ok: true, response: { revision: request.revision, assessments } };
  };
  h.planner.begin({ startedAtMs: 1 });
  h.add(...many(200));
  await h.c.advance(10_000);
  const quoted = h.persisted[0].response.assessments[0].evidence[0];
  h.add(...many(100, 200));
  await h.c.advance(10_000);
  assert.equal(h.persisted.length, 2);
  const { request, response } = h.persisted[1];
  assert.equal(response.assessments[0].status, 'covered', 'a found point never falls back');
  assert.ok(request.segments.length <= LIMITS.segments, `window ${request.segments.length}`);
  const cited = request.segments.find((segment) => segment.id === response.assessments[0].evidence[0].segmentId);
  assert.ok(cited, 'the quoted segment travels with the request');
  assert.equal(cited.text, 'Unieke zin nummer 0 voor de proef.');
  assert.equal(response.assessments[0].evidence[0].quote, quoted.quote);
  assert.equal(request.segments.at(-1).text, 'Unieke zin nummer 299 voor de proef.', 'the newest text is still in');
  validateRequest(request); validateAssessmentResponse(response, request);
});

test('the carry also survives the last check at stop and a third window', async () => {
  const h = harness();
  let round = 0;
  h.outcome = (request) => {
    round++;
    return { ok: true, response: { revision: request.revision, assessments: round === 1
      ? [covers(request.segments[0].id, request.segments[0].text), none('c2')] : request.criteria.map((item) => none(item.id)) } };
  };
  h.planner.begin({ startedAtMs: 1 });
  h.add(...many(150));
  await h.c.advance(10_000);
  h.add(...many(200, 150));
  await h.c.advance(10_000);
  h.add(...many(10, 350));
  await h.planner.finish();
  assert.equal(h.persisted.length, 3);
  const last = h.persisted[2];
  assert.equal(last.response.assessments[0].status, 'covered');
  assert.ok(last.request.segments.length <= LIMITS.segments);
  assert.ok(last.request.segments.some((segment) => segment.id === last.response.assessments[0].evidence[0].segmentId));
});

test('segment ids stay the same when a late final is inserted chronologically earlier, and equal segments stay distinct', () => {
  const base = many(5);
  const before = mapFinals(base, true);
  const late = { text: 'Laat vrijgegeven zin.', start: 4.5, end: 5.5, isFinal: true, speaker: 'Others' };
  const after = mapFinals([...base.slice(0, 2), late, ...base.slice(2)], true);
  for (const segment of before) assert.ok(after.some((item) => item.id === segment.id && item.text === segment.text), `${segment.id} kept`);
  assert.equal(new Set(after.map((item) => item.id)).size, after.length);
  const twins = mapFinals([final(0, 'Ja ja ja.'), final(0, 'Ja ja ja.')], true);
  assert.notEqual(twins[0].id, twins[1].id);
  assert.deepEqual(mapFinals([final(0, 'Ja ja ja.'), final(0, 'Ja ja ja.')], true).map((s) => s.id), twins.map((s) => s.id));
  for (const segment of after) validateRequest({ sessionId: 's', revision: 'r', mappingConfirmed: true, criteria: CRITERIA, segments: [segment] });
});

test('a quote keeps pointing to its segment across requests when a late final shifts the buffer', async () => {
  const h = harness();
  h.outcome = (request) => ({ ok: true, response: { revision: request.revision, assessments: [covers(request.segments[1].id, request.segments[1].text), none('c2')] } });
  h.planner.begin({ startedAtMs: 1 });
  h.add(...many(3));
  await h.c.advance(10_000);
  const firstId = h.persisted[0].response.assessments[0].evidence[0].segmentId;
  h.finals = [h.finals[0], { text: 'Laat vrijgegeven zin.', start: 1, end: 2, isFinal: true, speaker: 'You' }, ...h.finals.slice(1)];
  h.planner.notify();
  await h.c.advance(10_000);
  const second = h.evaluated[1].segments;
  assert.equal(second.find((segment) => segment.id === firstId)?.text, 'Unieke zin nummer 1 voor de proef.');
});

test('the last check waits for the real sidecar drain, bounded by the watchdog, so the last utterance counts', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  let drain; const drained = new Promise((resolve) => { drain = resolve; });
  const done = h.planner.finish({ drained, drainTimeoutMs: 5500 });
  await h.c.advance(4000);
  h.finals = [...h.finals, final(1, 'Laatste uiting na vier seconden.')];
  assert.equal(h.evaluated.length, 1, 'no last check before the drain ends');
  await h.c.advance(500); drain(); await h.c.advance(0); await done;
  assert.equal(h.evaluated.length, 2);
  assert.ok(h.evaluated[1].segments.some((segment) => segment.text === 'Laatste uiting na vier seconden.'));
});

test('a drain that never ends does not hold the last check longer than the bound', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  const done = h.planner.finish({ drained: new Promise(() => {}), drainTimeoutMs: 5500 });
  let finished = false; void done.then(() => { finished = true; });
  await h.c.advance(5000); assert.equal(finished, false);
  await h.c.advance(600); await done;
  assert.equal(h.evaluated.length, 1);
});

test('cancel clears grace and busy-retry timers and lets a pending finish settle', async () => {
  const grace = harness({ finalGraceMs: 3000 });
  grace.planner.begin({ startedAtMs: 1 });
  grace.add(final(0));
  const waiting = grace.planner.finish();
  await grace.c.advance(0);
  grace.planner.cancel();
  assert.equal(grace.c.pending(), 0, 'grace timer cleared');
  await waiting;
  const busy = harness();
  busy.outcome = { ok: false, reason: 'busy' };
  busy.planner.begin({ startedAtMs: 1 });
  busy.add(final(0));
  const last = busy.planner.finish();
  await busy.c.advance(1000);
  assert.ok(busy.c.pending() > 0, 'a busy retry is waiting');
  busy.planner.cancel();
  assert.equal(busy.c.pending(), 0, 'busy retry cleared');
  await last;
});

test('the buffered finals are released once the last check is done', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: 1 });
  h.add(...many(3));
  await h.c.advance(10_000);
  await h.planner.finish();
  assert.equal(h.planner.retainedFinals(), 0);
  assert.equal(h.planner.finalRunningFor('key:recording:1'), false);
});

test('the note reads as still being finalised from the moment of stop, also while the drain wait has not claimed a check yet', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  await h.c.advance(10_000);
  const done = h.planner.finish();
  assert.equal(h.planner.finalRunningFor('key:recording:1'), false, 'nothing claimed yet');
  assert.equal(h.planner.finalPendingFor('key:recording:1'), true, 'but the result may still change');
  await h.c.advance(3000); await done;
  assert.equal(h.planner.finalPendingFor('key:recording:1'), false);
});

test('a failed capture start drops only a recording in progress, never the previous note\'s last check', async () => {
  const h = harness({ finalGraceMs: 3000 });
  h.planner.begin({ startedAtMs: 1 });
  h.add(final(0));
  const done = h.planner.finish();
  h.planner.cancel({ keepFinishing: true });
  assert.equal(h.planner.finalPendingFor('key:recording:1'), true, 'the stopped note keeps finishing');
  await h.c.advance(3000); await done;
  assert.equal(h.evaluated.length, 1);
  h.planner.begin({ startedAtMs: 2 });
  h.add(final(1));
  h.planner.cancel({ keepFinishing: true });
  await h.c.advance(60_000);
  assert.equal(h.evaluated.length, 1, 'the recording that failed to start never checks');
});

test('main.js hands the real sidecar drain to the last check and cancels the planner when starting capture fails', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'main.js'), 'utf8');
  assert.match(source, /const drained = stopLiveTranscribe\(\);[\s\S]{0,400}venetaProduct\.live\.finish\(\{ drained, drainTimeoutMs: SIDECAR_KILL_WATCHDOG_MS/);
  assert.match(source, /isOllamaBusy: \(\) => isProcessing \|\| processingQueue\.length > 0 \|\| activeReprocessJobs\.size > 0/);
  const start = source.indexOf("console.error('Start recording UI error:'");
  assert.ok(start > 0);
  assert.match(source.slice(start, start + 600), /venetaProduct\.live\.cancel\(\{ keepFinishing: true \}\)/);
});
