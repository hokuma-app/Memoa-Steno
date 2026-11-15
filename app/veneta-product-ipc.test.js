'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductSettingsStore, registerVenetaProductIpc } = require('./veneta-product-ipc');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-product-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: createProductSettingsStore({ userDataDir: root, defaultProfile: 'veneta' }) };
}

test('new profile reads without creating files, persists settings and retains module preferences across profiles', (t) => {
  const { root, store } = fixture(t);
  assert.deepEqual(store.get(), { schemaVersion: 1, profile: 'veneta', modules: { 'conversation-checklist': false } });
  assert.deepEqual(fs.readdirSync(root), []);
  store.set({ modules: { 'conversation-checklist': true } });
  assert.equal(store.moduleEnabled('conversation-checklist'), true);
  store.set({ profile: 'default' });
  assert.equal(store.moduleEnabled('conversation-checklist'), false);
  const fresh = createProductSettingsStore({ userDataDir: root, defaultProfile: 'veneta' });
  assert.equal(fresh.get().modules['conversation-checklist'], true);
  fresh.set({ profile: 'veneta' });
  assert.equal(fresh.moduleEnabled('conversation-checklist'), true);
});

test('invalid settings and corrupt existing files fail closed without overwriting bytes', (t) => {
  const { root, store } = fixture(t);
  for (const patch of [{ profile: 'Veneta' }, { modules: { 'conversation-checklist': 'true' } }, { modules: { unknown: true } }, { unexpected: true }]) {
    assert.throws(() => store.set(patch));
  }
  assert.deepEqual(fs.readdirSync(root), []);
  store.set({ profile: 'veneta' });
  fs.writeFileSync(store.filePath, '{broken');
  assert.throws(() => store.get());
  assert.throws(() => store.set({ profile: 'default' }));
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), '{broken');
});

test('IPC rejects profile mutation while busy and never invokes disabled checklist work', async (t) => {
  const { root } = fixture(t);
  const handlers = new Map(); let calls = 0; let busy = true;
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    getUserDataDir: () => root, defaultProfile: 'veneta', isBusy: () => busy,
    evaluateChecklist: async (request) => { calls++; return { revision: request.revision, assessments: [] }; } });
  const call = (name, data) => handlers.get(name)({}, data);
  assert.equal((await call('set-product-settings', { profile: 'default' })).success, false);
  assert.equal((await call('veneta-checklist-evaluate', {})).success, false);
  assert.equal(calls, 0);
  busy = false;
  assert.equal((await call('set-product-settings', { modules: { 'conversation-checklist': true } })).success, true);
  assert.equal((await call('get-product-settings')).settings.modules['conversation-checklist'], true);
});

test('module directory links are rejected before reading or writing outside the owned namespace', (t) => {
  const { root, store } = fixture(t);
  const external = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(root, 'veneta-modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store.get());
  assert.throws(() => store.set({ profile: 'default' }));
  assert.deepEqual(fs.readdirSync(external), []);
});

test('evaluation requires seller evidence and persists only valid derived results outside original sources', async (t) => {
  const { root, store } = fixture(t);
  store.set({ modules: { 'conversation-checklist': true } });
  const original = path.join(root, 'canonical.txt'); fs.writeFileSync(original, 'existing transcript');
  const handlers = new Map(); let response;
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    getUserDataDir: () => root, defaultProfile: 'veneta', evaluateChecklist: async () => response });
  const request = { sessionId: '../source/meeting', revision: 'v1', mappingConfirmed: true,
    criteria: [{ id: 'usp', label: 'Gratis meten', required: true }],
    segments: [{ id: 's1', text: 'Wij komen gratis meten.', speaker: 'seller', start: 0, end: 2 }] };
  response = { revision: 'v1', assessments: [{ criterionId: 'usp', status: 'covered',
    evidence: [{ segmentId: 's1', quote: 'gratis meten' }], explanation: 'Uitgelegd.' }] };
  assert.equal((await handlers.get('veneta-checklist-evaluate')({}, request)).success, true);
  assert.equal(fs.readFileSync(original, 'utf8'), 'existing transcript');
  assert.equal(fs.readdirSync(path.join(root, 'veneta-modules', 'checklists')).length, 1);
  const saved = fs.readFileSync(path.join(root, 'veneta-modules', 'checklists', fs.readdirSync(path.join(root, 'veneta-modules', 'checklists'))[0]));
  response.assessments[0].evidence[0].quote = 'a made-up claim';
  assert.equal((await handlers.get('veneta-checklist-evaluate')({}, request)).success, false);
  assert.deepEqual(fs.readFileSync(path.join(root, 'veneta-modules', 'checklists', fs.readdirSync(path.join(root, 'veneta-modules', 'checklists'))[0])), saved);
});

test('explicit saves preserve per-session drafts and reusable criteria', async (t) => {
  const { root, store } = fixture(t);
  store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map();
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root, defaultProfile: 'veneta' });
  assert.equal(handlers.has('veneta-checklist-load-draft'), true);
  const call = (name, data) => handlers.get(name)({}, data);
  const criteria = [{ id: 'usp', label: 'Door gebruiker gekozen punt', required: true }];
  assert.equal((await call('veneta-checklist-save-template', criteria)).success, true);
  assert.deepEqual((await call('veneta-checklist-load-draft', 'new-meeting')).draft.criteria, criteria);
  const draft = { criteria, manualOverrides: { usp: { origin: 'human', status: 'notApplicable', reason: 'Synthetische reden.' } } };
  assert.equal((await call('veneta-checklist-save-draft', { sessionId: 'meeting-1', ...draft })).success, true);
  assert.deepEqual((await call('veneta-checklist-load-draft', 'meeting-1')).draft, draft);
  assert.deepEqual((await call('veneta-checklist-load-draft', 'meeting-2')).draft.manualOverrides, {});
  store.set({ profile: 'default' });
  assert.equal((await call('veneta-checklist-load-draft', 'meeting-1')).success, false);
});

