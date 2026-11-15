'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseActionEntries, actionItemTexts } = require('./action-items');

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'action_item_cases.json'), 'utf8'));

for (const c of cases) {
  test(`shared action item case: ${c.name}`, () => {
    const { entries, dropped } = parseActionEntries(c.lines);
    const items = [];
    for (const e of entries) items.push(e.text, ...e.nested);
    assert.deepEqual(items, c.items);
    assert.equal(dropped, c.dropped || 0);
  });
}

test('the main-process note parser shows whole action items for a saved note', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf('function parseMeetingMarkdown(');
  const end = source.indexOf('\n/**', start);
  assert.ok(start >= 0 && end > start);
  const parse = vm.runInNewContext(`${source.slice(start, end)}; parseMeetingMarkdown`, {
    path, normalizeMarkdownForParsing: text => text, actionItemTexts,
  });
  const note = '---\ntitle: T\n---\n## Summary\nKort.\n\n## Action Items\n'
    + '- [ ] **Speaker 2** (due 2026-10-30)\n  Stuur de offerte\n'
    + '- [ ] Management (due 2026-10-30)\n  - Besluit over het budget\n'
    + '- [x] Anna: deel de slides\n\n## Transcript\nx\n';
  const meeting = parse(note, '/synthetic/a_summary.md');
  assert.deepEqual(Array.from(meeting.action_items), [
    'Speaker 2: Stuur de offerte (due 2026-10-30)',
    'Management: Besluit over het budget (due 2026-10-30)',
    'Anna: deel de slides',
  ]);
});
