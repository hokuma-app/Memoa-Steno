'use strict';
const fs = require('fs');

// Read only the backend's flat outcome scalars, not arbitrary YAML. Markdown
// is canonical; consult legacy JSON only when Markdown is absent.
function readWatchedNoteOutcome(summaryFile) {
  if (!summaryFile) return 'missing';
  let raw;
  let json = summaryFile.endsWith('.json');
  try {
    raw = fs.readFileSync(summaryFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') return 'failed';
    if (!summaryFile.endsWith('.md')) return 'missing';
    try {
      raw = fs.readFileSync(summaryFile.replace(/\.md$/, '.json'), 'utf8');
      json = true;
    } catch (fallbackError) {
      return fallbackError.code === 'ENOENT' ? 'missing' : 'failed';
    }
  }
  if (!raw.trim()) return 'failed';
  let metadata = {};
  if (json) {
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return 'failed';
      metadata = { ...data, ...data.session_info };
    } catch { return 'failed'; }
  } else if (/^---\r?\n/.test(raw)) {
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) return 'failed';
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const field = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
      if (field) metadata[field[1]] = field[2].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const yes = (value) => value === true || value === 'true';
  const status = String(metadata.status || '').toLowerCase();
  if (yes(metadata.transcription_failed) || ['failed', 'error'].includes(status)) return 'failed';
  if (yes(metadata.cancelled) || yes(metadata.canceled)
      || ['cancelled', 'canceled', 'stopped'].includes(status)
      || metadata.error_code === 'processing_stopped') return 'cancelled';
  if (metadata.error || metadata.error_code) return 'failed';
  if (yes(metadata.processing) || ['queued', 'processing', 'pending'].includes(status)) return 'processing';
  return 'done';
}

module.exports = { readWatchedNoteOutcome };
