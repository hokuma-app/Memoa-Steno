'use strict';
// Model-free tests of the agenda chair (stand 1): parser, timing and signals with a fake clock, the host planner
// (single flight, bounded window, stale answers, module off), literal quotes and the minutes export.
// All agendas and conversations are invented; no real persons or customer data.
const test = require('node:test');
const assert = require('node:assert/strict');
const chair = require('./veneta-agenda-chair');

const { parseAgenda, parseItemText, validateAgenda, signalsOf, createAgendaPlanner, validateAgendaResponse, validateAgendaRequest,
  planAgendaWindow, buildMinutes, minutesMarkdown, newSession, applyAction, mergeAnswer, validateSession, LIMITS } = chair;

/** A deterministic clock: timers only fire inside advance(), and promises settle between them. */
function clock(start = 1_000_000) {
  let time = start; let id = 0; const timers = new Map();
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

const AGENDA_TEXT = [
  '# Teamoverleg Zonnebloem',
  'Datum: 3 maart',
  '1. Opening (5 min)',
  '2. Keuze nieuwe planningstool (besluit, 10 min, Sanne) [vereist]',
  '3. Mededelingen (ter info) 5m',
  '4. Rondvraag',
].join('\n');
const agenda = () => parseAgenda(AGENDA_TEXT, { now: () => 0 }).agenda;
const final = (index, text, speaker = 'You', start = index * 3) => ({ text, start, end: start + 2, isFinal: true, speaker });

function harness(overrides = {}) {
  const c = clock();
  const h = { c, finals: [], enabled: true, ready: agenda(), analyzed: [], persisted: [], emitted: [], logs: [], outcome: null, reviews: {} };
  h.planner = createAgendaPlanner({
    now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, finalGraceMs: 0, busyRetryMs: 5000,
    moduleEnabled: () => h.enabled,
    attach: (sessionId) => (h.ready ? newSession(sessionId, h.ready) : null),
    getFinals: () => h.finals,
    analyze: async (request, options) => {
      h.analyzed.push({ request, options });
      if (h.outcome) return typeof h.outcome === 'function' ? h.outcome(request) : h.outcome;
      return { ok: true, response: { revision: request.revision, currentItem: null, findings: [] } };
    },
    persist: (session) => h.persisted.push(session),
    getReviews: () => h.reviews,
    emit: (state) => h.emitted.push(state),
    log: (event, fields) => h.logs.push({ event, fields }),
    keyOf: (id) => `key:${id}`,
    ...overrides,
  });
  h.add = (...segments) => { h.finals = [...h.finals, ...segments]; h.planner.notify(); };
  h.state = () => h.planner.getState();
  return h;
}
const answer = (request, { currentItem = null, findings = [] } = {}) => ({ ok: true, response: validateAgendaResponse({ revision: request.revision, currentItem, findings }, request) });

// ---- Parser ----------------------------------------------------------------------------------------------------

test('parser: numbered list with title, metadata, time blocks, owner, outcome tag and required marker', () => {
  const parsed = parseAgenda(AGENDA_TEXT);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.agenda.title, 'Teamoverleg Zonnebloem');
  assert.deepEqual(parsed.agenda.items.map(({ id, title, outcome, minutes, owner, required }) => [id, title, outcome, minutes, owner, required]), [
    ['p1', 'Opening', 'discussie', 5, null, false],
    ['p2', 'Keuze nieuwe planningstool', 'besluit', 10, 'Sanne', true],
    ['p3', 'Mededelingen', 'informatie', 5, null, false],
    ['p4', 'Rondvraag', 'discussie', null, null, false],
  ]);
  assert.equal(parsed.agenda.source.text, AGENDA_TEXT, 'the source is kept unchanged');
  assert.equal(parsed.agenda.source.kind, 'text');
});

