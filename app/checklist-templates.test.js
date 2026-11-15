'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerVenetaProductIpc, createProductSettingsStore } = require('./veneta-product-ipc');
function setup(t, standardChecklistsDir) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'named-checklists-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createProductSettingsStore({ userDataDir: root, defaultProfile: 'veneta' });
  store.set({ modules: { 'conversation-checklist': true } });
  const handlers = new Map();
  const restart = () => registerVenetaProductIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, getUserDataDir: () => root, defaultProfile: 'veneta', ...(standardChecklistsDir ? { standardChecklistsDir } : {}) });
  restart();
  return { root, store, restart, call: async (key, data) => handlers.has(key) ? handlers.get(key)({}, data) : { success: false } };
}
const criteria = [{ id: 'one', label: 'Eigen synthetisch punt', required: true }];
test('named templates are explicit, isolated from conversation progress and reusable across restart', async t => {
  const { call, restart } = setup(t);
  const saved = await call('veneta-checklist-save-named-template', { name: 'Eigen leidraad', criteria });
  assert.equal(saved.success, true);
  const second = await call('veneta-checklist-save-named-template', { name: 'Andere leidraad', criteria: [{ ...criteria[0], label: 'Ander punt' }] });
  assert.equal(second.success, true);
  restart();
  const list = await call('veneta-checklist-list-templates');
  assert.equal(list.templates.length, 2);
  await call('veneta-checklist-prepare', { templateId: saved.template.id });
  assert.equal((await call('veneta-checklist-attach-prepared', 'session-a')).success, true);
  const draft = (await call('veneta-checklist-load-draft', 'session-a')).draft;
  assert.deepEqual(draft.criteria, criteria);
  const na = { one: { origin: 'human', status: 'notApplicable', reason: 'Synthetische reden.' } };
  await call('veneta-checklist-save-draft', { sessionId: 'session-a', criteria, manualOverrides: na });
  await call('veneta-checklist-attach-prepared', 'session-a');
  assert.deepEqual((await call('veneta-checklist-load-draft', 'session-a')).draft.manualOverrides, na);
  await call('veneta-checklist-save-named-template', { id: saved.template.id, name: 'Aangepast', criteria: [{ ...criteria[0], label: 'Nieuw punt' }] });
  assert.deepEqual((await call('veneta-checklist-load-draft', 'session-a')).draft.criteria, criteria);
  assert.equal((await call('veneta-checklist-load-draft', 'session-a')).draft.templateName, 'Eigen leidraad');
  await call('veneta-checklist-attach-prepared', 'session-b');
  assert.deepEqual((await call('veneta-checklist-load-draft', 'session-b')).draft.manualOverrides, {});
});
test('missing official contents never create a saved or usable empty template', async t => {
  const { call, root } = setup(t);
  const list = await call('veneta-checklist-list-templates');
  assert.equal(list.success, true);
  assert.deepEqual(list.templates, []);
  assert.equal((await call('veneta-checklist-save-named-template', { name: 'Adviseur Sales Checklist', criteria: [] })).success, false);
  assert.equal(fs.existsSync(path.join(root, 'veneta-modules', 'checklist-templates.json')), false);
});
test('template storage never accepts a collection its reader cannot reopen', async t => {
  const { call } = setup(t);
  for (let index = 0; index < 8; index++) {
    await call('veneta-checklist-save-named-template', { name: `Grote lijst ${index}`, criteria: [{ id: 'large', label: 'é'.repeat(24000), required: true }] });
    assert.equal((await call('veneta-checklist-list-templates')).success, true);
  }
});
test('disabled module does not read named templates or preparation', async t => {
  const { call, store, root } = setup(t);
  store.set({ modules: { 'conversation-checklist': false } });
  fs.writeFileSync(path.join(root, 'veneta-modules', 'checklist-templates.json'), '{corrupt');
  assert.equal((await call('veneta-checklist-list-templates')).success, false);
  assert.equal((await call('veneta-checklist-attach-prepared', 'session')).success, false);
});

// ---- 0.9.3: vaste Veneta-standaard naast eigen checklists ----
const standardDefinition = (overrides = {}) => ({ id: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', version: 1, locked: true,
  criteria: [{ id: 'syn-1', label: 'Synthetisch standaardpunt een', required: true }, { id: 'syn-2', label: 'Synthetisch standaardpunt twee', required: true }], ...overrides });
function standardsDir(t, definition = standardDefinition()) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'standard-checklists-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (definition) fs.writeFileSync(path.join(dir, 'adviseur-gesprek.json'), JSON.stringify(definition));
  return dir;
}
const loader = () => require('./veneta-standard-checklists');

