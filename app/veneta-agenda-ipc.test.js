'use strict';
// Host channels of the agenda chair with real files in a scratch user-data dir and a fake model boundary.
// Invented agendas and conversations only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductSettingsStore, registerVenetaProductIpc } = require('./veneta-product-ipc');
const { registerVenetaAgendaIpc } = require('./veneta-agenda-ipc');

const AGENDA = '# Werkoverleg Kastanje\n1. Opening (5 min)\n2. Nieuwe roosters vaststellen (besluit, 15 min) [vereist]\n3. Rondvraag';

function fixture(t, { enabled = true, profile = 'veneta', model } = {}) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-agenda-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => { if (handlers.has(name)) throw new Error(`dubbel kanaal ${name}`); handlers.set(name, fn); } };
  const product = registerVenetaProductIpc({ ipcMain, getUserDataDir: () => root, defaultProfile: profile,
    evaluateChecklist: async () => { throw new Error('not used'); } });
  const f = { root, handlers, finals: [], emitted: [], logs: [], modelCalls: [], product };
  f.agenda = registerVenetaAgendaIpc({
    ipcMain, getUserDataDir: () => root, store: product.store, modelSlot: product.modelSlot, onSettingsChanged: product.onSettingsChanged,
    analyzeAgenda: async (request) => { f.modelCalls.push(request); return model ? model(request) : { revision: request.revision, currentItem: null, findings: [] }; },
    getLiveFinals: () => f.finals, emitLiveState: (state) => f.emitted.push(state), logLive: (event, fields) => f.logs.push({ event, fields }),
    liveTimers: { finalGraceMs: 0 },
  });
  f.call = (name, data) => handlers.get(name)({}, data);
  if (enabled) createProductSettingsStore({ userDataDir: root, defaultProfile: profile }).set({ modules: { 'agenda-chair': true } });
  f.files = () => {
    const out = [];
    const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else out.push(path.relative(root, full)); } };
    if (fs.existsSync(root)) walk(root);
    return out.sort();
  };
  return f;
}
const final = (text, start, speaker = 'You') => ({ text, start, end: start + 2, isFinal: true, speaker });

test('module off (default): every channel refuses before touching disk, the planner does not start, no model call', async (t) => {
  const f = fixture(t, { enabled: false });
  for (const [name, data] of [['veneta-agenda-parse', { text: AGENDA }], ['veneta-agenda-get-preparation'], ['veneta-agenda-prepare', { agenda: {} }],
    ['veneta-agenda-clear-preparation'], ['veneta-agenda-live-state'], ['veneta-agenda-live-action', { action: 'start', itemId: 'p1' }],
    ['veneta-agenda-note-result', { noteFile: path.join(f.root, 'n.md') }], ['veneta-agenda-note-correct', { noteFile: path.join(f.root, 'n.md'), findingId: 'f1', action: 'confirm' }]]) {
    const answer = await f.call(name, data);
    assert.equal(answer.success, false, name);
    assert.equal(answer.code, 'module_disabled', name);
  }
  assert.equal(f.agenda.live.begin({ startedAtMs: 1 }), false);
  f.finals.push(final('We gaan naar punt twee.', 0));
  f.agenda.live.notify();
  assert.equal(f.agenda.bindSessionToNote({ noteFile: path.join(f.root, 'n.md'), recordingId: '1', appended: false }), false);
  assert.deepEqual(f.files(), []);
  assert.equal(f.modelCalls.length, 0);
  // The Default profile never enables it, even with the switch on.
  const other = fixture(t, { profile: 'default' });
  assert.equal((await other.call('veneta-agenda-parse', { text: AGENDA })).code, 'module_disabled');
});