test('parser: other notations (bullets, dashes, ranges, hours, labels, @name, door, tables, headings, plain lines)', () => {
  const cases = [
    ['- Begroting 2027 – 20 min – Ruben de Vries', { title: 'Begroting 2027', minutes: 20, owner: 'Ruben de Vries' }],
    ['* Planning Q1 10:00-10:25 eigenaar: Joost', { title: 'Planning Q1', minutes: 25, owner: 'Joost' }],
    ['• Jaarplan 1,5 uur @Fatima', { title: 'Jaarplan', minutes: 90, owner: 'Fatima' }],
    ['1) Presentatie door Sanne Bakker 15 min', { title: 'Presentatie', minutes: 15, owner: 'Sanne Bakker' }],
    ['a. Werkdruk (15m)', { title: 'Werkdruk', minutes: 15, owner: null }],
    ['- Opening - Welkom', { title: 'Opening - Welkom', owner: null }],
    ['- ! Contract vaststellen (verplicht)', { title: 'Contract vaststellen', outcome: 'besluit', required: true }],
    ['- Actiepunten vorige keer', { outcome: 'actie' }],
  ];
  for (const [line, expected] of cases) {
    const item = parseAgenda(line).agenda.items[0];
    for (const [key, value] of Object.entries(expected)) assert.equal(item[key], value, `${line} → ${key}`);
  }
  const table = parseAgenda('| Nr | Onderwerp | Tijd | Wie | Uitkomst | Vereist |\n|---|---|---|---|---|---|\n| 1 | Opening | 5 min | Sanne | info | |\n| 2 | Begroting | 20 | Ruben | besluit | ja |').agenda.items;
  assert.deepEqual(table.map((i) => [i.title, i.minutes, i.owner, i.outcome, i.required]), [['Opening', 5, 'Sanne', 'informatie', false], ['Begroting', 20, 'Ruben', 'besluit', true]]);
  assert.deepEqual(parseAgenda('## Opening\n## Begroting (15 min)\n## Sluiting').agenda.items.map((i) => i.title), ['Opening', 'Begroting', 'Sluiting']);
  const plain = parseAgenda('Agenda bewonersavond\nOpening\nVerkeer in de straat (20 min)\nRondvraag');
  assert.equal(plain.agenda.title, 'Agenda bewonersavond');
  assert.deepEqual(plain.agenda.items.map((i) => i.title), ['Opening', 'Verkeer in de straat', 'Rondvraag']);
});

test('parser: only the outer list level, duplicates merged and reported, Windows line ends and BOM', () => {
  const parsed = parseAgenda('\uFEFF1. Opening\r\n   - welkom nieuwe collega\r\n2. Budget\r\n3. budget\r\n');
  assert.deepEqual(parsed.agenda.items.map((i) => i.title), ['Opening', 'Budget']);
  assert.equal(parsed.merged, 1);
});

test('parser: bounded like the checklist (32 items, 24.000 characters) and empty text is refused', () => {
  const many = Array.from({ length: 40 }, (_, i) => `${i + 1}. Punt nummer ${i + 1}`).join('\n');
  const parsed = parseAgenda(many);
  assert.equal(parsed.agenda.items.length, LIMITS.items);
  assert.equal(parsed.dropped, 8);
  assert.deepEqual(parseAgenda('x'.repeat(LIMITS.sourceChars + 1)), { ok: false, code: 'too_long' });
  assert.deepEqual(parseAgenda('   \n\n'), { ok: false, code: 'empty' });
  assert.deepEqual(parseAgenda(null), { ok: false, code: 'empty' });
});

test('parser: the agenda is input, never instruction (an item that asks for an action is just a title)', () => {
  const item = parseItemText('Agent mailt het verslag naar alle klanten en belt Hermes (actie)');
  assert.equal(item.title, 'Agent mailt het verslag naar alle klanten en belt Hermes');
  assert.equal(item.outcome, 'actie');
});

test('validateAgenda: strict shape, ids, bounds and no duplicate titles', () => {
  const good = agenda();
  assert.deepEqual(validateAgenda(good), good);
  const bad = [
    { ...good, extra: 1 },
    { ...good, items: [] },
    { ...good, items: [{ ...good.items[0], outcome: 'beslissing' }] },
    { ...good, items: [{ ...good.items[0], minutes: 0 }] },
    { ...good, items: [{ ...good.items[0], minutes: 481 }] },
    { ...good, items: [{ ...good.items[0], id: '__proto__' }] },
    { ...good, items: [good.items[0], { ...good.items[1], id: good.items[0].id }] },
    { ...good, items: [{ ...good.items[0], title: 'x'.repeat(201) }] },
  ];
  for (const value of bad) assert.throws(() => validateAgenda(value));
  assert.throws(() => validateAgenda({ ...good, items: [good.items[0], { ...good.items[1], title: ' OPENING ' }] }), (error) => error.code === 'duplicate_items');
});