test('turning the module off cancels owned analysis and discards its late result', async (t) => {
  const { root, store } = fixture(t); store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map(); let complete; let cancels = 0;
  const evaluate = () => new Promise((resolve) => { complete = resolve; });
  evaluate.cancelAll = () => { cancels++; complete({ revision: 'v1', assessments: [
    { criterionId: 'c', status: 'uncertain', evidence: [], explanation: 'Geen bevestigd bewijs.' },
  ] }); };
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root,
    defaultProfile: 'veneta', evaluateChecklist: evaluate });
  const pending = handlers.get('veneta-checklist-evaluate')({}, { sessionId: 's', revision: 'v1', mappingConfirmed: false,
    criteria: [{ id: 'c', label: 'Point', required: true }], segments: [{ id: 's', text: 'Hello', speaker: 'unknown', start: 0, end: 1 }] });
  await handlers.get('set-product-settings')({}, { modules: { 'conversation-checklist': false } });
  assert.equal(cancels, 1);
  assert.equal((await pending).success, false);
  assert.equal(fs.existsSync(path.join(root, 'veneta-modules', 'checklists')), false);
});

test('evaluation and draft transport use the same 128-character session identity bound', async (t) => {
  const { root, store } = fixture(t); store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map(); let calls = 0;
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root,
    defaultProfile: 'veneta', evaluateChecklist: async (request) => { calls++; return { revision: request.revision,
      assessments: [{ criterionId: 'c', status: 'uncertain', evidence: [], explanation: 'Geen bewijs.' }] }; } });
  const request = { sessionId: 's'.repeat(128), revision: 'v', mappingConfirmed: false,
    criteria: [{ id: 'c', label: 'Punt', required: true }], segments: [{ id: 'f', text: 'Tekst', speaker: 'unknown', start: 0, end: 1 }] };
  assert.equal((await handlers.get('veneta-checklist-evaluate')({}, request)).success, true);
  assert.equal((await handlers.get('veneta-checklist-evaluate')({}, { ...request, sessionId: 's'.repeat(129) })).success, false);
  assert.equal(calls, 1);
});

// ---- 0.9.2: reasons, levels, Niet van toepassing, overview ----
const crypto = require('node:crypto');
function ready(t, evaluateChecklist) {
  const { root, store } = fixture(t); store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map();
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root,
    defaultProfile: 'veneta', evaluateChecklist });
  return { root, call: (name, data) => handlers.get(name)({}, data) };
}
const dialogue = () => ({ sessionId: 'gesprek-1', revision: 'r1', mappingConfirmed: true,
  criteria: [{ id: 'c1', label: 'Prijs toegelicht', required: true }, { id: 'c2', label: 'Levertijd toegelicht', required: true },
    { id: 'c3', label: 'Garantie toegelicht', required: true }],
  segments: [{ id: 's1', text: 'De prijs is tien euro per maand.', speaker: 'seller', start: 3, end: 9 },
    { id: 's2', text: 'Dat is akkoord voor ons.', speaker: 'other', start: 65, end: 70 }] });
const answer = () => ({ revision: 'r1', assessments: [
  { criterionId: 'c1', status: 'covered', evidence: [{ segmentId: 's1', quote: 'tien euro per maand' }], explanation: 'Uitgelegd.',
    kind: 'explained', customerConfirmed: true, customerEvidence: [{ segmentId: 's2', quote: 'akkoord voor ons' }] },
  { criterionId: 'c2', status: 'partial', evidence: [{ segmentId: 's2', quote: 'Dat is akkoord' }], explanation: 'Alleen klant.',
    kind: 'mentioned', customerConfirmed: false, customerEvidence: [] },
  { criterionId: 'c3', status: 'unmentioned', evidence: [], explanation: 'Niet besproken.', kind: 'none', customerConfirmed: false, customerEvidence: [] }] });

test('a failed analysis hands the interface only a whitelisted content-free reason', async (t) => {
  let reason = 'model_missing';
  const { call } = ready(t, async () => { throw Object.assign(new Error('secret transcript'), { reason }); });
  let result = await call('veneta-checklist-evaluate', dialogue());
  assert.equal(result.success, false); assert.equal(result.reason, 'model_missing');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  reason = 'Ik ben een <script>'; result = await call('veneta-checklist-evaluate', dialogue());
  assert.equal(result.reason, 'failed');
  result = await call('veneta-checklist-evaluate', { nonsense: true });
  assert.equal(result.reason, 'invalid_request');
});

test('disabled module and busy analysis report their own reasons', async (t) => {
  const { root, store } = fixture(t);
  const handlers = new Map(); let release;
  registerVenetaProductIpc({ ipcMain: { handle: (n, f) => handlers.set(n, f) }, getUserDataDir: () => root, defaultProfile: 'veneta',
    evaluateChecklist: () => new Promise((resolve) => { release = () => resolve(answer()); }) });
  assert.equal((await handlers.get('veneta-checklist-evaluate')({}, dialogue())).reason, 'module_disabled');
  store.set({ modules: { 'conversation-checklist': true } });
  const first = handlers.get('veneta-checklist-evaluate')({}, dialogue());
  assert.equal((await handlers.get('veneta-checklist-evaluate')({}, dialogue())).reason, 'busy');
  release(); assert.equal((await first).success, true);
});

