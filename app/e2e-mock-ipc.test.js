'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checklistModel } = require('./e2e-mock-ipc');

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