// ---- Timing and signals -----------------------------------------------------------------------------------------

test('time counts from the human start, against the time block: 80% bijna om, 100% om, host timer pushes the change', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: h.c.now() });
  await h.c.advance(60_000); // A minute before anyone starts an item: not counted.
  assert.equal(h.planner.act({ action: 'start', itemId: 'p2' }).ok, true);
  assert.equal(h.state().items.p2.spentMs, 0);
  assert.equal(h.state().items.p2.recognition, 'mens');
  const pushes = h.emitted.length;
  await h.c.advance(7 * 60_000 + 59_000);
  assert.deepEqual(h.state().signals.filter((s) => s.itemId === 'p2'), []);
  await h.c.advance(1_000); // 8:00 of 10:00 = 80%
  assert.ok(h.emitted.length > pushes, 'the host pushed the threshold itself');
  assert.deepEqual(h.emitted.at(-1).signals.map((s) => s.code), ['tijd_bijna_om']);
  await h.c.advance(2 * 60_000); // 10:00
  const codes = h.emitted.at(-1).signals.map((s) => s.code);
  assert.ok(codes.includes('tijd_om'));
  assert.ok(codes.includes('uitkomst_ontbreekt'), 'a decision item out of time without a decision');
  assert.equal(h.state().items.p2.spentMs, 10 * 60_000);
});

test('starting another item finishes the running one; skip and defer stop the clock; time adds up across runs', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: h.c.now() });
  h.planner.act({ action: 'start', itemId: 'p1' });
  await h.c.advance(4 * 60_000);
  h.planner.act({ action: 'start', itemId: 'p2' });
  let state = h.state();
  assert.equal(state.items.p1.status, 'afgerond');
  assert.equal(state.items.p1.spentMs, 4 * 60_000);
  assert.equal(state.currentItemId, 'p2');
  await h.c.advance(2 * 60_000);
  h.planner.act({ action: 'defer', itemId: 'p2' });
  await h.c.advance(5 * 60_000);
  state = h.state();
  assert.equal(state.items.p2.status, 'doorgeschoven');
  assert.equal(state.items.p2.spentMs, 2 * 60_000);
  assert.equal(state.currentItemId, null);
  h.planner.act({ action: 'start', itemId: 'p2' });
  await h.c.advance(60_000);
  h.planner.act({ action: 'skip', itemId: 'p3' });
  h.planner.act({ action: 'finish', itemId: 'p2' });
  state = h.state();
  assert.equal(state.items.p2.spentMs, 3 * 60_000);
  assert.equal(state.items.p3.status, 'overgeslagen');
  assert.equal(state.items.p2.status, 'afgerond');
  assert.deepEqual(h.planner.act({ action: 'start', itemId: 'p9' }), { ok: false, code: 'unknown_item' });
  assert.deepEqual(h.planner.act({ action: 'launch', itemId: 'p1' }), { ok: false, code: 'invalid' });
});

test('vereist_punt_open: less than ten minutes left of the planned 20 minutes while a required item is open', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: h.c.now() });
  await h.c.advance(9 * 60_000 + 59_000);
  assert.equal(h.state().signals.some((s) => s.code === 'vereist_punt_open'), false);
  await h.c.advance(2_000);
  const signal = h.emitted.at(-1).signals.find((s) => s.code === 'vereist_punt_open');
  assert.deepEqual(signal, { code: 'vereist_punt_open', itemIds: ['p2'] }, 'pushed by the host timer');
  h.planner.act({ action: 'skip', itemId: 'p2' });
  assert.equal(h.state().signals.some((s) => s.code === 'vereist_punt_open'), false);
});