test('levels genoemd, uitgelegd and door klant bevestigd are validated against speakers', async (t) => {
  let response = answer();
  const { call } = ready(t, async () => JSON.parse(JSON.stringify(response)));
  const ok = await call('veneta-checklist-evaluate', dialogue());
  assert.equal(ok.success, true);
  assert.deepEqual(ok.assessments.map((a) => [a.kind, a.customerConfirmed]), [['explained', true], ['mentioned', false], ['none', false]]);
  const forged = [
    (r) => { r.assessments[0].customerEvidence = [{ segmentId: 's1', quote: 'tien euro' }]; },
    (r) => { r.assessments[0].customerEvidence = [{ segmentId: 's2', quote: 'niet gezegd' }]; },
    (r) => { r.assessments[1].kind = 'explained'; },
    (r) => { r.assessments[2].customerConfirmed = true; r.assessments[2].customerEvidence = []; },
    (r) => { r.assessments[0].kind = 'begrepen'; },
    (r) => { r.assessments[0].customerEvidence = Array(4).fill({ segmentId: 's2', quote: 'akkoord' }); },
  ];
  for (const [index, mutate] of forged.entries()) {
    response = answer(); mutate(response);
    const result = await call('veneta-checklist-evaluate', dialogue());
    assert.equal(result.success, false, `mutation ${index}`); assert.equal(result.reason, 'invalid_answer');
  }
  response = answer(); for (const a of response.assessments) { delete a.kind; delete a.customerConfirmed; delete a.customerEvidence; }
  const legacy = await call('veneta-checklist-evaluate', dialogue());
  assert.equal(legacy.success, true);
  assert.deepEqual(legacy.assessments.map((a) => [a.kind, a.customerConfirmed]), [['explained', false], ['mentioned', false], ['none', false]]);
});

test('Niet van toepassing is a human choice that needs a short reason', async (t) => {
  const { call } = ready(t, async () => answer());
  const criteria = dialogue().criteria;
  const save = (manualOverrides) => call('veneta-checklist-save-draft', { sessionId: 'gesprek-1', criteria, manualOverrides });
  const good = { c3: { origin: 'human', status: 'notApplicable', reason: 'Klant heeft al een lopend contract.' } };
  assert.equal((await save(good)).success, true);
  assert.deepEqual((await call('veneta-checklist-load-draft', 'gesprek-1')).draft.manualOverrides, good);
  for (const bad of [{ c3: { origin: 'human', status: 'notApplicable' } }, { c3: { origin: 'human', status: 'notApplicable', reason: '   ' } },
    { c3: { origin: 'human', status: 'notApplicable', reason: 'x'.repeat(201) } }, { c3: { origin: 'human', status: 'covered', reason: 'nee' } },
    { c3: { origin: 'human', status: 'notApplicable', reason: 5 } }, { c3: { origin: 'ai', status: 'notApplicable', reason: 'r' } }]) {
    assert.equal((await save(bad)).success, false, JSON.stringify(bad));
  }
  assert.deepEqual((await call('veneta-checklist-load-draft', 'gesprek-1')).draft.manualOverrides, good);
});

test('manual ticking is refused by the host: only Niet van toepassing or a rejection with a reason can be written', async (t) => {
  const { call } = ready(t, async () => answer());
  const criteria = dialogue().criteria;
  for (const status of ['covered', 'partial', 'unmentioned', 'uncertain']) {
    assert.equal((await call('veneta-checklist-save-draft', { sessionId: 'x', criteria, manualOverrides: { c1: { origin: 'human', status } } })).success, false, status);
  }
  assert.equal((await call('veneta-checklist-save-draft', { sessionId: 'x', criteria, manualOverrides: { c1: { origin: 'human', status: 'covered', rejected: true, reason: 'r' } } })).success, false);
  assert.equal((await call('veneta-checklist-save-draft', { sessionId: 'x', criteria, manualOverrides: { c1: { origin: 'human', status: 'unmentioned', rejected: true, reason: 'Onterecht.' } } })).success, true);
  assert.equal((await call('veneta-checklist-save-draft', { sessionId: 'x', criteria, manualOverrides: { c1: { origin: 'human', status: 'unmentioned', rejected: true } } })).success, false);
});

test('the AI never reports Niet van toepassing', async (t) => {
  const response = answer(); response.assessments[2].status = 'notApplicable';
  const { call } = ready(t, async () => response);
  assert.equal((await call('veneta-checklist-evaluate', dialogue())).success, false);
});

test('overview after the conversation carries source evidence, levels and human corrections, and exports a derived file', async (t) => {
  const { root, call } = ready(t, async () => answer());
  const canonical = path.join(root, 'canonical.txt'); fs.writeFileSync(canonical, 'canoniek');
  const criteria = dialogue().criteria;
  await call('veneta-checklist-evaluate', dialogue());
  // A 0.9.2 draft may still hold a manual tick on disk: it stays readable, but it is never counted.
  fs.mkdirSync(path.join(root, 'veneta-modules', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'veneta-modules', 'drafts', crypto.createHash('sha256').update('gesprek-1').digest('hex') + '.json'), JSON.stringify({ criteria, manualOverrides: {
    c3: { origin: 'human', status: 'notApplicable', reason: 'Valt buiten dit aanbod.' }, c2: { origin: 'human', status: 'covered' } } }));
  const { overview, markdown, ...rest } = await call('veneta-checklist-overview', { sessionId: 'gesprek-1' });
  assert.equal(rest.success, true);
  const [r1, r2, r3] = overview.rows;
  assert.deepEqual([r1.effective, r1.aiStatus, r1.kind, r1.customerConfirmed], ['covered', 'covered', 'explained', true]);
  assert.deepEqual(r1.evidence, [{ segmentId: 's1', quote: 'tien euro per maand', speaker: 'seller', start: 3, end: 9 }]);
  assert.deepEqual(r1.customerEvidence, [{ segmentId: 's2', quote: 'akkoord voor ons', speaker: 'other', start: 65, end: 70 }]);
  assert.deepEqual([r2.effective, r2.aiStatus, r2.correction, r2.ignoredManual], ['partial', 'partial', null, 'covered']);
  assert.deepEqual([r3.effective, r3.aiStatus, r3.correction], ['notApplicable', 'unmentioned', { status: 'notApplicable', reason: 'Valt buiten dit aanbod.' }]);
  assert.deepEqual(overview.counts, { covered: 1, partial: 1, unmentioned: 0, uncertain: 0, notApplicable: 1, pending: 0 });
  assert.deepEqual(overview.score, { covered: 1, total: 2 });
  assert.deepEqual(overview.rows.map((r) => r.level), ['explainedConfirmed', 'mentioned', null]);
  assert.equal(overview.revision, 'r1');
  assert.match(overview.checklistVersion, /^[a-f0-9]{12}$/);
  for (const needle of ['Prijs toegelicht', '00:03', 'verkoper', 'tien euro per maand', '01:05', 'klant', 'akkoord voor ons',
    'Niet van toepassing', 'Valt buiten dit aanbod.', 'Uitgelegd door verkoper', 'Door klant bevestigd: ja', 'Alleen genoemd', 'Handmatige markering genegeerd']) {
    assert.ok(markdown.includes(needle), needle);
  }
  assert.equal(markdown.includes('—') || markdown.includes('–'), false, 'no dashes in generated user text');
  const exported = await call('veneta-checklist-export-overview', { sessionId: 'gesprek-1' });
  assert.equal(exported.success, true);
  assert.equal(path.dirname(exported.path), path.join(root, 'veneta-modules', 'overviews'));
  assert.equal(fs.readFileSync(exported.path, 'utf8'), markdown);
  assert.equal(fs.readFileSync(canonical, 'utf8'), 'canoniek');
  const listed = await call('veneta-checklist-list-overviews');
  assert.equal(listed.success, true); assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].sessionKey, crypto.createHash('sha256').update('gesprek-1').digest('hex'));
  assert.equal((await call('veneta-checklist-overview', { sessionKey: listed.items[0].sessionKey })).success, true);
});

