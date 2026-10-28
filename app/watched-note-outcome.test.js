'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Lazy require lets a missing implementation fail as an assertion during RED.
function outcome(file) {
  let read;
  try { read = require('./watched-note-outcome').readWatchedNoteOutcome; } catch { /* RED */ }
  assert.equal(typeof read, 'function', 'outcome reader must be implemented');
  return read(file);
}

for (const [name, contents, expected] of [
  ['failed Markdown', '---\ntranscription_failed: true\n---\nFailure', 'failed'],
  ['quoted failure', '---\ntranscription_failed: "true"\n---\nFailure', 'failed'],
  ['cancelled Markdown', '---\nstatus: cancelled\n---\nStopped', 'cancelled'],
  ['error status', '---\nstatus: error\n---\nError', 'failed'],
  ['processing placeholder', '---\nprocessing: true\n---\nPending', 'processing'],
  ['normal Markdown', '---\ntranscription_failed: false\n---\n## Summary\nNotes', 'done'],
  ['legacy Markdown', '## Summary\nNotes', 'done'],
  ['empty Markdown', '', 'failed'],
]) {
  test(name, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watched-outcome-'));
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, contents);
    assert.equal(outcome(file), expected);
  });
}

test('JSON fallback reads session_info failure and cancellation; malformed JSON fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watched-outcome-'));
  const file = path.join(dir, 'note.md');
  const json = path.join(dir, 'note.json');
  assert.equal(outcome(file), 'missing');
  for (const [data, expected] of [
    [{ session_info: { transcription_failed: true } }, 'failed'],
    [{ session_info: { status: 'canceled' } }, 'cancelled'],
    [{ session_info: { name: 'Meeting' }, summary: 'Notes' }, 'done'],
    [null, 'failed'],
  ]) {
    fs.writeFileSync(json, JSON.stringify(data));
    assert.equal(outcome(file), expected);
  }
  fs.writeFileSync(json, '{');
  assert.equal(outcome(file), 'failed');
  fs.writeFileSync(file, '---\ntranscription_failed: true\n---\nFailure');
  fs.writeFileSync(json, JSON.stringify({ summary: 'Stale success' }));
  assert.equal(outcome(file), 'failed', 'canonical Markdown wins over stale JSON');
  assert.equal(outcome(undefined), 'missing');
});