test('signals: besluit_zonder_eigenaar and uitkomst_ontbreekt follow findings and human reviews (pure function)', () => {
  const session = newSession('recording:1', agenda());
  session.items.p2.status = 'afgerond';
  assert.deepEqual(signalsOf(session, 0).map((s) => s.code), ['uitkomst_ontbreekt']);
  session.findings.push({ id: 'f000000000001', kind: 'besluit', itemId: 'p2', text: 'We kiezen Planbord.', owner: null, due: null,
    evidence: { segmentId: 's1', quote: 'kiezen Planbord', start: 1, end: 2, speaker: 'self' }, origin: 'ai' });
  assert.deepEqual(signalsOf(session, 0), [{ code: 'besluit_zonder_eigenaar', itemId: 'p2', findingId: 'f000000000001', missing: ['eigenaar', 'termijn'] }]);
  assert.deepEqual(signalsOf(session, 0, { f000000000001: { status: 'gecorrigeerd', owner: 'Sanne', due: 'vrijdag', at: 'x' } }), []);
  assert.deepEqual(signalsOf(session, 0, { f000000000001: { status: 'afgewezen', at: 'x' } }).map((s) => s.code), ['uitkomst_ontbreekt']);
});

// ---- Planner: cadence, single flight, suggestions, stale answers ----------------------------------------------

test('module off: begin reads nothing, notify and actions do nothing, no model call and no file', async () => {
  const h = harness();
  h.enabled = false;
  let attached = 0;
  const off = harness({ attach: () => { attached++; return null; } });
  off.enabled = false;
  assert.equal(off.planner.begin({ startedAtMs: 1 }), false);
  off.add(final(0, 'We gaan naar punt twee.'));
  await off.c.advance(120_000);
  assert.equal(attached, 0);
  assert.equal(off.analyzed.length, 0);
  assert.equal(off.persisted.length, 0);
  assert.deepEqual(off.planner.act({ action: 'start', itemId: 'p1' }), { ok: false, code: 'no_session' });
  assert.equal(off.state().active, false);
  // Switching the module off during a meeting stops everything at the next event.
  const on = harness();
  on.planner.begin({ startedAtMs: 1 });
  on.add(final(0, 'Eerste zin van het overleg.'));
  on.enabled = false;
  await on.c.advance(60_000);
  assert.equal(on.analyzed.length, 0);
  assert.equal(on.state().active, false);
  void h;
});

test('no agenda prepared: nothing starts', () => {
  const h = harness();
  h.ready = null;
  assert.equal(h.planner.begin({ startedAtMs: 1 }), false);
  assert.equal(h.state().active, false);
  assert.equal(h.persisted.length, 0);
});

test('final segments only, ten quiet seconds or thirty at most, single flight, and the window reads only new text plus context', async () => {
  const h = harness();
  let release;
  h.outcome = (request) => new Promise((resolve) => { release = () => resolve(answer(request)); });
  h.planner.begin({ startedAtMs: h.c.now() });
  h.finals = [{ text: 'tussentijds', start: 0, end: 1, isFinal: false, speaker: 'You' }];
  h.planner.notify();
  await h.c.advance(60_000);
  assert.equal(h.analyzed.length, 0, 'a partial never triggers a check');
  for (let i = 0; i < 12; i++) { h.add(final(i, `Zin ${i} van het overleg.`)); await h.c.advance(3_000); }
  assert.equal(h.analyzed.length, 1, 'continuous speech: one check by thirty seconds');
  assert.equal(h.state().phase, 'busy');
  h.add(final(20, 'Nog een zin terwijl de controle loopt.'));
  await h.c.advance(40_000);
  assert.equal(h.analyzed.length, 1, 'single flight');
  release();
  await h.c.advance(10_000);
  assert.equal(h.analyzed.length, 2);
  const second = h.analyzed[1].request;
  assert.ok(second.segments.length <= 1 + LIMITS.context + 4, `window holds only new text and context: ${second.segments.length}`);
  assert.equal(second.segments.at(-1).text, 'Nog een zin terwijl de controle loopt.');
  assert.ok(h.logs.every((entry) => !JSON.stringify(entry).includes('overleg')), 'diagnostics carry no transcript text');
});

