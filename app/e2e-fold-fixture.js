'use strict';
// Model-free fold documents for the UI tests (T1): the shape the Python backend writes (schemaVersion 2), built from
// whitespace tokens. The real tokenizer and ladder are tested in tests/test_textfold_ladder.py; this fixture is checked
// against the host's own validateDocument in summary-folding-ipc.test.js.
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const lines = full => full.split('\n').map(l => l.trim()).filter(l => l && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(l));
const strip = t => t.replace(/[.,;:!?]+$/, '') || t;
const plainInline = text => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]*)`/g, '$1').replace(/\s+/g, ' ').trim();
const tokens = (text, extra = () => ({})) => text.split(' ').filter(Boolean).map((t, i, all) => ({ t, ...(i < all.length - 1 ? { s: 1 } : {}), ...extra(i) }));
function sentenceRanges(toks) {
  const ranges = []; let start = 0;
  toks.forEach((tok, i) => { if (/[.!?]$/.test(tok.t) && i < toks.length - 1 && /^[A-Z0-9(]/.test(toks[i + 1].t)) { ranges.push([start, i + 1]); start = i + 1; } });
  ranges.push([start, toks.length]);
  return ranges;
}
function ladder(toks, sents, provenance) {
  const [a, b] = sents[0];
  const words = n => Math.min(n, b - a);
  if (provenance === 'local') {
    const tn = words(14);
    const brief = toks.slice(a, b).map((tok, k) => ({ ...tok, m: a + k }));
    return { role: 'context', ev: [0], brief, tn, topic: toks.slice(a, a + 2).map((tok, k) => ({ t: strip(tok.t), k })), model: 'local' };
  }
  // A stand-in for written levels: the first words as the takeaway, a few more as the reason, each tied to its source word.
  const head = words(6);
  const brief = [...toks.slice(a, a + head).map((tok, k) => ({ t: strip(tok.t), s: 1, m: a + k })),
    { t: 'omdat', s: 1 }, ...toks.slice(a + head, a + words(12)).map((tok, k) => ({ t: strip(tok.t), s: 1, m: a + head + k }))];
  brief[head - 1].s = 1; brief[brief.length - 1] = { t: brief[brief.length - 1].t, ...(brief[brief.length - 1].m !== undefined ? { m: brief[brief.length - 1].m } : {}) };
  return { role: 'claim', ev: sents.length > 2 ? [0, 1] : [0], brief, tn: head, topic: toks.slice(a, a + 1).map(tok => ({ t: strip(tok.t), k: 0 })), model: 'ai' };
}
function buildDocument(request, provenance) {
  return { schemaVersion: 2, sourceHash: request.sourceHash, provenance, sections: request.sections.map(section => {
    const units = lines(section.full).map(src => {
      const heading = /^#{1,6}\s+(.*\S)$/.exec(src), item = /^([-*+]|\d{1,3}[.)])\s+(.*\S)$/.exec(src);
      const full = plainInline(heading ? heading[1] : item ? item[2] : src);
      const toks = tokens(full);
      const unit = { kind: heading ? 'heading' : item ? 'item' : 'paragraph', src, full, toks };
      if (item) unit.marker = item[1];
      if (!heading) { unit.sents = sentenceRanges(toks); unit.lad = ladder(toks, unit.sents, provenance); }
      return unit;
    });
    const multi = units.filter(u => u.kind !== 'heading').length > 1;
    const first = units.find(u => u.kind !== 'heading');
    const lad = provenance === 'ai' && multi ? { take: first.lad.brief.slice(0, first.lad.tn).map(({ m, ...tok }) => tok), topic: [0] } : null;
    return { ...section, lad, units };
  }) };
}
const requestOf = sections => ({ schemaVersion: 2, sourceHash: hash(JSON.stringify(sections)), sections });
module.exports = { buildDocument, requestOf };