test('before: parse (no model), edit, prepare as a new version, read back, clear', async (t) => {
  const f = fixture(t);
  const parsed = await f.call('veneta-agenda-parse', { text: AGENDA, sourceName: 'werkoverleg.md' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.agenda.source.kind, 'file');
  assert.equal(parsed.agenda.items.length, 3);
  assert.equal(f.modelCalls.length, 0);
  assert.equal((await f.call('veneta-agenda-parse', { text: AGENDA, sourceName: 'agenda.pdf' })).code, 'file_type');
  assert.equal((await f.call('veneta-agenda-parse', { text: '\n\n' })).code, 'empty');
  assert.equal((await f.call('veneta-agenda-get-preparation')).preparation, null);
  const prepared = await f.call('veneta-agenda-prepare', { agenda: parsed.agenda });
  assert.equal(prepared.preparation.version, 1);
  const edited = { ...parsed.agenda, items: parsed.agenda.items.map((item) => (item.id === 'p3' ? { ...item, owner: 'Noor', minutes: 10 } : item)) };
  assert.equal((await f.call('veneta-agenda-prepare', { agenda: edited })).preparation.version, 2);
  assert.equal((await f.call('veneta-agenda-get-preparation')).preparation.items[2].owner, 'Noor');
  const duplicate = { ...edited, items: [...edited.items, { ...edited.items[0], id: 'p9' }] };
  assert.equal((await f.call('veneta-agenda-prepare', { agenda: duplicate })).code, 'duplicate_items');
  assert.equal((await f.call('veneta-agenda-prepare', { agenda: { ...edited, items: [{ ...edited.items[0], outcome: 'stemming' }] } })).success, false);
  assert.equal((await f.call('veneta-agenda-clear-preparation')).success, true);
  assert.equal((await f.call('veneta-agenda-get-preparation')).preparation, null);
});

test('during and after: a meeting is planned in the host, bound to the note, minutes with human review and markdown', async (t) => {
  const f = fixture(t, { model: (request) => {
    const segment = request.segments.find((s) => s.text.includes('roosters'));
    const decision = request.segments.find((s) => s.text.includes('besluiten'));
    return { revision: request.revision,
      currentItem: segment ? { itemId: 'p2', segmentId: segment.id, quote: 'de nieuwe roosters' } : null,
      findings: decision ? [{ kind: 'besluit', itemId: 'p2', text: 'Het nieuwe rooster gaat in mei in.', owner: 'Noor', due: null, segmentId: decision.id, quote: 'We besluiten het rooster in mei' }] : [] };
  } });
  const parsed = await f.call('veneta-agenda-parse', { text: AGENDA });
  await f.call('veneta-agenda-prepare', { agenda: parsed.agenda });
  const startedAtMs = Date.now();
  assert.equal(f.agenda.live.begin({ startedAtMs }), true);
  f.finals.push(final('Dan nu de nieuwe roosters.', 1));
  f.finals.push(final('We besluiten het rooster in mei in te voeren, Noor pakt dat op.', 5, 'Others'));
  f.agenda.live.notify();
  // The last check at stop runs over the unassessed text (no waiting for timers in this test).
  const noteFile = path.join(f.root, 'notes', 'werkoverleg_summary.md');
  fs.mkdirSync(path.dirname(noteFile), { recursive: true });
  fs.writeFileSync(noteFile, '# Werkoverleg\n');
  const noteBefore = fs.readFileSync(noteFile, 'utf8');
  const live = await f.call('veneta-agenda-live-state');
  assert.equal(live.live.active, true);
  assert.equal((await f.call('veneta-agenda-live-action', { action: 'start', itemId: 'p2' })).live.currentItemId, 'p2');
  assert.equal((await f.call('veneta-agenda-live-action', { action: 'confirmSuggestion' })).code, 'stale');
  assert.equal(f.agenda.bindSessionToNote({ noteFile, recordingId: String(startedAtMs + 1), appended: false }), false, 'another recording never binds');
  assert.equal(f.agenda.bindSessionToNote({ noteFile, recordingId: String(startedAtMs), appended: false }), true);
  await f.agenda.live.finish();
  assert.equal(f.modelCalls.length, 1);
  const note = await f.call('veneta-agenda-note-result', { noteFile });
  assert.equal(note.success, true);
  assert.equal(note.found, true);
  assert.equal(note.finalRunning, false);
  const item = note.minutes.items[1];
  assert.equal(item.status, 'loopt');
  assert.equal(item.decisions.length, 1);
  assert.equal(item.decisions[0].owner, 'Noor');
  assert.equal(item.decisions[0].review, 'voorstel');
  assert.match(note.markdown, /\[voorstel\] Het nieuwe rooster gaat in mei in\./);
  const id = item.decisions[0].id;
  const corrected = await f.call('veneta-agenda-note-correct', { noteFile, findingId: id, action: 'correct', text: 'Nieuw rooster vanaf 1 mei.', due: '1 mei' });
  assert.equal(corrected.minutes.items[1].decisions[0].text, 'Nieuw rooster vanaf 1 mei.');
  assert.equal(corrected.minutes.items[1].decisions[0].review, 'gecorrigeerd');
  assert.match(corrected.markdown, /\[gecorrigeerd\] Nieuw rooster vanaf 1 mei\. · Eigenaar: Noor · Termijn: 1 mei/);
  const rejected = await f.call('veneta-agenda-note-correct', { noteFile, findingId: id, action: 'reject', reason: 'Nog geen besluit.' });
  assert.equal(rejected.minutes.items[1].decisions[0].review, 'afgewezen');
  assert.doesNotMatch(rejected.markdown, /rooster vanaf/);
  assert.equal((await f.call('veneta-agenda-note-correct', { noteFile, findingId: id, action: 'clear' })).minutes.items[1].decisions[0].review, 'voorstel');
  assert.equal((await f.call('veneta-agenda-note-correct', { noteFile, findingId: 'f999999999999', action: 'confirm' })).success, false);
  assert.equal((await f.call('veneta-agenda-note-correct', { noteFile, findingId: id, action: 'correct', text: '   ' })).success, false);
  assert.equal(fs.readFileSync(noteFile, 'utf8'), noteBefore, 'the canonical note is never changed');
  assert.deepEqual(f.files().filter((file) => !file.startsWith('notes/')).map((file) => file.replace(/[a-f0-9]{64}/, 'KEY')).sort(), [
    'veneta-modules/agenda-note-results/KEY.json', 'veneta-modules/agenda-preparation.json', 'veneta-modules/agenda-reviews/KEY.json',
    'veneta-modules/agenda-sessions/KEY.json', 'veneta-modules/product-settings.json',
  ]);
  assert.ok(f.logs.every((entry) => !/rooster|Noor|Kastanje/.test(JSON.stringify(entry))), 'diagnostics are content-free');
  assert.equal((await f.call('veneta-agenda-note-result', { noteFile: path.join(f.root, 'notes', 'ander_summary.md') })).found, false);
});

test('the one model slot is shared with the checklist: a busy slot is "busy", never a second parallel model call', async (t) => {
  let release;
  const f = fixture(t, { model: (request) => new Promise((resolve) => { release = () => resolve({ revision: request.revision, currentItem: null, findings: [] }); }) });
  await f.call('veneta-agenda-prepare', { agenda: (await f.call('veneta-agenda-parse', { text: AGENDA })).agenda });
  f.product.modelSlot.busy = true;
  f.agenda.live.begin({ startedAtMs: Date.now() });
  f.finals.push(final('Een zin.', 0));
  const finishing = f.agenda.live.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.modelCalls.length, 0, 'held back while the checklist holds the slot');
  f.product.modelSlot.busy = false;
  f.agenda.live.cancel();
  await finishing;
  void release;
});