test('overview without AI result shows pending points and never invents a verdict', async (t) => {
  const { call } = ready(t, async () => answer());
  await call('veneta-checklist-save-draft', { sessionId: 'leeg', criteria: dialogue().criteria, manualOverrides: {} });
  const { overview } = await call('veneta-checklist-overview', { sessionId: 'leeg' });
  assert.equal(overview.revision, null);
  assert.deepEqual(overview.rows.map((r) => r.effective), ['pending', 'pending', 'pending']);
  assert.equal(overview.counts.pending, 3);
});

test('overview and export reject bad identities and a disabled module', async (t) => {
  const { root, store } = fixture(t);
  const handlers = new Map();
  registerVenetaProductIpc({ ipcMain: { handle: (n, f) => handlers.set(n, f) }, getUserDataDir: () => root, defaultProfile: 'veneta' });
  const call = (n, d) => handlers.get(n)({}, d);
  assert.equal((await call('veneta-checklist-overview', { sessionId: 'x' })).success, false);
  assert.equal((await call('veneta-checklist-list-overviews')).success, false);
  store.set({ modules: { 'conversation-checklist': true } });
  for (const bad of [{}, { sessionKey: '../etc/passwd' }, { sessionKey: 'A'.repeat(64) }, { sessionId: 'a', sessionKey: 'b'.repeat(64) }, null]) {
    assert.equal((await call('veneta-checklist-overview', bad)).success, false, JSON.stringify(bad));
    assert.equal((await call('veneta-checklist-export-overview', bad)).success, false);
  }
  assert.equal((await call('veneta-checklist-overview', { sessionId: 'bestaat-niet' })).success, false);
  assert.equal(fs.existsSync(path.join(root, 'veneta-modules', 'overviews')), false);
});

// ---- 0.9.3: resultaat bij de notitie, afwijzen, score ----
function noted(t, evaluate = async () => answer(), { standardChecklistsDir } = {}) {
  const { root, store } = fixture(t); store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map();
  const api = registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root,
    defaultProfile: 'veneta', evaluateChecklist: evaluate, ...(standardChecklistsDir ? { standardChecklistsDir } : {}) });
  const notes = path.join(root, 'notes'); fs.mkdirSync(notes);
  const noteFile = path.join(notes, 'opname_20260101_summary.md');
  fs.writeFileSync(noteFile, 'canonieke notitie');
  return { root, store, api, notes, noteFile, call: (name, data) => handlers.get(name)({}, data) };
}
async function finishedConversation(h, sessionId = 'recording:1700000000000') {
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  await h.call('veneta-checklist-attach-prepared', sessionId);
  await h.call('veneta-checklist-evaluate', { ...dialogue(), sessionId });
  return sessionId;
}

test('a note gets its checklist result through the recording that the host knows, and nothing canonical changes', async (t) => {
  const h = noted(t);
  const before = fs.readdirSync(h.notes);
  await finishedConversation(h);
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false }), true);
  assert.equal(fs.readFileSync(h.noteFile, 'utf8'), 'canonieke notitie');
  assert.deepEqual(fs.readdirSync(h.notes), before);
  const result = await h.call('veneta-checklist-note-result', { noteFile: h.noteFile });
  assert.equal(result.success, true); assert.equal(result.found, true);
  assert.equal(result.title, 'Eigen gesprek');
  assert.deepEqual(result.overview.score, { covered: 1, total: 3 });
  assert.deepEqual(result.overview.rows.map((r) => r.level), ['explainedConfirmed', 'mentioned', 'notHeard']);
  const scores = await h.call('veneta-checklist-note-scores', { noteFiles: [h.noteFile, path.join(h.notes, 'andere_summary.md')] });
  assert.deepEqual(scores.scores, { [h.noteFile]: { title: 'Eigen gesprek', covered: 1, total: 3 } });
  assert.equal((await h.call('veneta-checklist-note-result', { noteFile: path.join(h.notes, 'andere_summary.md') })).found, false);
});