test('a suggested switch is shown and confirmed with one tap; time counts from the confirmation (agent_bevestigd)', async () => {
  const h = harness();
  h.outcome = (request) => {
    const segment = request.segments.find((s) => s.text.includes('planningstool'));
    return answer(request, { currentItem: segment ? { itemId: 'p2', segmentId: segment.id, quote: 'nieuwe planningstool' } : null });
  };
  h.planner.begin({ startedAtMs: h.c.now() });
  h.add(final(0, 'Dan nu de keuze voor de nieuwe planningstool.'));
  await h.c.advance(10_000);
  const suggestion = h.state().suggestion;
  assert.equal(suggestion.itemId, 'p2');
  assert.equal(suggestion.quote, 'nieuwe planningstool');
  assert.equal(h.state().items.p2.status, 'open', 'a suggestion never changes the meeting by itself');
  await h.c.advance(30_000);
  assert.equal(h.state().items.p2.spentMs, 0);
  assert.equal(h.planner.act({ action: 'confirmSuggestion', itemId: 'p2' }).ok, true);
  assert.equal(h.state().items.p2.recognition, 'agent_bevestigd');
  assert.equal(h.state().suggestion, null);
  await h.c.advance(60_000);
  assert.equal(h.state().items.p2.spentMs, 60_000);
  assert.deepEqual(h.planner.act({ action: 'confirmSuggestion' }), { ok: false, code: 'stale' });
});

test('a dismissed suggestion does not come back for the same quote', async () => {
  const h = harness();
  h.outcome = (request) => answer(request, { currentItem: { itemId: 'p3', segmentId: request.segments[0].id, quote: 'mededelingen' } });
  h.planner.begin({ startedAtMs: h.c.now() });
  h.add(final(0, 'Eerst de mededelingen.'));
  await h.c.advance(10_000);
  assert.equal(h.state().suggestion.itemId, 'p3');
  h.planner.act({ action: 'dismissSuggestion' });
  assert.equal(h.state().suggestion, null);
  const session = h.persisted.at(-1);
  const request = { sessionId: session.sessionId, revision: 'r', currentItemId: null, items: session.agenda.items.map(({ id, title, outcome }) => ({ id, title, outcome })),
    segments: [{ id: h.analyzed[0].request.segments[0].id, text: 'Eerst de mededelingen.', speaker: 'self', start: 0, end: 2 }] };
  mergeAnswer(session, { request, response: validateAgendaResponse({ revision: 'r', currentItem: { itemId: 'p3', segmentId: request.segments[0].id, quote: 'mededelingen' }, findings: [] }, request),
    fresh: [request.segments[0].id], stateVersion: session.stateVersion, nowMs: 0 });
  assert.equal(session.suggestion, null);
});

test('stale answer: a human action while the check was out wins; the old suggestion is dropped, findings still count', async () => {
  const h = harness();
  let release;
  h.outcome = (request) => new Promise((resolve) => { release = () => resolve(answer(request, {
    currentItem: { itemId: 'p3', segmentId: request.segments[0].id, quote: 'mededelingen' },
    findings: [{ kind: 'vraag', itemId: null, text: 'Wanneer komt de nieuwsbrief?', owner: null, due: null, segmentId: request.segments[0].id, quote: 'komt de nieuwsbrief' }],
  })); });
  h.planner.begin({ startedAtMs: h.c.now() });
  h.add(final(0, 'Bij de mededelingen: wanneer komt de nieuwsbrief?'));
  await h.c.advance(10_000);
  h.planner.act({ action: 'start', itemId: 'p1' });
  release();
  await h.c.advance(1);
  const state = h.state();
  assert.equal(state.suggestion, null);
  assert.equal(state.currentItemId, 'p1');
  assert.equal(state.counters.stale, 1);
  assert.equal(state.lastReason, 'verouderd');
  assert.equal(state.findings.length, 1);
});

