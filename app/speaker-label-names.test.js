'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveSpeakerLabelNames, readSpeakerLabelNames } = require('./speaker-label-names');

const manifest = (...rows) => rows.map(([start, original, channel = 'system', id = 'SPEAKER_0']) => ({
  start, channel, diarization_speaker_id: id, ...(original ? { original_label: original } : {}),
}));
const transcript = (...rows) => rows.map(([stamp, label, text]) => `[${stamp}] [${label}] ${text}`).join('\n\n');

test('a label that became a name maps to that name', () => {
  const sidecar = { transcript_lines: manifest([5, 'Speaker 2'], [10, 'Speaker 3'], [15, 'Speaker 2']) };
  const text = transcript(['00:05', 'Anna de Vries', 'hallo'], ['00:10', 'Speaker 3', 'goed'], ['00:15', 'Anna de Vries', 'ja']);
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, text), { 'Speaker 2': 'Anna de Vries' });
});

test('a withdrawn name (label restored) maps to nothing, so the label shows again', () => {
  const sidecar = { transcript_lines: manifest([5, 'Speaker 2']) };
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:05', 'Speaker 2', 'hallo'])), {});
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:05', 'Multiple speakers', 'hallo'])), {});
});

test('a renamed person shows the new name', () => {
  const sidecar = { transcript_lines: manifest([5, 'Speaker 2']) };
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:05', 'Anna Jansen', 'hallo'])), { 'Speaker 2': 'Anna Jansen' });
});

test('a manifest that does not describe this transcript names nobody', () => {
  const sidecar = { transcript_lines: manifest([5, 'Speaker 2'], [10, 'Speaker 3']) };
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:05', 'Anna', 'a'])), {}, 'different line count');
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:07', 'Anna', 'a'], ['00:10', 'Bob', 'b'])), {}, 'turn times disagree');
  assert.deepEqual(deriveSpeakerLabelNames({ transcript_lines: [null] }, transcript(['00:05', 'Anna', 'a'])), {});
  assert.deepEqual(deriveSpeakerLabelNames({}, transcript(['00:05', 'Anna', 'a'])), {});
  assert.deepEqual(deriveSpeakerLabelNames(null, ''), {});
});

test('one label that now carries two names is ambiguous and left alone', () => {
  const sidecar = { transcript_lines: manifest([5, 'Speaker 2'], [10, 'Speaker 2']) };
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:05', 'Anna', 'a'], ['00:10', 'Bob', 'b'])), {});
});

test('turns without a recorded original label (confirmed before 0.10.2 data existed) map to nothing', () => {
  const sidecar = { transcript_lines: manifest([5, null]) };
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, transcript(['00:05', 'Anna', 'a'])), {});
});

test('readSpeakerLabelNames reads the real sidecar file and fails soft', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'names-'));
  try {
    fs.writeFileSync(path.join(dir, 'm1_speakers.json'), JSON.stringify({ transcript_lines: manifest([5, 'Speaker 2']) }));
    const before = fs.readFileSync(path.join(dir, 'm1_speakers.json'), 'utf8');
    assert.deepEqual(await readSpeakerLabelNames(dir, 'm1', transcript(['00:05', 'Anna', 'a'])), { 'Speaker 2': 'Anna' });
    assert.equal(fs.readFileSync(path.join(dir, 'm1_speakers.json'), 'utf8'), before, 'read only');
    assert.deepEqual(await readSpeakerLabelNames(dir, 'missing', 'x'), {});
    fs.writeFileSync(path.join(dir, 'bad_speakers.json'), '{not json');
    assert.deepEqual(await readSpeakerLabelNames(dir, 'bad', 'x'), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a generic original label (You, Others) never becomes a name to substitute in running text', () => {
  const sidecar = { transcript_lines: manifest([5, 'You'], [10, 'Others'], [15, 'Speaker 2'], [20, 'SPEAKER_03'], [25, 'Jij']) };
  const text = transcript(['00:05', 'Martin', 'a'], ['00:10', 'Bob', 'b'], ['00:15', 'Anna', 'c'], ['00:20', 'Piet', 'd'], ['00:25', 'Jan', 'e']);
  assert.deepEqual(deriveSpeakerLabelNames(sidecar, text), { 'Speaker 2': 'Anna', SPEAKER_03: 'Piet' });
});