test('binding never guesses: wrong recording, no checklist, a disabled module or an unrelated note give no link', async (t) => {
  const h = noted(t);
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1', appended: false }), false, 'nothing attached');
  await finishedConversation(h);
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '999', appended: false }), false, 'other recording');
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: true }), false, 'fresh recording is not an append');
  for (const bad of [{ noteFile: 'relatief.md', recordingId: '1700000000000', appended: false }, { noteFile: h.noteFile, recordingId: 5, appended: false }, null]) assert.equal(h.api.bindSessionToNote(bad), false);
  assert.equal(fs.existsSync(path.join(h.root, 'veneta-modules', 'note-results')), false);
  h.store.set({ modules: { 'conversation-checklist': false } });
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false }), false);
  assert.equal(fs.existsSync(path.join(h.root, 'veneta-modules', 'note-results')), false);
  assert.equal((await h.call('veneta-checklist-note-result', { noteFile: h.noteFile })).success, false);
});

test('a continued note binds to its own note session and a later fresh recording cannot reuse the stale attachment', async (t) => {
  const h = noted(t);
  await finishedConversation(h, noteSessionId(h.noteFile));
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1', appended: true }), true);
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1', appended: true }), false, 'the attachment is spent after one stop');
});

test('Onterecht afwijzen resets the point to not heard, marked as rejected by a human, traceable and reversible', async (t) => {
  const h = noted(t);
  await finishedConversation(h); h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false });
  const correct = (data) => h.call('veneta-checklist-note-correct', { noteFile: h.noteFile, ...data });
  assert.equal((await correct({ criterionId: 'c1', action: 'reject' })).success, false, 'reason is required');
  assert.equal((await correct({ criterionId: 'c3', action: 'reject', reason: 'Niet nodig.' })).success, false, 'only an AI tick can be rejected');
  assert.equal((await correct({ criterionId: 'nope', action: 'reject', reason: 'x' })).success, false);
  assert.equal((await correct({ criterionId: 'c1', action: 'tick', reason: 'x' })).success, false, 'no manual tick action exists');
  const done = await correct({ criterionId: 'c1', action: 'reject', reason: 'De verkoper zei dit niet over de prijs.' });
  assert.equal(done.success, true);
  const [r1] = done.overview.rows;
  assert.deepEqual([r1.effective, r1.aiStatus, r1.level, r1.rejected], ['unmentioned', 'covered', 'notHeard', { reason: 'De verkoper zei dit niet over de prijs.' }]);
  assert.deepEqual(done.overview.score, { covered: 0, total: 3 });
  assert.ok(done.markdown.includes('Afgewezen door mens') && done.markdown.includes('De verkoper zei dit niet over de prijs.'));
  assert.deepEqual(r1.evidence.map((e) => e.quote), ['tien euro per maand'], 'the AI evidence stays traceable');
  const draft = JSON.parse(fs.readFileSync(path.join(h.root, 'veneta-modules', 'drafts', crypto.createHash('sha256').update('recording:1700000000000').digest('hex') + '.json'), 'utf8'));
  assert.deepEqual(draft.manualOverrides.c1, { origin: 'human', status: 'unmentioned', rejected: true, reason: 'De verkoper zei dit niet over de prijs.' });
  const cleared = await correct({ criterionId: 'c1', action: 'clear' });
  assert.equal(cleared.overview.rows[0].effective, 'covered');
  assert.equal(fs.readFileSync(h.noteFile, 'utf8'), 'canonieke notitie');
});

test('Niet van toepassing stays a human choice with a reason, only through the note correction', async (t) => {
  const h = noted(t);
  await finishedConversation(h); h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false });
  const correct = (data) => h.call('veneta-checklist-note-correct', { noteFile: h.noteFile, ...data });
  assert.equal((await correct({ criterionId: 'c3', action: 'notApplicable' })).success, false);
  assert.equal((await correct({ criterionId: 'c3', action: 'notApplicable', reason: 'x'.repeat(201) })).success, false);
  const done = await correct({ criterionId: 'c3', action: 'notApplicable', reason: 'Klant heeft al een contract.' });
  assert.deepEqual([done.overview.rows[2].effective, done.overview.score], ['notApplicable', { covered: 1, total: 2 }]);
});

test('scores are bounded and never read while the module is off', async (t) => {
  const h = noted(t);
  assert.equal((await h.call('veneta-checklist-note-scores', { noteFiles: Array(201).fill(h.noteFile) })).success, false);
  assert.equal((await h.call('veneta-checklist-note-scores', { noteFiles: ['relatief'] })).success, false);
  assert.deepEqual((await h.call('veneta-checklist-note-scores', { noteFiles: [] })).scores, {});
  h.store.set({ modules: { 'conversation-checklist': false } });
  assert.equal((await h.call('veneta-checklist-note-scores', { noteFiles: [h.noteFile] })).success, false);
});

test('an unsure judgment that named a point with a quote shows as mentioned in the overview, never explained', () => {
  const { buildOverview } = require('./veneta-checklist-overview');
  const evaluation = (kind, evidence) => ({ savedAt: '2026-01-01T00:00:00Z',
    request: { segments: [{ id: 's', text: 'Hoe ziet uw gezinssituatie eruit?', speaker: 'seller', start: 0, end: 1 }] },
    response: { revision: 'r', assessments: [{ criterionId: 'c1', status: 'uncertain', evidence, explanation: 'x',
      kind, customerConfirmed: false, customerEvidence: [] }] } });
  const criteria = [{ id: 'c1', label: 'Vraag naar de gezinssituatie', required: true }];
  const quote = [{ segmentId: 's', quote: 'gezinssituatie' }];
  assert.equal(buildOverview({ criteria, manualOverrides: {}, evaluation: evaluation('mentioned', quote) }).rows[0].level, 'mentioned');
  assert.equal(buildOverview({ criteria, manualOverrides: {}, evaluation: evaluation('mentioned', []) }).rows[0].level, 'notHeard');
  assert.equal(buildOverview({ criteria, manualOverrides: {}, evaluation: evaluation('none', []) }).rows[0].level, 'notHeard');
});

