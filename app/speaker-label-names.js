'use strict';
// Which speaker label became which name, read from what the app already stores (nothing new is written):
//  - the speakers sidecar ({stem}_speakers.json) keeps, per transcript turn, the label the line carried BEFORE a
//    confirmation (`original_label`, src/speaker_suggestions.record_original_labels) and the turn's start;
//  - the transcript lines carry the label they carry NOW (the confirmed name, or the original label again after a
//    withdrawal).
// Pairing is by position and only while the turn times agree (as src/speaker_suggestions._manifest_describes_lines),
// so a manifest of another transcription never names anyone. The result {"Speaker 2": "Anna"} is used at display and
// copy time only; a saved summary file is never rewritten.

const fs = require('fs');
const path = require('path');

const LINE = /^\[(\d+(?::\d{2}){1,2})\] \[([^\]]*)\] ?/;
const GENERIC = /^(?:you|others|together|multiple speakers|(?:speaker|spreker)s?[ _]?\d+)$/i;
// Only numbered labels are mapped: "You" or "Others" are ordinary words in a summary ("Do you agree?").
const NUMBERED_LABEL = /^(?:speaker|spreker)[ _]?\d+$/i;
const SIDECAR_LIMIT = 8 * 1024 * 1024;

function seconds(stamp) {
  const parts = stamp.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return null;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function deriveSpeakerLabelNames(sidecar, transcriptText) {
  const manifest = sidecar && Array.isArray(sidecar.transcript_lines) ? sidecar.transcript_lines : null;
  if (!manifest || !manifest.length || typeof transcriptText !== 'string') return {};
  const lines = transcriptText.split('\n').map(line => LINE.exec(line)).filter(Boolean);
  if (lines.length !== manifest.length) return {};
  let previous = null;
  for (let i = 0; i < lines.length; i += 1) {
    const entry = manifest[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {};
    const start = entry.start;
    if (typeof start === 'number' && Number.isFinite(start)) {
      if (previous !== null && start < previous) return {};
      previous = start;
      const stamp = seconds(lines[i][1]);
      if (stamp !== null && stamp !== Math.max(0, Math.trunc(start))) return {};
    }
  }
  const names = {};
  const ambiguous = new Set();
  lines.forEach((match, i) => {
    const original = manifest[i].original_label;
    const current = match[2];
    if (typeof original !== 'string' || !NUMBERED_LABEL.test(original.trim()) || original === current || GENERIC.test(current.trim())) return;
    if (names[original] !== undefined && names[original] !== current) ambiguous.add(original);
    names[original] = current;
  });
  for (const label of ambiguous) delete names[label];
  return names;
}

// Reads the sidecar next to a note and derives the map; any problem means "no names", never an error.
async function readSpeakerLabelNames(outputDir, meetingStem, transcriptText) {
  try {
    const file = path.join(outputDir, `${meetingStem}_speakers.json`);
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.size > SIDECAR_LIMIT) return {};
    return deriveSpeakerLabelNames(JSON.parse(await fs.promises.readFile(file, 'utf8')), transcriptText);
  } catch {
    return {};
  }
}

module.exports = { deriveSpeakerLabelNames, readSpeakerLabelNames };
