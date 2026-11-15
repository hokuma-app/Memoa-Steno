'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { registerSummaryFoldingIpc } = require('./summary-folding-ipc');
// Synthetic token document in the shape the backend writes (whitespace tokens, one sentence per unit).
function buildDocument(request, provenance = 'ai') {
  const lines = full => full.split('\n').map(l => l.trim()).filter(l => l && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(l));
  const toks = text => text.split(/\s+/).filter(Boolean).map((t, i, all) => (i < all.length - 1 ? { t, s: 1 } : { t }));
  return { schemaVersion: 2, sourceHash: request.sourceHash, provenance, sections: request.sections.map(s => ({ ...s, lad: null, units: lines(s.full).map(src => {
    const item = /^([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(src); const heading = /^#{1,6}\s+(.*)$/.exec(src);
    const full = heading ? heading[1] : item ? item[2] : src; const t = toks(full);
    const unit = { kind: heading ? 'heading' : item ? 'item' : 'paragraph', src, full, toks: t };
    if (item) unit.marker = item[1];
    if (!heading) {
      const brief = t.map((tok, m) => ({ ...tok, m }));
      unit.sents = [[0, t.length]];
      unit.lad = { role: 'context', ev: [0], brief, tn: Math.min(3, brief.length), topic: [{ ...t[0], k: 0 }], model: provenance === 'local' ? 'local' : 'ai' };
    }
    return unit;
  }) })) };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'summary-fold-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userdata = path.join(root, 'userdata');
  const handlers = new Map(); let calls = 0; let cancels = 0;
  let meeting = { reports: [{ id: 'custom-1', content: '<think>Private synthetic reasoning</think>\nEigen rapportinhoud, niet de standaardsamenvatting.' }], summary: 'Klant wil levering in november. De planning is nog niet bevestigd.', discussion_areas: [{ title: 'Prijs', analysis: 'De prijs staat nog niet vast.' }] };
  let version = 'one';
  const result = (request, provenance = 'ai') => buildDocument(request, provenance);
  registerSummaryFoldingIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getUserDataDir: () => userdata,
    readMeeting: async (file) => { if (file !== 'allowed') throw Error('Access denied'); return { realPath: path.join(root, 'meeting.json'), meeting, fingerprint: version }; },
    evaluate: async (request, runOptions) => { calls++; return options.evaluate ? options.evaluate(request, result, runOptions) : result(request); },
    runPythonScript: async (_file, args) => JSON.stringify({ summary_detail: args[1] || 'detailed' }),
    isBusy: () => options.busy || false,
    evaluateLocal: options.local ? async request => (typeof options.local === 'function' ? options.local(buildDocument(request, 'local')) : buildDocument(request, 'local')) : undefined,
    cancelRun: () => { cancels++; },
  });
  return { userdata, call: (name, ...args) => handlers.get(name)(null, ...args), callWith: (event, name, ...args) => handlers.get(name)(event, ...args), calls: () => calls, cancelled: () => cancels, change: () => { version = 'two'; meeting = { ...meeting, summary: 'Een gewijzigde samenvatting.' }; } };
}
test('selected report levels use that version, keep a separate cache and never fall back to Standard', async t => {
  const f = fixture(t);
  const custom = await f.call('summary-fold-generate', 'allowed', 'custom-1');
  assert.equal(custom.success, true);
  assert.equal(custom.document.sections[0].full, 'Eigen rapportinhoud, niet de standaardsamenvatting.');
  const standard = await f.call('summary-fold-generate', 'allowed');
  assert.notEqual(standard.document.sourceHash, custom.document.sourceHash);
  assert.deepEqual(await f.call('summary-fold-load', 'allowed', 'custom-1'), custom);
  assert.equal((await f.call('summary-fold-generate', 'allowed', 'missing')).success, false);
  assert.equal(f.calls(), 2);
});
test('loading an unprepared summary creates no directories and calls no model', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.call('summary-fold-load', 'allowed'), { success: true, document: null });
  assert.equal(f.calls(), 0);
  assert.equal(fs.existsSync(f.userdata), false);
});
test('explicit preparation persists a private source-linked cache and repeated reads or preparation reuse it', async t => {
  const f = fixture(t);
  const generated = await f.call('summary-fold-generate', 'allowed');
  assert.equal(generated.success, true);
  assert.equal(generated.document.sections[0].full, 'Klant wil levering in november. De planning is nog niet bevestigd.');
  assert.deepEqual(await f.call('summary-fold-load', 'allowed'), generated);
  assert.deepEqual(await f.call('summary-fold-generate', 'allowed'), generated);
  assert.equal(f.calls(), 1);
  const directory = path.join(f.userdata, 'summary-folding');
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(directory, fs.readdirSync(directory)[0])).mode & 0o777, 0o600);
  f.change();
  assert.deepEqual(await f.call('summary-fold-load', 'allowed'), { success: true, document: null });
  assert.equal(f.calls(), 1);
});
test('a changed canonical source during inference cannot publish a stale cache', async t => {
  const f = fixture(t, { evaluate: async (request, result) => { f.change(); return result(request); } });
  assert.equal((await f.call('summary-fold-generate', 'allowed')).success, false);
  assert.equal(fs.existsSync(f.userdata), false);
});
test('forged source text and evidence cannot be stored', async t => {
  for (const corrupt of [d => { d.sections[0].full = 'invented'; },
    d => { d.sections[0].units[0].lad.ev = [999]; },
    d => { d.sections[0].units[0].lad.brief[0].m = 999; },
    d => { d.sections[0].units[0].toks[0].t = 'verzonnen'; d.sections[0].units[0].full = d.sections[0].units[0].toks.map(x => x.t).join(' '); },
    d => { d.sections[0].units[0].toks[0].a = '<img src=x onerror=1>'; },
    d => { d.sections[0].units[0].src = 'andere regel'; },
    d => { d.sections[0].units[0].sents = [[0, 1]]; },
    d => { d.sections[0].units[0].lad.topic[0].k = 50; },
    d => { d.provenance = 'local'; }]) {
    const f = fixture(t, { evaluate: async (request, result) => { const d = result(request); corrupt(d); return d; } });
    assert.equal((await f.call('summary-fold-generate', 'allowed')).success, false);
    assert.equal(fs.existsSync(f.userdata), false);
  }
});
test('unsafe paths and busy recording prevent inference', async t => {
  const f = fixture(t);
  assert.equal((await f.call('summary-fold-generate', '../outside')).success, false);
  assert.equal(f.calls(), 0);
  const busy = fixture(t, { busy: true });
  assert.equal((await busy.call('summary-fold-generate', 'allowed')).success, false);
  assert.equal(busy.calls(), 0);
});
test('only explicit valid future-summary detail changes reach the backend', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.call('get-summary-detail'), { success: true, summary_detail: 'detailed' });
  assert.deepEqual(await f.call('set-summary-detail', 'brief'), { success: true, summary_detail: 'brief' });
  assert.equal((await f.call('set-summary-detail', 'invented')).success, false);
  assert.equal(f.calls(), 0);
  assert.equal(fs.existsSync(f.userdata), false);
});
test('a second consumer cannot start overlapping model work', async t => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { evaluate: async (request, result) => { await barrier; return result(request); } });
  const first = f.call('summary-fold-generate', 'allowed');
  assert.equal((await f.call('summary-fold-generate', 'allowed')).success, false);
  release();
  assert.equal((await first).success, true);
  assert.equal(f.calls(), 1);
});
test('a symlinked cache namespace is rejected without model work or outside writes', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.userdata);
  fs.symlinkSync(path.dirname(f.userdata), path.join(f.userdata, 'summary-folding'), 'dir');
  assert.equal((await f.call('summary-fold-load', 'allowed')).success, false);
  assert.equal((await f.call('summary-fold-generate', 'allowed')).success, false);
  assert.equal(f.calls(), 0);
});
test('0.9.1: a failed preparation returns its content-free reason and progress goes only to the requesting window', async t => {
  const sent = [];
  const sender = { send: (...args) => sent.push(args), isDestroyed: () => false };
  const failing = fixture(t, { evaluate: async () => { throw Object.assign(new Error('PRIVATE model text'), { reason: 'invalid_structure' }); } });
  const failed = await failing.call('summary-fold-generate', 'allowed');
  assert.equal(failed.success, false);
  assert.equal(failed.reason, 'invalid_structure');
  assert.equal(JSON.stringify(failed).includes('PRIVATE'), false);
  const odd = fixture(t, { evaluate: async () => { throw Object.assign(new Error('x'), { reason: 'PRIVATE<b>' }); } });
  assert.equal((await odd.call('summary-fold-generate', 'allowed')).reason, 'failed');
  const progressing = fixture(t, { evaluate: async (request, result, options) => { options.onProgress({ done: 1, total: 2 }); return result(request); } });
  const ok = await progressing.callWith({ sender }, 'summary-fold-generate', 'allowed');
  assert.equal(ok.success, true);
  assert.deepEqual(sent, [['summary-fold-progress', { done: 1, total: 2 }]]);
});
test('0.9.1: the standard note folds its key points too', async t => {
  const { sourceSections } = require('./summary-folding-ipc');
  const sections = sourceSections({ summary: 'Overzicht.', discussion_areas: [{ title: 'Prijs', analysis: 'Prijs open.' }], key_points: ['Eerst testen.', '', 7, 'Budget blijft krap.'] });
  assert.deepEqual(sections.map(s => s.id), ['overview', 'discussion-0', 'key-points']);
  assert.deepEqual(sections[2], { id: 'key-points', title: 'Kernpunten', full: '- Eerst testen.\n- Budget blijft krap.' });
  assert.deepEqual(sourceSections({ summary: 'Alleen overzicht.' }).map(s => s.id), ['overview']);
});