test('model and citation text cannot inject lines into the exported markdown', () => {
  const { buildOverview, overviewMarkdown } = require('./veneta-checklist-overview');
  const overview = buildOverview({ criteria: [{ id: 'c1', label: 'Punt\n## Nep kopje', required: true }], manualOverrides: { c1: { origin: 'human', status: 'unmentioned', rejected: true, reason: 'Reden\r\n# Nog een kop' } },
    evaluation: { savedAt: '2026-01-01T00:00:00Z', request: { segments: [{ id: 's', text: 'a', speaker: 'seller', start: 0, end: 1 }] },
      response: { revision: 'r', assessments: [{ criterionId: 'c1', status: 'covered', evidence: [{ segmentId: 's', quote: 'zin\n## Kop uit citaat' }], explanation: 'Uitleg\n- vals punt',
        kind: 'explained', customerConfirmed: true, customerEvidence: [{ segmentId: 's', quote: 'klant\r\n# Kop' }] }] } } });
  const lines = overviewMarkdown(overview).split('\n');
  assert.deepEqual(lines.filter((line) => /^#/.test(line)), ['# Overzicht gesprekschecklist', lines.find((line) => /^## 1\./.test(line))]);
  assert.ok(lines.every((line) => !/^- vals punt|^# Nog een kop|^## Kop uit citaat/.test(line)));
  assert.equal(/[\r]/.test(overviewMarkdown(overview)), false);
});

test('the exported overview refuses a directory that turns into a link between the check and the write', async (t) => {
  const { root, store } = fixture(t); store.set({ modules: { 'conversation-checklist': true } });
  const external = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const handlers = new Map();
  registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root, defaultProfile: 'veneta', evaluateChecklist: async () => answer() });
  const call = (name, data) => handlers.get(name)({}, data);
  await call('veneta-checklist-save-draft', { sessionId: 'gesprek-1', criteria: dialogue().criteria, manualOverrides: {} });
  const realMkdir = fs.mkdirSync;
  fs.mkdirSync = (target, ...rest) => {
    if (String(target).endsWith(path.join('veneta-modules', 'overviews'))) return fs.symlinkSync(external, target, 'dir');
    return realMkdir(target, ...rest);
  };
  try { assert.equal((await call('veneta-checklist-export-overview', { sessionId: 'gesprek-1' })).success, false); }
  finally { fs.mkdirSync = realMkdir; }
  assert.deepEqual(fs.readdirSync(external), []);
});

test('a citation must be a whole word of at least three characters, also on the host boundary', async (t) => {
  let quote = 'tien euro per maand';
  const { call } = ready(t, async () => ({ revision: 'r1', assessments: [{ criterionId: 'c1', status: 'covered', evidence: [{ segmentId: 's1', quote }], explanation: 'Uitgelegd.' },
    { criterionId: 'c2', status: 'unmentioned', evidence: [], explanation: 'Nee.' }, { criterionId: 'c3', status: 'unmentioned', evidence: [], explanation: 'Nee.' }] }));
  assert.equal((await call('veneta-checklist-evaluate', dialogue())).success, true);
  for (quote of ['ri', 'rijs is', 'tie', 'euro per maan', 'is', ' a ']) assert.equal((await call('veneta-checklist-evaluate', dialogue())).success, false, JSON.stringify(quote));
  quote = 'De prijs is tien euro per maand.'; assert.equal((await call('veneta-checklist-evaluate', dialogue())).success, true);
});

// ---- 0.9.4: the live check is planned by the host, through the real guarded route and the real files ----
function liveHost(t, evaluate, extra = {}) {
  const { root, store } = fixture(t); store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map(); const logs = []; const emitted = []; const finals = [];
  let time = 5_000_000; let id = 0; const timers = new Map();
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const clock = {
    setTimeout: (fn, ms) => { id++; timers.set(id, { at: time + ms, fn }); return id; },
    clearTimeout: (handle) => { timers.delete(handle); },
    now: () => time,
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); time = Math.max(time, due[1].at); due[1].fn();
      }
      time = end; await settle();
    },
  };
  const api = registerVenetaProductIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => root,
    defaultProfile: 'veneta', evaluateChecklist: evaluate, getLiveFinals: () => finals, emitLiveState: (state) => emitted.push(state),
    logLive: (event, fields) => logs.push({ event, fields }), ...extra, liveTimers: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, finalGraceMs: 0 } });
  const notes = path.join(root, 'notes'); fs.mkdirSync(notes);
  const noteFile = path.join(notes, 'opname_20260101_summary.md'); fs.writeFileSync(noteFile, 'canonieke notitie');
  return { root, store, api, finals, logs, emitted, clock, noteFile, call: (name, data) => handlers.get(name)({}, data) };
}
const say = (h, index, text, speaker = 'You') => { h.finals.push({ text, start: index * 3, end: index * 3 + 2, isFinal: true, speaker }); h.api.live.notify(); };
const liveAnswer = (request) => ({ revision: request.revision, assessments: request.criteria.map((item, index) => {
  const seller = request.segments.find((segment) => segment.speaker === 'seller');
  return index === 0 && seller
    ? { criterionId: item.id, status: 'covered', evidence: [{ segmentId: seller.id, quote: seller.text }], explanation: 'Uitgelegd.', kind: 'explained', customerConfirmed: false, customerEvidence: [] }
    : { criterionId: item.id, status: 'unmentioned', evidence: [], explanation: 'Niet gezegd.', kind: 'none', customerConfirmed: false, customerEvidence: [] };
}) });