test('switching the module off during a recording stops the planner at once (settings listener)', async (t) => {
  const f = fixture(t);
  await f.call('veneta-agenda-prepare', { agenda: (await f.call('veneta-agenda-parse', { text: AGENDA })).agenda });
  f.agenda.live.begin({ startedAtMs: Date.now() });
  assert.equal(f.agenda.live.getState().active, true);
  assert.equal((await f.call('set-product-settings', { modules: { 'agenda-chair': false } })).success, true);
  assert.equal(f.agenda.live.getState().active, false);
  assert.equal(f.emitted.at(-1).active, false);
});

test('a continued note resumes its own meeting: state and findings stay, nothing is re-read', async (t) => {
  const f = fixture(t, { model: (request) => ({ revision: request.revision, currentItem: null,
    findings: request.segments.filter((s) => s.text.endsWith('?')).map((s) => ({ kind: 'vraag', itemId: null, text: s.text, owner: null, due: null, segmentId: s.id, quote: s.text })) }) });
  await f.call('veneta-agenda-prepare', { agenda: (await f.call('veneta-agenda-parse', { text: AGENDA })).agenda });
  const noteFile = path.join(f.root, 'notes', 'kastanje_summary.md');
  f.agenda.live.begin({ appendTarget: noteFile, startedAtMs: 10 });
  f.agenda.live.act({ action: 'finish', itemId: 'p1' });
  f.finals.push(final('Wie maakt het verslag?', 0));
  await f.agenda.live.finish();
  assert.equal(f.agenda.bindSessionToNote({ noteFile, recordingId: '10', appended: true }), true);
  // A different agenda is prepared now; the continued note keeps its own.
  await f.call('veneta-agenda-prepare', { agenda: (await f.call('veneta-agenda-parse', { text: '1. Iets anders' })).agenda });
  f.agenda.live.begin({ appendTarget: noteFile, startedAtMs: 20 });
  const state = f.agenda.live.getState();
  assert.equal(state.items.p1.status, 'afgerond');
  assert.equal(state.agenda.items.length, 3);
  assert.equal(state.findings.length, 1);
  // The host buffer of a continued note: the prior segments of the note, then the new finals.
  f.finals = [final('Wie maakt het verslag?', 0), final('Is de zaal geboekt?', 4)];
  await f.agenda.live.finish();
  const note = await f.call('veneta-agenda-note-result', { noteFile });
  assert.deepEqual(note.minutes.other.questions.map((q) => q.text), ['Wie maakt het verslag?', 'Is de zaal geboekt?']);
});

test('stored files are validated: a corrupt or symlinked session fails closed without being overwritten', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'veneta-modules'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'veneta-modules', 'agenda-preparation.json'), '{kapot');
  assert.equal((await f.call('veneta-agenda-get-preparation')).success, false);
  assert.equal(f.agenda.live.begin({ startedAtMs: 1 }), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'veneta-modules', 'agenda-preparation.json'), 'utf8'), '{kapot');
  const outside = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-agenda-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(f.root, 'veneta-modules', 'agenda-sessions'));
  fs.writeFileSync(path.join(f.root, 'veneta-modules', 'agenda-preparation.json'), JSON.stringify({ schemaVersion: 1, agenda: (await f.call('veneta-agenda-parse', { text: AGENDA })).agenda }));
  f.agenda.live.begin({ startedAtMs: 1 });
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing is written through a symbolic link');
});