test('the bundled Adviseur Gesprek definition is a locked, read-only mechanism without invented content', () => {
  const { standards, invalid } = loader().loadStandardChecklists(path.join(__dirname, 'veneta-standard-checklists'));
  assert.deepEqual(invalid, []);
  assert.equal(standards.length, 1);
  assert.equal(standards[0].name, 'Adviseur Gesprek');
  assert.equal(standards[0].locked, true);
  assert.deepEqual(standards[0].criteria, []);
  assert.equal(standards[0].available, false);
});

test('standard definitions are validated strictly with the same limits as criteria', t => {
  const bad = {
    unlocked: standardDefinition({ locked: false }), extra: standardDefinition({ extra: 1 }), tooMany: standardDefinition({ criteria: Array.from({ length: 33 }, (_, i) => ({ id: `p${i}`, label: 'x', required: true })) }),
    tooLong: standardDefinition({ criteria: [{ id: 'a', label: 'é'.repeat(24001), required: true }] }), duplicateId: standardDefinition({ criteria: [{ id: 'a', label: 'x', required: true }, { id: 'a', label: 'y', required: true }] }),
    badId: standardDefinition({ id: '../x' }), blankName: standardDefinition({ name: '  ' }), longName: standardDefinition({ name: 'n'.repeat(121) }), noVersion: standardDefinition({ version: 'een' }),
  };
  for (const [name, definition] of Object.entries(bad)) {
    const { standards, invalid } = loader().loadStandardChecklists(standardsDir(t, definition));
    assert.deepEqual(standards, [], name); assert.equal(invalid.length, 1, name);
  }
  const dir = standardsDir(t, null);
  fs.writeFileSync(path.join(dir, 'kapot.json'), '{broken');
  fs.writeFileSync(path.join(dir, 'groot.json'), ' '.repeat(262145));
  fs.symlinkSync(path.join(dir, 'kapot.json'), path.join(dir, 'link.json'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(standardDefinition()));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(standardDefinition({ id: 'andere-id' })));  // same name twice
  const found = loader().loadStandardChecklists(dir);
  assert.deepEqual(found.standards.map(s => s.id), ['veneta-adviseur-gesprek']);
  assert.equal(found.invalid.length, 4);
  assert.deepEqual(loader().loadStandardChecklists(path.join(dir, 'ontbreekt')), { standards: [], invalid: [] });
});

test('a standard without content is listed but cannot be prepared; with a test definition it can', async t => {
  const empty = setup(t, standardsDir(t, standardDefinition({ criteria: [] })));
  const list = await empty.call('veneta-checklist-list-templates');
  assert.deepEqual(list.standards, [{ id: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', version: 1, locked: true, criteriaCount: 0, available: false }]);
  assert.equal((await empty.call('veneta-checklist-prepare', { templateId: 'veneta-adviseur-gesprek' })).success, false);
  assert.equal(fs.existsSync(path.join(empty.root, 'veneta-modules', 'checklist-preparation.json')), false);
  const full = setup(t, standardsDir(t));
  assert.deepEqual((await full.call('veneta-checklist-list-templates')).standards.map(s => [s.criteriaCount, s.available]), [[2, true]]);
  assert.equal((await full.call('veneta-checklist-prepare', { templateId: 'veneta-adviseur-gesprek' })).success, true);
  const prepared = (await full.call('veneta-checklist-list-templates')).preparation;
  assert.deepEqual([prepared.templateId, prepared.name, prepared.locked, prepared.criteria.length], ['veneta-adviseur-gesprek', 'Adviseur Gesprek', true, 2]);
  assert.equal((await full.call('veneta-checklist-attach-prepared', 'sessie-1')).success, true);
  const draft = (await full.call('veneta-checklist-load-draft', 'sessie-1')).draft;
  assert.deepEqual([draft.templateId, draft.templateName, draft.criteria.map(c => c.label)], ['veneta-adviseur-gesprek', 'Adviseur Gesprek', ['Synthetisch standaardpunt een', 'Synthetisch standaardpunt twee']]);
});

test('the standard cannot be overwritten, duplicated by name, edited or deleted, also not through IPC', async t => {
  const dir = standardsDir(t);
  const before = fs.readFileSync(path.join(dir, 'adviseur-gesprek.json'));
  const { call, root } = setup(t, dir);
  const own = await call('veneta-checklist-save-named-template', { name: 'Eigen leidraad', criteria });
  for (const request of [
    { id: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', criteria }, { id: 'veneta-adviseur-gesprek', name: 'Iets anders', criteria },
    { name: 'Adviseur Gesprek', criteria }, { name: '  adviseur   GESPREK ', criteria }, { id: own.template.id, name: 'Adviseur Gesprek', criteria },
    { name: 'Eigen leidraad', criteria },
  ]) assert.equal((await call('veneta-checklist-save-named-template', request)).success, false, JSON.stringify(request));
  assert.equal((await call('veneta-checklist-delete-named-template', { id: 'veneta-adviseur-gesprek' })).success, false);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'adviseur-gesprek.json')), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'veneta-modules', 'checklist-templates.json'), 'utf8')).map(item => item.name), ['Eigen leidraad']);
  assert.equal((await call('veneta-checklist-save-named-template', { id: own.template.id, name: 'Eigen leidraad', criteria })).success, true, 'saving itself under its own name stays possible');
});