test('host planner end to end: prepared checklist, automatic checks without any renderer, last check at stop into the same note result', async (t) => {
  let calls = 0;
  const h = liveHost(t, async (request) => { calls++; return liveAnswer(request); });
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  assert.equal(h.api.live.begin({ startedAtMs: 1700000000000 }), true);
  const first = await h.call('veneta-checklist-live-state');
  assert.equal(first.success, true);
  assert.deepEqual([first.live.active, first.live.sessionId, first.live.phase, first.live.title], [true, 'recording:1700000000000', 'noText', 'Eigen gesprek']);
  // Continuous speech for ninety seconds; no renderer anywhere.
  for (let index = 0; index < 30; index++) { say(h, index, `Wij komen gratis meten bij u thuis, zin ${index}.`); await h.clock.advance(3000); }
  assert.ok(calls >= 3, `checks kept coming: ${calls}`);
  const during = (await h.call('veneta-checklist-live-state')).live;
  assert.deepEqual([during.counters.lines, during.counters.checks, during.phase], [30, calls, 'listening']);
  assert.ok(during.result.response.assessments.length === 3);
  assert.ok(h.emitted.length > 30, 'every change is pushed');
  // The session file the note tab reads is written by the host, validated like a manual check.
  const file = path.join(h.root, 'veneta-modules', 'checklists', crypto.createHash('sha256').update('recording:1700000000000').digest('hex') + '.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).request.sessionId, 'recording:1700000000000');
  // Stop: bind to the note, then one last check over what was not assessed.
  say(h, 31, 'Laatste woorden voor het stoppen.');
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false }), true);
  const before = calls;
  const finished = h.api.live.finish();
  const running = await h.call('veneta-checklist-note-result', { noteFile: h.noteFile });
  assert.equal(running.found, true); assert.equal(running.finalRunning, true);
  await h.clock.advance(0); await finished;
  assert.equal(calls, before + 1);
  const done = await h.call('veneta-checklist-note-result', { noteFile: h.noteFile });
  assert.equal(done.finalRunning, false);
  assert.deepEqual(done.overview.score, { covered: 1, total: 3 });
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).request.segments.some((segment) => segment.text === 'Laatste woorden voor het stoppen.'));
  assert.equal(fs.readFileSync(h.noteFile, 'utf8'), 'canonieke notitie');
});

test('host planner honours the module switch: off means no reads, no files, no model calls, and a state call is refused', async (t) => {
  let calls = 0;
  const h = liveHost(t, async (request) => { calls++; return liveAnswer(request); });
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  h.store.set({ modules: { 'conversation-checklist': false } });
  const entries = () => fs.readdirSync(path.join(h.root, 'veneta-modules')).sort();
  const before = entries();
  assert.equal(h.api.live.begin({ startedAtMs: 1 }), false);
  say(h, 0, 'Wij meten gratis.');
  await h.clock.advance(120_000);
  assert.equal(calls, 0);
  assert.deepEqual(entries(), before);
  assert.equal((await h.call('veneta-checklist-live-state')).success, false);
  assert.equal(h.logs.length, 0);
});

test('switching the module off during a recording stops the planner and discards a running check', async (t) => {
  let release; let calls = 0;
  const h = liveHost(t, (request) => { calls++; return new Promise((resolve) => { release = () => resolve(liveAnswer(request)); }); });
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  h.api.live.begin({ startedAtMs: 1 });
  say(h, 0, 'Wij meten gratis.');
  await h.clock.advance(10_000);
  assert.equal(calls, 1);
  assert.equal((await h.call('set-product-settings', { modules: { 'conversation-checklist': false } })).success, true);
  release(); await h.clock.advance(0);
  assert.equal(fs.existsSync(path.join(h.root, 'veneta-modules', 'checklists')), false, 'the late answer is discarded, nothing is written');
  say(h, 1, 'Nog een zin.');
  await h.clock.advance(120_000);
  assert.equal(calls, 1);
});

test('the host planner shares the one analysis slot with the manual route: a busy slot is retried, not failed', async (t) => {
  let release; let calls = 0;
  const h = liveHost(t, (request) => { calls++; return new Promise((resolve) => { release = () => resolve(liveAnswer(request)); }); });
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  h.api.live.begin({ startedAtMs: 1 });
  const manual = h.call('veneta-checklist-evaluate', { ...dialogue(), sessionId: 'handmatig' });
  await h.clock.advance(0);
  say(h, 0, 'Wij meten gratis.');
  await h.clock.advance(10_000);
  const busy = h.api.live.getState();
  assert.deepEqual([busy.counters.checks, busy.counters.failures, busy.failure], [0, 0, null]);
  release(); await manual;
  await h.clock.advance(5_000);
  assert.equal(h.api.live.getState().counters.checks, 1);
  assert.equal(calls, 2);
  release();
  await h.clock.advance(0);
  assert.equal(h.api.live.getState().phase, 'listening');
});

test('diagnostic logs of the host planner hold counters and codes only, never transcript, criteria or quotes', async (t) => {
  const h = liveHost(t, async (request) => liveAnswer(request));
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  h.api.live.begin({ startedAtMs: 1 });
  say(h, 0, 'Geheim klantnummer 12345 en de prijs.');
  await h.clock.advance(10_000);
  await h.api.live.finish();
  const text = JSON.stringify(h.logs);
  for (const secret of ['Geheim', '12345', 'prijs', ...dialogue().criteria.map((item) => item.label)]) assert.equal(text.includes(secret), false, secret);
  assert.ok(h.logs.length >= 4);
});

