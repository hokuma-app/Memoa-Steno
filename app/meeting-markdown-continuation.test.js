'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the real main-process parser without launching Electron.
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const start = source.indexOf('function parseMeetingMarkdown(');
const end = source.indexOf('\n/**', start);
assert.ok(start >= 0 && end > start);
const parse = vm.runInNewContext(`${source.slice(start, end)}; parseMeetingMarkdown`, {
  path, normalizeMarkdownForParsing: (text) => text,
});

test('main parser keeps continuation identities and all transcript parts', () => {
  const note = '---\ntitle: Sync\ncontinued_recordings: ["second", "third"]\n---\n'
    + '## Transcript\n\nFirst\n\n--- Resumed 12:00 ---\n\nSecond\n';
  const meeting = parse(note, '/synthetic/first_summary.md');
  assert.deepEqual(Array.from(meeting.continued_recordings), ['second', 'third']);
  assert.match(meeting.transcript, /First[\s\S]*Second/);
});

test('ordinary notes default to an empty continuation list', () => {
  const meeting = parse('---\ntitle: Sync\n---\n## Transcript\n\nFirst', '/synthetic/first_summary.md');
  assert.deepEqual(Array.from(meeting.continued_recordings), []);
});

for (const [raw, expected] of [['[BROKEN', '[BROKEN'], ['false', false], ['0', 0], ['""', ''], ['null', null]]) {
  test(`main parser preserves invalid explicit continuation metadata: ${raw}`, () => {
    const meeting = parse(`---\ntitle: Sync\ncontinued_recordings: ${raw}\n---\n## Transcript\n\nFirst`, '/synthetic/first_summary.md');
    assert.equal(meeting.continued_recordings, expected);
  });
}