test('findings: monotone (a later check never removes one, never adds a duplicate), assigned by the human timeline', async () => {
  const h = harness();
  let round = 0;
  h.outcome = (request) => {
    round++;
    const decision = request.segments.find((s) => s.text.includes('kiezen'));
    // Round two forgets the earlier decision (a small model is not stable between runs) and repeats it once more.
    const findings = [];
    if (decision && round === 1) findings.push({ kind: 'besluit', itemId: null, text: 'We kiezen Planbord.', owner: 'Sanne', due: 'vrijdag', segmentId: decision.id, quote: 'We kiezen Planbord' });
    const action = request.segments.find((s) => s.text.includes('stuurt'));
    if (action) findings.push({ kind: 'actie', itemId: 'p4', text: 'Ruben stuurt de offerte.', owner: 'Ruben', due: 'Pieter', segmentId: action.id, quote: 'Ruben stuurt de offerte' });
    if (decision && round > 1) findings.push({ kind: 'besluit', itemId: null, text: 'We kiezen Planbord.', owner: null, due: null, segmentId: decision.id, quote: 'We kiezen Planbord' });
    return answer(request, { findings });
  };
  h.planner.begin({ startedAtMs: h.c.now() });
  h.planner.act({ action: 'start', itemId: 'p2' });
  h.add(final(0, 'We kiezen Planbord, Sanne regelt het voor vrijdag.', 'You', 1));
  await h.c.advance(10_000);
  h.add(final(1, 'Ruben stuurt de offerte.', 'Others', 12));
  await h.c.advance(10_000);
  const findings = h.state().findings;
  assert.equal(findings.length, 2);
  const decision = findings.find((f) => f.kind === 'besluit');
  assert.deepEqual([decision.itemId, decision.owner, decision.due, decision.evidence.speaker], ['p2', 'Sanne', 'vrijdag', 'self']);
  const action = findings.find((f) => f.kind === 'actie');
  assert.equal(action.itemId, 'p2', 'the human timeline (p2 was running) wins over the model item');
  assert.equal(action.due, null, 'a deadline that was not said is dropped');
  assert.equal(action.evidence.speaker, 'other');
});

test('too much text for one check: the newest contiguous tail, never the middle; not even one segment fits → te_veel_tekst', async () => {
  const items = agenda().items.map(({ id, title, outcome }) => ({ id, title, outcome }));
  const segments = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, text: `zin ${i} `.repeat(20), speaker: 'self', start: i, end: i + 1 }));
  const plan = planAgendaWindow(items, segments, () => false);
  assert.equal(plan.kind, 'ok');
  assert.equal(plan.segments.at(-1).id, 's299');
  const ids = plan.segments.map((s) => Number(s.id.slice(1)));
  assert.ok(ids.every((value, index) => index === 0 || value === ids[index - 1] + 1), 'contiguous');
  assert.ok(plan.segments.reduce((sum, s) => sum + s.text.length, 0) <= LIMITS.characters);
  assert.equal(plan.skipped.length, 300 - plan.segments.length);
  assert.deepEqual(planAgendaWindow(items, [{ id: 'x', text: 'y'.repeat(LIMITS.characters), speaker: 'self', start: 0, end: 1 }], () => false), { kind: 'tooLarge' });
  const h = harness();
  h.planner.begin({ startedAtMs: h.c.now() });
  h.add({ text: 'w'.repeat(LIMITS.characters), start: 0, end: 1, isFinal: true, speaker: 'You' });
  await h.c.advance(10_000);
  assert.equal(h.analyzed.length, 0);
  assert.equal(h.state().phase, 'tooLarge');
  assert.equal(h.state().lastReason, 'te_veel_tekst');
});

test('busy model slot is retried without counting as a failure; a failure is retried only on new text', async () => {
  const h = harness();
  let calls = 0;
  h.outcome = (request) => { calls++; return calls === 1 ? { ok: false, reason: 'busy' } : calls === 2 ? { ok: false, reason: 'model_missing' } : answer(request); };
  h.planner.begin({ startedAtMs: h.c.now() });
  h.add(final(0, 'Eerste zin.'));
  await h.c.advance(10_000);
  assert.equal(h.state().counters.failures, 0);
  assert.equal(h.state().lastReason, 'busy');
  await h.c.advance(5_000);
  assert.equal(h.state().phase, 'error');
  assert.equal(h.state().failure.reason, 'model_missing');
  await h.c.advance(120_000);
  assert.equal(calls, 2, 'no retry without new text');
  h.add(final(1, 'Tweede zin.'));
  await h.c.advance(10_000);
  assert.equal(calls, 3);
  assert.equal(h.state().phase, 'listening');
});