test('duplicate points: the host refuses to save them, shows old lists without them and prepares each point once', async (t) => {
  const h = liveHost(t, async (request) => liveAnswer(request));
  const refused = await h.call('veneta-checklist-save-named-template', { name: 'Dubbel', criteria: [
    { id: 'a', label: 'Punt 1', required: true }, { id: 'b', label: ' punt   1', required: true }, { id: 'c', label: 'Punt 2', required: true }] });
  assert.equal(refused.success, false); assert.equal(refused.code, 'duplicate_criteria');
  assert.equal(fs.existsSync(path.join(h.root, 'veneta-modules', 'checklist-templates.json')), false);
  // A list saved before 0.9.4 may already hold the same point three times.
  fs.mkdirSync(path.join(h.root, 'veneta-modules'), { recursive: true });
  fs.writeFileSync(path.join(h.root, 'veneta-modules', 'checklist-templates.json'), JSON.stringify([{ id: 'oud', name: 'Oud', criteria: [
    { id: 'a', label: 'punt 1', required: true }, { id: 'b', label: 'Punt 1', required: true }, { id: 'c', label: 'PUNT 1', required: true },
    { id: 'd', label: 'punt 2', required: true }, { id: 'e', label: 'punt 3', required: true }, { id: 'f', label: 'punt 4', required: true }] }]));
  const listed = await h.call('veneta-checklist-list-templates');
  assert.deepEqual(listed.templates[0].criteria.map((item) => item.label), ['punt 1', 'punt 2', 'punt 3', 'punt 4']);
  await h.call('veneta-checklist-prepare', { templateId: 'oud' });
  assert.equal(h.api.live.begin({ startedAtMs: 7 }), true);
  assert.deepEqual(h.api.live.getState().criteria.map((item) => item.label), ['punt 1', 'punt 2', 'punt 3', 'punt 4']);
  const attached = JSON.parse(fs.readFileSync(path.join(h.root, 'veneta-modules', 'drafts', crypto.createHash('sha256').update('recording:7').digest('hex') + '.json'), 'utf8'));
  assert.equal(attached.criteria.length, 4);
});

// ---- 0.9.4 review round 2 ----
const { noteSessionId } = require('./veneta-live-checklist');
const draftPath = (root, sessionId) => path.join(root, 'veneta-modules', 'drafts', crypto.createHash('sha256').update(sessionId).digest('hex') + '.json');

test('an appended recording binds only to the exact session of its own note, never to any other note session', async (t) => {
  const h = noted(t);
  const other = path.join(h.notes, 'andere_summary.md'); fs.writeFileSync(other, 'x');
  await finishedConversation(h, noteSessionId(other));
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1', appended: true }), false, 'a session of another note is not this note');
  assert.equal(fs.existsSync(path.join(h.root, 'veneta-modules', 'note-results')), false);
  assert.equal(h.api.bindSessionToNote({ noteFile: other, recordingId: '1', appended: true }), true);
});

test('binding follows the planner\'s own session, also when a later mount attached another session meanwhile', async (t) => {
  const h = liveHost(t, async (request) => liveAnswer(request));
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  assert.equal(h.api.live.begin({ startedAtMs: 1700000000000 }), true);
  await h.call('veneta-checklist-attach-prepared', 'recording:42'); // a renderer mount moves the shared attachment
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false }), true);
  const link = JSON.parse(fs.readFileSync(path.join(h.root, 'veneta-modules', 'note-results', fs.readdirSync(path.join(h.root, 'veneta-modules', 'note-results'))[0]), 'utf8'));
  assert.equal(link.sessionKey, crypto.createHash('sha256').update('recording:1700000000000').digest('hex'));
});

test('overview, note tab and score use the same de-duplicated points as the planner, and stored data stays untouched', async (t) => {
  const h = noted(t);
  await finishedConversation(h);
  const file = draftPath(h.root, 'recording:1700000000000');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.criteria.push({ id: 'dubbel', label: `  ${stored.criteria[0].label.toUpperCase()} `, required: true });
  fs.writeFileSync(file, JSON.stringify(stored));
  const bytes = fs.readFileSync(file, 'utf8');
  assert.equal(h.api.bindSessionToNote({ noteFile: h.noteFile, recordingId: '1700000000000', appended: false }), true);
  const note = await h.call('veneta-checklist-note-result', { noteFile: h.noteFile });
  assert.deepEqual([note.overview.rows.length, note.overview.score], [3, { covered: 1, total: 3 }]);
  assert.equal(note.overview.counts.pending, 0);
  assert.ok(!note.markdown.includes('dubbel'));
  const scores = await h.call('veneta-checklist-note-scores', { noteFiles: [h.noteFile] });
  assert.deepEqual(scores.scores[h.noteFile].total, 3);
  const direct = await h.call('veneta-checklist-overview', { sessionId: 'recording:1700000000000' });
  assert.equal(direct.overview.rows.length, 3);
  assert.equal((await h.call('veneta-checklist-note-correct', { noteFile: h.noteFile, criterionId: 'dubbel', action: 'notApplicable', reason: 'x' })).success, false, 'the dropped duplicate cannot be corrected');
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'nothing stored was changed');
});

test('the last check treats a summary or reprocess on the model as busy, retries a bounded number of times, and live checks are not held back', async (t) => {
  let summaryRunning = true; let calls = 0;
  const h = liveHost(t, async (request) => { calls++; return liveAnswer(request); }, { isOllamaBusy: () => summaryRunning });
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  h.api.live.begin({ startedAtMs: 1 });
  say(h, 0, 'Wij meten gratis.');
  await h.clock.advance(10_000);
  assert.equal(calls, 1, 'a check during the recording does not wait for a summary');
  say(h, 1, 'Laatste woorden.');
  const done = h.api.live.finish();
  let finished = false; void done.then(() => { finished = true; });
  await h.clock.advance(20_000);
  assert.equal(calls, 1, 'the model is not touched while a summary holds it');
  assert.equal(finished, false);
  summaryRunning = false;
  await h.clock.advance(5_000); await done;
  assert.equal(calls, 2);
  assert.equal(h.api.live.getState().failure, null);
});

test('a summary that never ends makes the last check fail honestly as busy after the bound', async (t) => {
  let calls = 0;
  const h = liveHost(t, async (request) => { calls++; return liveAnswer(request); }, { isOllamaBusy: () => true });
  const own = await h.call('veneta-checklist-save-named-template', { name: 'Eigen gesprek', criteria: dialogue().criteria });
  await h.call('veneta-checklist-prepare', { templateId: own.template.id });
  h.api.live.begin({ startedAtMs: 1 });
  say(h, 0, 'Wij meten gratis.');
  const done = h.api.live.finish();
  await h.clock.advance(5_000 * 30); await done;
  assert.equal(calls, 0);
  assert.equal(h.api.live.getState().failure.reason, 'busy');
});