test('own checklists can be deleted; a prepared one is cleared and drafts keep their copy', async t => {
  const { call, root } = setup(t, standardsDir(t));
  const own = await call('veneta-checklist-save-named-template', { name: 'Eigen leidraad', criteria });
  await call('veneta-checklist-prepare', { templateId: own.template.id });
  await call('veneta-checklist-attach-prepared', 'sessie-a');
  assert.equal((await call('veneta-checklist-delete-named-template', { id: own.template.id })).success, true);
  const list = await call('veneta-checklist-list-templates');
  assert.deepEqual([list.templates, list.preparation], [[], null]);
  assert.deepEqual((await call('veneta-checklist-load-draft', 'sessie-a')).draft.criteria, criteria);
  assert.equal((await call('veneta-checklist-delete-named-template', { id: own.template.id })).success, false);
  assert.equal((await call('veneta-checklist-delete-named-template', { id: '../x' })).success, false);
  assert.ok(fs.existsSync(path.join(root, 'veneta-modules', 'drafts')));
});

test('Geen checklist clears the preparation, and no preparation means no checklist for the next conversation', async t => {
  const { call } = setup(t, standardsDir(t));
  await call('veneta-checklist-save-template', criteria);  // legacy 0.9.2 default must not silently become a checklist
  const own = await call('veneta-checklist-save-named-template', { name: 'Eigen leidraad', criteria });
  await call('veneta-checklist-prepare', { templateId: own.template.id });
  assert.equal((await call('veneta-checklist-clear-preparation')).success, true);
  assert.equal((await call('veneta-checklist-list-templates')).preparation, null);
  const attached = await call('veneta-checklist-attach-prepared', 'sessie-zonder');
  assert.deepEqual(attached.draft.criteria, []);
  assert.equal((await call('veneta-checklist-clear-preparation')).success, true);
});

test('a prepared standard follows the shipped definition, and an emptied one stops being prepared', async t => {
  const dir = standardsDir(t);
  const { call } = setup(t, dir);
  await call('veneta-checklist-prepare', { templateId: 'veneta-adviseur-gesprek' });
  fs.writeFileSync(path.join(dir, 'adviseur-gesprek.json'), JSON.stringify(standardDefinition({ version: 2, criteria: [{ id: 'nieuw', label: 'Nieuw punt', required: true }] })));
  assert.deepEqual((await call('veneta-checklist-list-templates')).preparation.criteria.map(c => c.label), ['Nieuw punt']);
  fs.writeFileSync(path.join(dir, 'adviseur-gesprek.json'), JSON.stringify(standardDefinition({ criteria: [] })));
  assert.equal((await call('veneta-checklist-list-templates')).preparation, null);
  assert.deepEqual((await call('veneta-checklist-attach-prepared', 'sessie-leeg')).draft.criteria, []);
});

test('the seller channel setting defaults to the microphone, is reversible and is not read while the module is off', async t => {
  const { call, root, store } = setup(t, standardsDir(t));
  assert.deepEqual(await call('veneta-checklist-get-settings'), { success: true, settings: { micIsSeller: true } });
  assert.equal(fs.existsSync(path.join(root, 'veneta-modules', 'checklist-settings.json')), false);
  assert.deepEqual((await call('veneta-checklist-set-settings', { micIsSeller: false })).settings, { micIsSeller: false });
  assert.deepEqual((await call('veneta-checklist-get-settings')).settings, { micIsSeller: false });
  for (const bad of [{ micIsSeller: 'ja' }, { micIsSeller: true, extra: 1 }, {}, null]) assert.equal((await call('veneta-checklist-set-settings', bad)).success, false);
  store.set({ modules: { 'conversation-checklist': false } });
  fs.writeFileSync(path.join(root, 'veneta-modules', 'checklist-settings.json'), '{corrupt');
  for (const channel of ['veneta-checklist-get-settings', 'veneta-checklist-clear-preparation']) assert.equal((await call(channel)).success, false);
  assert.equal((await call('veneta-checklist-set-settings', { micIsSeller: true })).success, false);
  assert.equal((await call('veneta-checklist-delete-named-template', { id: 'x' })).success, false);
});