test('stop: clocks freeze, the last check reads only the unassessed text, and is marked final', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: h.c.now() });
  h.planner.act({ action: 'start', itemId: 'p1' });
  h.add(final(0, 'Eerste zin.'));
  await h.c.advance(10_000);
  h.add(final(1, 'Laatste zin voor het stoppen.'));
  await h.c.advance(2_000);
  await h.planner.finish();
  assert.equal(h.analyzed.length, 2);
  assert.equal(h.analyzed[1].options.final, true);
  assert.ok(h.analyzed[1].request.segments.some((s) => s.text === 'Laatste zin voor het stoppen.'));
  const spent = h.state().items.p1.spentMs;
  await h.c.advance(60_000);
  assert.equal(h.state().items.p1.spentMs, spent, 'no time counts after stop');
  assert.equal(h.state().ended, true);
  assert.equal(h.planner.finalRunningFor('key:recording:1000000'), false);
  // Everything already assessed: stopping says nothing and asks nothing.
  const quiet = harness();
  quiet.planner.begin({ startedAtMs: 5 });
  quiet.add(final(0, 'Eén zin.'));
  await quiet.c.advance(10_000);
  await quiet.planner.finish();
  assert.equal(quiet.analyzed.length, 1);
});

test('the host keeps the state across remounts: getState is complete and seq only grows', async () => {
  const h = harness();
  h.planner.begin({ startedAtMs: h.c.now() });
  const first = h.state().seq;
  h.planner.act({ action: 'start', itemId: 'p1' });
  const second = h.state().seq;
  assert.ok(second > first);
  assert.deepEqual(Object.keys(h.state()).sort(), ['active', 'agenda', 'counters', 'currentItemId', 'ended', 'failure', 'findings', 'hostNow', 'items',
    'lastReason', 'lastRunAt', 'phase', 'planned', 'seq', 'sessionId', 'signals', 'stateVersion', 'suggestion'].sort());
});

// ---- Answer validation (literal quotes) -------------------------------------------------------------------------

test('quotes are literal and whole words of at least three characters; unknown ids and extra fields are refused', () => {
  const request = { sessionId: 'recording:1', revision: 'r1', currentItemId: null, items: [{ id: 'p1', title: 'Opening', outcome: 'discussie' }],
    segments: [{ id: 's1', text: 'We besluiten om Planbord te kiezen.', speaker: 'self', start: 0, end: 2 }] };
  validateAgendaRequest(request);
  const finding = (over) => ({ kind: 'besluit', itemId: 'p1', text: 'Planbord gekozen.', owner: null, due: null, segmentId: 's1', quote: 'Planbord te kiezen', ...over });
  assert.equal(validateAgendaResponse({ revision: 'r1', currentItem: null, findings: [finding({})] }, request).findings.length, 1);
  for (const bad of [
    finding({ quote: 'lanbord' }), finding({ quote: 'We' }), finding({ quote: 'Planbord kiezen' }), finding({ segmentId: 's2' }),
    finding({ itemId: 'p9' }), finding({ kind: 'mail' }), { ...finding({}), tool: 'send' }, finding({ text: '' }), finding({ text: 'x'.repeat(301) }),
  ]) assert.throws(() => validateAgendaResponse({ revision: 'r1', currentItem: null, findings: [bad] }, request), JSON.stringify(bad));
  assert.throws(() => validateAgendaResponse({ revision: 'r2', currentItem: null, findings: [] }, request));
  assert.throws(() => validateAgendaResponse({ revision: 'r1', currentItem: { itemId: 'p1', segmentId: 's1', quote: 'esluiten' }, findings: [] }, request));
  assert.throws(() => validateAgendaResponse({ revision: 'r1', currentItem: null, findings: Array.from({ length: 49 }, () => finding({})) }, request));
  const owner = validateAgendaResponse({ revision: 'r1', currentItem: null, findings: [finding({ owner: 'Bram', due: 'morgen' })] }, request).findings[0];
  assert.deepEqual([owner.owner, owner.due], [null, null], 'an owner or deadline not said in the text is dropped');
  assert.throws(() => validateAgendaRequest({ ...request, segments: [] }));
  assert.throws(() => validateAgendaRequest({ ...request, currentItemId: 'p7' }));
  assert.throws(() => validateAgendaRequest({ ...request, extra: true }));
});

// ---- Minutes ----------------------------------------------------------------------------------------------------