test('0.9.2: local levels need no model, are validated, and are never cached', async t => {
  const f = fixture(t, { local: true });
  const local = await f.call('summary-fold-local', 'allowed');
  assert.equal(local.success, true);
  assert.equal(local.document.provenance, 'local');
  assert.equal(f.calls(), 0);
  assert.equal(fs.existsSync(f.userdata), false);
  const forged = fixture(t, { local: d => { d.provenance = 'ai'; return d; } });
  assert.equal((await forged.call('summary-fold-local', 'allowed')).success, false);
  assert.equal((await f.call('summary-fold-local', '../outside')).success, false);
});
test('0.9.2: an older cache is not a cache and cancel stops the run through the host', async t => {
  const f = fixture(t);
  await f.call('summary-fold-generate', 'allowed');
  const dir = path.join(f.userdata, 'summary-folding'); const file = path.join(dir, fs.readdirSync(dir)[0]);
  const record = JSON.parse(fs.readFileSync(file, 'utf8')); record.document.schemaVersion = 1; fs.writeFileSync(file, JSON.stringify(record));
  assert.deepEqual(await f.call('summary-fold-load', 'allowed'), { success: true, document: null });
  assert.deepEqual(await f.call('summary-fold-cancel'), { success: true });
  assert.equal(f.cancelled(), 1);
});
test('0.9.2: the model-free UI fixture documents pass the host validator, local and AI, and differ in their written levels', () => {
  const { buildDocument, requestOf } = require('./e2e-fold-fixture');
  const { validateDocument } = require('./summary-folding-ipc');
  const request = requestOf([
    { id: 'overview', title: 'Samenvatting', full: 'Het team kiest vrijdag als leverdatum. Bob bereidt de releasenotities voor.\n\nTweede alinea met **nadruk** erin. Nog een zin hier.' },
    { id: 'discussion-0', title: 'Prijs', full: 'Intro tekst voor dit onderwerp.\n### Kop\n- Een punt, apart.\n2. Tweede punt.' },
    { id: 'key-points', title: 'Kernpunten', full: '- Eerst testen.\n- Budget bewaken.' }]);
  const local = validateDocument(buildDocument(request, 'local'), request, 'local');
  const ai = validateDocument(buildDocument(request, 'ai'), request, 'ai');
  assert.notDeepEqual(local.sections[0].units[0].lad.brief, ai.sections[0].units[0].lad.brief);
  assert.equal(local.sections[0].lad, null);
  assert.ok(ai.sections[0].lad);
});
