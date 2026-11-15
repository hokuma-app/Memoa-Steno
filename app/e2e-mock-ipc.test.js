'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checklistModel, agendaModel, e2eMainText } = require('./e2e-mock-ipc');
const { EN, NL } = require('./main-copy');

const segments = [
  { id: 'measure', text: 'Wij komen gratis meten bij u thuis.', speaker: 'seller', start: 10, end: 13 },
  { id: 'warranty', text: 'Garantie.', speaker: 'seller', start: 14, end: 15 },
  { id: 'customer', text: 'Dat is akkoord voor ons.', speaker: 'other', start: 16, end: 18 },
];
const request = (criteria) => ({ revision: 'r1', criteria, segments });
const criterion = (id, label) => ({ id, label, required: true });

test('checklist mock judges synthetic criterion and transcript content, not list position', async () => {
  global.__checklistModelCalls = 0;
  const first = await checklistModel(request([
    criterion('warranty', 'Noem de garantie'),
    criterion('measure', 'Leg gratis inmeten uit'),
    criterion('followup', 'Maak een concrete vervolgafspraak'),
  ]));
  const second = await checklistModel(request([
    criterion('followup', 'Maak een concrete vervolgafspraak'),
    criterion('measure', 'Leg gratis inmeten uit'),
    criterion('discount', 'Leg een korting uit'),
  ]));
  const statuses = (result) => Object.fromEntries(result.assessments.map((item) => [item.criterionId, item.status]));
  assert.deepEqual(statuses(first), { warranty: 'partial', measure: 'covered', followup: 'unmentioned' });
  assert.deepEqual(statuses(second), { followup: 'unmentioned', measure: 'covered', discount: 'unmentioned' });
});
test('update error seed: main-process copy in the language of the renderer build under test', (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'e2e-main-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, 'renderer', 'dist', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const saved = process.env.E2E_RENDERER_BUILD;
  delete process.env.E2E_RENDERER_BUILD;
  t.after(() => { if (saved === undefined) delete process.env.E2E_RENDERER_BUILD; else process.env.E2E_RENDERER_BUILD = saved; });
  fs.writeFileSync(path.join(assets, 'index.js'), 'console.log(1)');
  assert.equal(e2eMainText({ packageMetadata: {}, appDir: root })('update.networkCheck'), EN['update.networkCheck']);
  fs.writeFileSync(path.join(assets, 'index.js'), 'document.documentElement.dataset.product="veneta-memoai",document.title="Veneta MemoAi"');
  assert.equal(e2eMainText({ packageMetadata: {}, appDir: root })('update.networkCheck'), NL['update.networkCheck']);
  assert.equal(e2eMainText({ packageMetadata: { venetaMemoAi: true }, appDir: path.join(root, 'none') })('update.networkCheck'), NL['update.networkCheck'], 'a Veneta package');
  assert.notEqual(EN['update.networkCheck'], NL['update.networkCheck']);
});

test('agenda mock: the question check answers a question with a later segment that shares its words', async () => {
  const result = await agendaModel({ revision: 'q1', mode: 'questions',
    questions: [{ id: 'f00000000000a', text: 'Wie boekt de zaal voor de volgende keer?', start: 5 }, { id: 'f00000000000b', text: 'Wie maakt de notulen?', start: 6 }],
    segments: [{ id: 's1', text: 'Wie boekt de zaal voor de volgende keer?', speaker: 'other', start: 5, end: 6 },
      { id: 's2', text: 'Sanne boekt de zaal voor de volgende keer.', speaker: 'self', start: 9, end: 11 }] });
  assert.deepEqual(result, { revision: 'q1', answered: [{ questionId: 'f00000000000a', segmentId: 's2', quote: 'Sanne boekt de zaal voor de volgende keer.' }] });
});