test('minutes per item with status, time, citations; human correction wins; rejected left out; markdown export', () => {
  const session = newSession('recording:1', agenda());
  const at = 1_000;
  session.recordingStartedAtMs = at;
  applyAction(session, { action: 'start', itemId: 'p2' }, at + 60_000);
  session.findings.push(
    { id: 'f00000000000a', kind: 'besluit', itemId: 'p2', text: 'We kiezen Planbord.', owner: null, due: null,
      evidence: { segmentId: 's1', quote: 'We kiezen Planbord', start: 75, end: 78, speaker: 'self' }, origin: 'ai' },
    { id: 'f00000000000b', kind: 'actie', itemId: 'p2', text: 'Ruben stuurt de offerte.', owner: 'Ruben', due: 'vrijdag',
      evidence: { segmentId: 's2', quote: 'Ruben stuurt de offerte', start: 90, end: 93, speaker: 'other' }, origin: 'ai' },
    { id: 'f00000000000c', kind: 'vraag', itemId: null, text: 'Wie | doet *de* notulen?', owner: null, due: null,
      evidence: { segmentId: 's3', quote: 'doet de notulen', start: 3700, end: 3702, speaker: 'unknown' }, origin: 'ai' },
    { id: 'f00000000000d', kind: 'actie', itemId: 'p2', text: 'Onterecht herkende actie.', owner: null, due: null,
      evidence: { segmentId: 's4', quote: 'onterecht', start: 99, end: 100, speaker: 'self' }, origin: 'ai' },
  );
  applyAction(session, { action: 'finish', itemId: 'p2' }, at + 60_000 + 12 * 60_000 + 30_000);
  const reviews = {
    f00000000000a: { status: 'gecorrigeerd', text: 'We kiezen Planbord als planningstool.', owner: 'Sanne', due: '1 april', at: 'x' },
    f00000000000d: { status: 'afgewezen', reason: 'Geen actie.', at: 'x' },
  };
  const minutes = buildMinutes(validateSession(session), reviews);
  const item = minutes.items[1];
  assert.equal(item.status, 'afgerond');
  assert.equal(item.spentSec, 750);
  assert.equal(item.overTime, true);
  assert.equal(item.missingOutcome, false);
  assert.deepEqual(item.decisions.map((d) => [d.text, d.owner, d.due, d.review, d.ai.text]), [['We kiezen Planbord als planningstool.', 'Sanne', '1 april', 'gecorrigeerd', 'We kiezen Planbord.']]);
  assert.deepEqual(item.actions.map((a) => a.review), ['voorstel', 'afgewezen']);
  assert.equal(minutes.other.questions.length, 1);
  assert.deepEqual(minutes.counts, { decisions: 1, actions: 1, questions: 1, proposals: 2, confirmed: 1 });
  const markdown = minutesMarkdown(minutes);
  assert.match(markdown, /^# Notulen Teamoverleg Zonnebloem\n/);
  assert.match(markdown, /## 2\. Keuze nieuwe planningstool \(Besluit, 10 min, eigenaar Sanne, vereist\)/);
  assert.match(markdown, /Status: Afgerond · besteed 12:30 van 10:00/);
  assert.match(markdown, /- \[gecorrigeerd\] We kiezen Planbord als planningstool\. · Eigenaar: Sanne · Termijn: 1 april\n {2}> "We kiezen Planbord" \(01:15, Jij\)/);
  assert.match(markdown, /- \[voorstel\] Ruben stuurt de offerte\. · Eigenaar: Ruben · Termijn: vrijdag\n {2}> "Ruben stuurt de offerte" \(01:30, Anderen\)/);
  assert.doesNotMatch(markdown, /Onterecht/);
  assert.match(markdown, /## Overig \(geen agendapunt\)[\s\S]*Wie \\\| doet \\\*de\\\* notulen\?[\s\S]*\(1:01:40, Onbekend\)/);
  assert.match(markdown, /## 4\. Rondvraag \(Discussie\)\n\nStatus: Niet behandeld · besteed 00:00/);
});

test('validateSession refuses foreign shapes and keeps stored sessions readable', () => {
  const session = newSession('recording:1', agenda());
  assert.deepEqual(validateSession(session), session);
  assert.throws(() => validateSession({ ...session, extra: 1 }));
  assert.throws(() => validateSession({ ...session, items: { ...session.items, p1: { ...session.items.p1, status: 'bezig' } } }));
  assert.throws(() => validateSession({ ...session, findings: [{ id: 'f1', kind: 'besluit', itemId: null, text: 'x', owner: null, due: null, origin: 'ai',
    evidence: { segmentId: 's', quote: 'ab', start: 0, end: 1, speaker: 'self' } }] }));
});
