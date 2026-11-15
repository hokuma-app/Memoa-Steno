// TextFold reader, morphing word by word (FLIP, ghosts, the stage's keyframes, continuous zoom, the slider bar).
// Derived from textfold/web/reader.js
// Source: https://github.com/chenxiachan/textfold at commit 5062eacc0b1e2a2528e0906414f5073033051a30 (Apache-2.0)
// Modified by Veneta MemoAi: mounted into a host element instead of owning the page; the page scroll is the host's
// scroller; everything that is not about folding (translations, notes, links, chat, find, save, PDF, type menu,
// Topic mind map) was left out. The copied ranges are listed in textfold/PORTING.md. Licence: ./LICENSE, ./NOTICE.
//
// Level 4 Full · 3 Brief (the author's evidence sentences) · 2 Key (written: takeaway and reason) · 1 Takeaway · 0 Topic.
// In the interface: Volledig, Beknopt, Kern, Kernzin, Onderwerpen.
// Every visible piece (word, dot, heading) is an element with a data-id that persists across levels; a level change
// is FLIP: measure, re-render, put each surviving piece back where it was, then let it slide home. A zoom gesture
// (wheel, pinch, slider, keys) does not lay anything out while it runs: it plays keyframes of the screen at each
// level, prepared while the reader was still ("the stage"), and the page takes over again at rest.
/* eslint-disable */
// @ts-nocheck
export function mountTextFold(root, D, opts) {
  'use strict';
  const U = D.units, A = {}, EDGES = [], ALIAS = {};
  const SCR = opts.scroller, ghostEl = opts.ghosts, docEl = opts.doc, bar = opts.bar;
  const rootEl = root;                                     // (TextFold: <html>)
  // The page's own scrolling element stands for the window; any other element is the host's scroller (TextFold: always the window).
  const ISDOC = SCR === document.scrollingElement || SCR === document.documentElement || SCR === document.body;
  const W = { get scrollY() { return ISDOC ? window.scrollY : SCR.scrollTop; },
    get innerHeight() { return ISDOC ? window.innerHeight : Math.max(1, Math.min(window.innerHeight, SCR.getBoundingClientRect().bottom)); },
    scrollBy(x, y) { if (ISDOC) window.scrollBy(x, y); else SCR.scrollBy(x, y); } };
  const off = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); off.push(() => target.removeEventListener(type, fn, o)); };
  const BAR = [4, 3, 2, 1, 0];
  const DUR = 560;
  const reduced = opts.reduced !== undefined ? opts.reduced : matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CJK_DOC = false;
  let lang = 'nl';
  const trOf = () => null;
  const perf = (name, t0) => { if (window.__drPerf) window.__drPerf.push([name, Math.round((performance.now() - t0) * 10) / 10]); };
  docEl.classList.add('doc');
  let level = opts.level !== undefined ? opts.level : 4;
  const localLevel = new Map();           // uid -> level the reader opened it to
  const unitEl = new Map();               // uid -> element
  const spans = new Map();                // uid -> Map(piece id -> span)
  const figOf = new Map();                // (no figures in a summary)
  const lvBlocks = [];                    // blocks that show or hide by level (none in a summary)
  const chunkOf = {};                     // uid -> chunk
  const headEls = [];                     // [chunk, heading element, stake element]
  D.chunks.forEach((c) => c.units.forEach((uid) => { chunkOf[uid] = c; }));
  const keepMine = false, marksFor = () => null, findMarks = new Map();
  const hlCls = () => '', fdCls = () => '';
  const tex = () => {}, texify = () => {};
  const clearFocus = () => {}, hidePeek = () => {}, findStale = () => {}, savePosSoon = () => {}, relayout = () => {};
  const legend = { style: {} }, tagline = { style: {} };
  const mapSync = () => {}, mapAway = () => {};
  const titleTex = (x) => x;
  // ── a unit in the current language ───────────────────────────────────
  function view(uid) {
    const u = U[uid];
    const l = u.lad;
    // glue: the half of a sentence a page break left in the unit before this one (ladder.dress)
    return { toks: u.toks, sents: u.sents, ev: u.lad.ev, brief: l.brief, tn: l.tn, topic: l.topic, glue: l.glue, p: '' };
  }

  // ── pieces: what a unit shows at a level ─────────────────────────────
  function pieces(uid, L) {
    const v = view(uid), p = `${uid}:${v.p}`;
    const ev = new Set(v.ev);
    // with "keep my highlights" on, the passages the reader marked are a level of their own: they stay as the paper
    // zooms out (the sentences at Brief, the author's words after the written line at Key and Takeaway)
    const mk = null, mine = null;
    let out;
    if (L >= 4) {
      out = [];
      v.sents.forEach(([a, b], s) => { for (let i = a; i < b; i++) out.push({ id: p + i, i, tok: v.toks[i], lead: ev.has(s) }); });
    } else if (L === 3) {
      const keep = new Set(v.brief.filter((t) => t.m !== undefined).map((t) => t.m));
      out = [];
      let prevEnd = null;
      const sents = mine ? [...new Set([...v.ev, ...v.sents.map((r, k) => [r, k]).filter(([r]) => mine.some((i) => i >= r[0] && i < r[1])).map(([, k]) => k)])].sort((a, b) => a - b) : v.ev;
      for (const s of sents) {
        const [a, b] = v.sents[s];
        if (prevEnd !== null && a !== prevEnd) out.push({ id: `${p}gap${s}`, gap: true });
        for (let i = a; i < b; i++) {
          if (!CJK_DOC) { out.push({ id: p + i, i, tok: v.toks[i], lead: keep.has(i) }); continue; }
          const raw = v.toks[i], txt = raw && raw.t !== undefined ? raw.t : raw;
          // a CJK footnote marker (①-⑩, ⑴-⒑, ⒈-⒑) glued into a sentence: dropped for display; a token that is
          // nothing but markers is not rendered at all (Full keeps the text as written). † ‡ § ¶ are left alone:
          // English papers use them as ordinary marks
          const clean = String(txt).replace(/[①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑]/g, "");
          if (!clean.trim()) continue;
          out.push({ id: p + i, i, tok: clean === txt ? raw : (typeof raw === "string" ? clean : { ...raw, t: clean }), lead: keep.has(i) });
        }
        prevEnd = b;
      }
      // the page break cut this sentence in two and the first half stays in the unit before: joined here, at the
      // first word, so the sentence reads whole ("…的法律位阶为行政" + "法规，加强对…") and stays one line
      if (v.glue) {
        const first = out.find((x) => !x.gap && x.tok);
        if (first) {
          const tk = typeof first.tok === "string" ? { t: first.tok } : first.tok;
          first.tok = { ...tk, t: v.glue + (tk.t || "") };
        }
      }
    } else {
      // i: the token of the full text a written word came from (none for the model's own words); j: its place in
      // the written line (Key's: Takeaway is the line's first sentence, so its words keep their places)
      const brief = v.brief.map((t, j) => ({ id: t.m !== undefined ? p + t.m : `${p}w${j}`, i: t.m, j, tok: t }));
      if (L === 2) out = brief.map((x, j) => ({ ...x, lead: j < v.tn }));
      else if (L === 1) {
        // topic words carry k, the takeaway word they slide from; a topic the model phrased itself may have none
        const inTopic = new Set(v.topic.map((t) => t.k).filter((k) => k !== undefined));
        out = brief.slice(0, v.tn).map((x, j) => ({ ...x, lead: inTopic.has(j) }));
      } else if (CJK_DOC && !v.tn) out = [];   // a takeaway that stepped down (ladder.fold_background): its topic with it
      else out = v.topic.map((t, j) => ({ id: t.k !== undefined ? brief[t.k].id : `${p}t${j}`, i: t.k !== undefined ? brief[t.k].i : undefined, tok: t, lead: true }));
      if (mine && L > 0) {   // the reader's passages after the written line, in the author's words (same ids: they stay put)
        const used = new Set(out.map((x) => x.id));
        let prev = null;
        for (const i of mine) {
          if (prev === null || i !== prev + 1) out.push({ id: `${p}kg${i}`, gap: true, kept: true });
          out.push({ id: used.has(p + i) ? `${p}${i}~k` : p + i, i, tok: v.toks[i], kept: true });
          prev = i;
        }
      }
    }
    // the reader's highlights. At Full and Brief (and in the passages kept after a written line): the words of the
    // passages marked there, or (in another language) their sentences, more lightly. On a written line: the words
    // marked on it, the model's too, in the colour of the level they were marked at; and the words that came from a
    // passage marked on a line before marks were kept as the line's own (anchor.shown), as they were lit then
    if (mk) for (const x of out) {
      if (L <= 2 && !x.kept) {
        const ln = x.j !== undefined && mk.line.has(x.j);
        x.hl = ln ? mk.line.get(x.j) : x.i !== undefined && mk.old.has(x.i) ? mk.old.get(x.i) : 0;
        x.sh = ln ? mk.lineSh.get(x.j) : mk.sh.get(x.i);
      } else if (x.i !== undefined) { x.hl = mk.exact.has(x.i) ? 1 : mk.soft.has(x.i) ? 2 : 0; x.sh = mk.sh.get(x.i); }
    }
    // a formula, citation or reference is the same element in every level and language
    const seen = new Map();
    for (const x of out) {
      if (!x.tok || !x.tok.a) continue;
      const base = `${uid}@${x.tok.a}`, n = seen.get(base) || 0;
      seen.set(base, n + 1);
      x.id = n ? `${base}#${n}` : base;
    }
    return out;
  }

  // an atom is kept on one line, except a citation, which may list many works and breaks between them
  const atCls = (t) => (t.a ? ' at' : t.x ? ' at' : '');
  // a piece's highlight (pieces(): hl): marked at Full or Brief, the same more lightly (another language), marked at
  // Key, marked at Takeaway
  const HL = ['', ' hl', ' hl hls', ' hl hlk', ' hl hlt'];
  // its shade (pieces(): sh; note.shade, 1 light or 3 deep, the usual 2 none: reader.css .sh1, .sh3), in the colour of
  // the level the note was made at (toneOf: tn-src, Full and Brief, the author's words; tn-key, tn-take, the written
  // line at Key, at Takeaway). The colour of each level is the reader's (the Aa menu), so a note keeps no colour
  const SHADES = [1, 2, 3];
  const shadeOf = (n) => (n && (n.shade === 1 || n.shade === 3) ? n.shade : 2);
  const toneOf = (n) => (n.anchor && n.anchor.shown ? (n.anchor.level === 1 ? 'take' : 'key') : 'src');
  const toneCls = (n) => ` tn-${toneOf(n)}${shadeOf(n) !== 2 ? ` sh${shadeOf(n)}` : ''}`;
  // the shade last chosen (a dot clicked): Highlight, and a note written from the bar over a selection, take it
  function fill(el, p) {
    const t = p.tok || {};
    const key = p.gap ? 'gap' : `${t.a || ''}\u0001${t.x || ''}\u0001${t.t || ''}\u0001${t.f || ''}`;
    if (el._k !== key) {
      el._k = key;
      if (p.gap) { el.textContent = '…'; }
      else if (t.a) { el.innerHTML = A[t.a].html; }
      else if (t.x) { el.textContent = t.x; tex(el, t.x); }
      else { el.textContent = t.t; }
      el.className = 'tk' + (p.gap ? ' gap' : '') + atCls(t) + (t.f ? ' ' + t.f : '');
      el._base = el.className;
    }
    el.className = el._base + (p.lead ? ' lead' : '') + (p.kept ? ' kept' : '') + hlCls(p) + fdCls(p);
  }

  // where a line may break between two pieces written without a space: between Chinese characters yes (except
  // before closing or after opening punctuation), inside a Latin word or formula group no
  const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;   // Han and kana break anywhere
  const CLOSE = /^[，。、；：！？）」』”’》%,.;:!?)\]]/;
  const OPEN = /[（「『“‘《([]$/;
  const textOf = (p) => p.gap ? '…' : (p.tok.t || 'A');
  function glued(p, q, cut) {
    const a = textOf(p), b = textOf(q);
    if (CLOSE.test(b) || OPEN.test(a)) return true;
    return !(CJK.test(a) || CJK.test(b) || cut);
  }

  // Thai is written without spaces and its tokens are syllables (tokens.py): a line may break only where the browser's
  // own dictionary ends a word, so the pieces of a word stay together and the words of a clause may part (a closing
  // mark after the word, an opening one before it, stay glued to it as everywhere)
  const THAI = /[\u0e00-\u0e7f]/;
  const thaiSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  // the pieces after which a line may break: the end of each Thai word, and each side of a Thai run among other text
  function thaiCuts(pcs) {
    const cuts = new Set();
    let run = [], text = '';
    const flush = () => {
      if (run.length) {
        const ends = new Set();
        if (thaiSeg) for (const w of thaiSeg.segment(text)) ends.add(w.index + w.segment.length);
        let at = 0;
        run.forEach((n) => { at += pcs[n].tok.t.length; if (!thaiSeg || ends.has(at)) cuts.add(n); });
        if (run[0] > 0) cuts.add(run[0] - 1);
        cuts.add(run[run.length - 1]);
      }
      run = []; text = '';
    };
    pcs.forEach((p, n) => {
      if (p.tok && p.tok.t && THAI.test(p.tok.t)) { run.push(n); text += p.tok.t; if (p.tok.s) flush(); }
      else flush();
    });
    flush();
    return cuts;
  }

  const levelOf = (uid) => localLevel.has(uid) ? localLevel.get(uid) : level;

  // Two ways to draw a unit. Near the viewport every piece is its own inline-block with a persistent element,
  // so a level change can slide it ("tokens"). Everywhere else the unit is plain text in a few runs ("text"):
  // a long paper laid out as ~60k inline-blocks made every level change re-lay the whole document (0.5 s at
  // 150 pages); as text it costs what an ordinary article costs, and only what is on screen pays for motion.
  function renderUnit(uid, hot = true) {
    const L = levelOf(uid), el = unitEl.get(uid);
    el.classList.toggle('local-open', localLevel.has(uid) && L > level);
    const fig = figOf.get(uid);
    if (fig) fig.dataset.l = L;
    el._mode = hot ? 'tok' : 'txt';
    el._stale = false;
    drawUnit(uid, L, el, spans.get(uid), hot);
  }
  // the drawing itself, into the unit's element (or a copy of it: the keyframes' sandbox)
  function drawUnit(uid, L, el, map, hot) {
    el.dataset.l = L;
    if (CJK_DOC) {   // an apparatus unit (footnote, contents line): not shown at all when folded, as written at Full
      el.hidden = L < 4 && !pieces(uid, L).length;
      if (el.hidden) { el._tx.replaceChildren(); return; }
    }
    if (!hot) {
      el._tx.innerHTML = textHtml(uid, L);
      if (el._tx.querySelector('.texsrc')) texify(el._tx);
      return;
    }
    const pcs = pieces(uid, L), frag = document.createDocumentFragment();
    const cuts = lang === 'th' ? thaiCuts(pcs) : null;
    let group = null;
    pcs.forEach((p, n) => {
      let s = map.get(p.id);
      if (!s) { s = document.createElement('span'); s.dataset.id = p.id; map.set(p.id, s); }
      fill(s, p);
      s._i = p.i;
      s._j = p.j;
      const last = n === pcs.length - 1;
      const space = !last && (p.gap || (p.tok && p.tok.s) || pcs[n + 1].gap);
      const glue = !last && !space && glued(p, pcs[n + 1], cuts && cuts.has(n));
      if (glue) { if (!group) { group = document.createElement('span'); group.className = 'wg'; frag.appendChild(group); } group.appendChild(s); }
      else if (group) { group.appendChild(s); group = null; }
      else frag.appendChild(s);
      if (space) {   // a space inside a highlight is highlighted too
        const both = p.hl && !last && pcs[n + 1].hl, found = p.fd && !last && pcs[n + 1].fd;
        frag.appendChild(both ? h('span', `hlsp${p.hl === pcs[n + 1].hl && p.sh === pcs[n + 1].sh ? hlCls(p).replace(' hl', '') : ''}`, ' ')
          : found ? h('span', `fdsp${p.fd === 2 && pcs[n + 1].fd === 2 ? ' fdc' : ''}`, ' ') : document.createTextNode(' '));
      }
    });
    el._tx.replaceChildren(frag);
  }

  // the same pieces as text: runs of equal styling become one span, formulas stay as they are
  function textHtml(uid, L) {
    const pcs = pieces(uid, L);
    let html = '', run = null, buf = '';
    const flush = () => { if (buf) html += run ? `<span class="${run}">${buf}</span>` : buf; buf = ''; };
    pcs.forEach((p, n) => {
      const t = p.tok || {};
      const cls = p.gap ? 'tr gap' : `tr${p.lead ? ' lead' : ''}${p.kept ? ' kept' : ''}${t.f ? ' ' + t.f : ''}${hlCls(p)}${fdCls(p)}`;
      if (cls !== run) { flush(); run = cls; }
      buf += p.gap ? '…' : t.a ? A[t.a].html : t.x ? `<span class="texsrc">${esc(t.x)}</span>` : esc(t.t);
      if (n < pcs.length - 1 && (p.gap || t.s || pcs[n + 1].gap)) {
        if ((p.hl && !pcs[n + 1].hl) || (p.fd && !pcs[n + 1].fd)) { flush(); run = null; }   // a highlight ends on its last word, not the space after it
        buf += ' ';
      }
    });
    flush();
    return html;
  }
  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function tokEl(tk, cls) {
    const s = h('span', 'tk' + atCls(tk) + (cls ? ' ' + cls : ''));
    if (tk.a) s.innerHTML = A[tk.a].html;
    else if (tk.x) { s.textContent = tk.x; tex(s, tk.x); }
    else s.textContent = tk.t;
    return s;
  }
  function toksHtml(toks) {
    let s = '';
    toks.forEach((t, i) => {
      s += t.a ? A[t.a].html : t.x ? `<span class="texsrc">${esc(t.x)}</span>` : esc(t.t);
      if (t.s && i < toks.length - 1) s += ' ';
    });
    return s;
  }
  function unitNode(uid, tag) {
    const u = U[uid];
    const labeled = u.role === 'item' && u.marker && /[\p{L}\p{N}]/u.test(u.marker);
    const el = h(tag, `u ${u.role} r-${u.lad.role}${u.lad.model === 'local' ? ' is-local' : ''}${labeled ? ' numbered' : ''}`);
    el.dataset.u = uid;
    el.id = uid;
    const dot = h('span', 'dot'); dot.dataset.id = `dot:${uid}`;
    el.append(dot);
    if (u.role === 'item' && u.marker) { const mk = h('span', labeled ? 'mk mk-labeled' : 'mk', esc(u.marker)); mk.dataset.id = `mk:${uid}`; el.append(mk); }
    el._tx = h(tag === 'li' || tag === 'figcaption' ? 'div' : 'p', 'tx');
    el.append(el._tx);
    unitEl.set(uid, el); spans.set(uid, new Map()); order.set(uid, order.size);
    return el;
  }

  const order = new Map();   // uid -> position in the paper
  function build() {
    const chunksEl = h('div', 'chunks');
    docEl.append(chunksEl);
    const chunkById = Object.fromEntries(D.chunks.map((c) => [c.id, c]));
    let body = chunksEl, list = null, listId = null;
    for (const b of D.blocks) {
      if (b.k === 'h') {
        const c = chunkById[b.chunk];
        const cur = h('section', `chunk l${c.level}${c.units.length ? '' : ' empty'}`);
        cur.dataset.chunk = c.id; cur.id = c.id;
        const hd = h('h2', 'hd'); hd.dataset.id = `h:${c.id}`;
        hd.hidden = !c.num && !c.title;
        const st = h('p', 'stake');
        cur.append(hd, st);
        headEls.push([c, hd, st]);
        body = h('div', 'body'); cur.append(body); chunksEl.append(cur);
        list = null; listId = null;
        continue;
      }
      if (b.k === 'u') {
        const u = U[b.u];
        if (u.role === 'item') {
          if (!list || listId !== u.list) { list = h('ul', 'list'); listId = u.list; body.append(list); }
          list.append(unitNode(b.u, 'li'));
          continue;
        }
        list = null;
        body.append(unitNode(b.u, 'div'));
      }
    }
    let lastPos = 0;   // a block sits where the unit before it sits
    for (const el of docEl.querySelectorAll('.u')) { if (el.dataset.u && order.has(el.dataset.u)) lastPos = order.get(el.dataset.u); else el._pos = lastPos; }
  }
  // a section's one-line summary, word by word
  function renderStake(c, st) {
    const lad = c.lad;
    st.replaceChildren();
    if (!lad) return;
    lad.take.forEach((tk, i) => {
      const s = tokEl(tk, lad.topic.includes(i) ? 'lead' : '');
      s.dataset.id = `st:${c.id}:${lang}:${i}`;
      s._i = i;
      st.append(s);
      if (tk.s) st.append(' ');
    });
  }
  function chunkTitle(c) { return titleTex(c.html); }
  function renderHeads() {
    for (const [c, hd, st] of headEls) {
      hd.innerHTML = `${c.num ? `<span class="num">${esc(c.num)}</span>` : ''}<span class="ttl">${chunkTitle(c)}</span>`;
      renderStake(c, st);
    }
  }

  // Every unit at the current level: the ones in `hot` as tokens, the ones in `band` as text, and the rest
  // later. A unit far from the viewport keeps its old drawing for now (stale) and is redrawn when the browser
  // is idle, nearest first, so a level change costs the neighbourhood, not the whole paper.
  // Blocks (equations above all: MathML is the costliest thing to lay out) follow the same rule.
  let staleQ = [];
  const redraw = (x) => { if (typeof x === 'string') renderUnit(x, false); else { x.dataset.l = level; x._stale = false; } };
  const elOf = (x) => (typeof x === 'string' ? unitEl.get(x) : x);
  function renderAll(hot = null, band = null) {
    staleQ = [];
    for (const uid of unitEl.keys()) {
      if (hot && hot.has(uid)) renderUnit(uid, true);
      else if (!band || band.has(uid)) renderUnit(uid, false);
      else { unitEl.get(uid)._stale = true; staleQ.push(uid); }
    }
    for (const b of lvBlocks) {
      if (!band || band.has(b)) { b.dataset.l = level; b._stale = false; } else { b._stale = true; staleQ.push(b); }
    }
  }
  // what is stale but the change has brought on screen is drawn now (the shrinking text pulled it in)
  function drawStaleInView(M) {
    let drew = false;
    for (const x of staleQ) {
      const el = elOf(x);
      if (!el._stale) continue;
      const r = el.getBoundingClientRect();
      if ((r.width || r.height) && r.bottom > -M && r.top < W.innerHeight + M) { redraw(x); drew = true; }
    }
    return drew;
  }
  // time-sliced, not idle-callback driven: idle time is scarce while animations run, and the backlog must drain
  const later = (f) => setTimeout(f, 0);
  function refreshStale() {
    staleQ = staleQ.filter((x) => elOf(x)._stale);
    if (!staleQ.length) return;
    const pin = viewAnchor();
    const at = pin && pin.dataset.u ? order.get(pin.dataset.u) : 0;
    const pos = (x) => (typeof x === 'string' ? order.get(x) : (x._pos ?? at));
    staleQ.sort((a, b) => Math.abs(pos(a) - at) - Math.abs(pos(b) - at));
    const step = () => {
      if (busy) return;   // a level change took over; it leaves its own stale list
      const ref = viewAnchor(), top0 = ref ? ref.getBoundingClientRect().top : 0;
      const t0 = performance.now();
      while (staleQ.length && performance.now() - t0 < 8) {   // 8 ms of work, then the page breathes
        const x = staleQ.shift();
        if (elOf(x)._stale) redraw(x);
      }
      // what was redrawn above the reader changed height: keep the page where the reader is
      if (ref) { const d = ref.getBoundingClientRect().top - top0; if (Math.abs(d) > 0.5) W.scrollBy(0, d); }
      if (staleQ.length) later(step); else { relayout(); warmSoon(); }
    };
    later(step);
  }
  function viewAnchor() {
    const col = docEl.getBoundingClientRect();
    const el = document.elementFromPoint(col.left + Math.min(col.width / 2, 260), W.innerHeight * 0.35);
    return el && el.closest('.u, .hd');
  }

  // units within `above` px over and `below` px under the viewport
  function unitsNear(above, below, withBlocks = false) {
    const out = new Set();
    const ok = (el) => { const r = el.getBoundingClientRect(); return (r.width || r.height) && r.bottom > -above && r.top < W.innerHeight + below; };
    for (const [uid, el] of unitEl) if (ok(el)) out.add(uid);
    // a hidden block has no box: judge it by the unit before it
    if (withBlocks) { const ids = [...order.keys()]; for (const b of lvBlocks) if (ok(b) || out.has(ids[b._pos ?? 0])) out.add(b); }
    return out;
  }

  // The units drawn at once on a level change: the ones near the anchor in reading order (on the Topic map
  // nearly the whole paper is on screen, so distance on screen says little about what will be on screen
  // after zooming in), the ones on screen now, and the blocks among them.
  function bandAround(anchor, k, hot) {
    const ids = [...order.keys()];
    let el = anchor && anchor.el;
    if (el && !el.dataset.u) el = (el.closest('section.chunk') || docEl).querySelector('.u');
    const at = el && el.dataset.u ? order.get(el.dataset.u) : 0;
    const band = new Set(hot);
    for (let i = Math.max(0, at - k); i <= Math.min(ids.length - 1, at + k); i++) band.add(ids[i]);
    for (const b of lvBlocks) if (Math.abs((b._pos ?? 0) - at) <= k) band.add(b);
    return band;
  }

  // before measuring, whatever is on screen as text becomes tokens (same content, now able to move)
  function hydrate(M) {
    for (const uid of unitsNear(M, M)) if (unitEl.get(uid)._mode !== 'tok') renderUnit(uid, true);
  }

  // ── FLIP ─────────────────────────────────────────────────────────────
  let busy = false, queued = null;
  let mapReady = false, mapShown = false;   // the Topic map drawn as a mind map (below): set up, and over the page now

  function visibleRect(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return r;
  }
  const near = (r, M) => r && r.bottom > -M && r.top < W.innerHeight + M;
  const BOXES = '.u, .hd, .stake, .box-h, .fbody, .eq, .raw, .paper-head, .bib';

  function snapshot(M) {
    const snap = new Map();
    // only pieces inside containers near the viewport: a full paper has ~20k of them
    const styles = new Map();   // one computed style per (container, class): pieces of a unit share their looks
    for (const box of docEl.querySelectorAll(BOXES)) {
      if (!near(visibleRect(box), M)) continue;
      const items = box.matches('[data-id]') ? [box] : box.querySelectorAll('[data-id]');
      for (const el of items) {
        const r = visibleRect(el);
        if (!near(r, M)) continue;
        const key = `${box.dataset.u || box.className}|${el.className}`;
        let st = styles.get(key);
        if (!st) {
          const cs = getComputedStyle(el);
          st = { font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`, color: cs.color, bg: cs.backgroundColor };
          styles.set(key, st);
        }
        snap.set(el, { r, ...st });
      }
    }
    return snap;
  }

  function anchorAt(x, y) {
    let el = document.elementFromPoint(x, y);
    el = el && el.closest('.u, .hd, figure.fig, .chunk');
    if (el && el.matches('figure.fig')) el = el.querySelector('.u') || el;
    if (el && el.matches('.chunk')) el = el.querySelector('.hd');
    if (!el || !docEl.contains(el)) {
      let best = null, bd = Infinity;
      for (const u of unitEl.values()) {
        const r = visibleRect(u); if (!r) continue;
        const d = r.top > y ? r.top - y : r.bottom < y ? y - r.bottom : 0;
        if (d < bd) { bd = d; best = u; }
        if (r.top > y + 2000) break;
      }
      el = best;
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { el, y, frac: r.height ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0 };
  }

  // Motion from `before` (a snapshot) to the page as it is now. Timed: it plays at once (a paragraph opening,
  // a language change). Scrubbed: paused, linear, one second long; the zoom position sets its progress.
  function buildMotion(before, M, scrubbed) {
    const after = new Map(), arrived = [], anims = [];
    for (const box of docEl.querySelectorAll(BOXES)) {
      if (!near(visibleRect(box), M)) continue;
      if (box._mode === 'txt') { arrived.push(box._tx); continue; }   // drawn as text: it fades in whole
      const items = box.matches('[data-id]') ? [box] : box.querySelectorAll('[data-id]');
      for (const el of items) { const r = visibleRect(el); if (near(r, M)) after.set(el, r); }
    }
    let t0 = performance.now();
    const add = (a) => { if (scrubbed) a.pause(); anims.push(a); };
    const fadeIn = scrubbed ? [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }] : [{ opacity: 0 }, { opacity: 1 }];
    const inOpts = scrubbed ? { duration: 1000, fill: 'both' } : { duration: DUR * 0.55, delay: DUR * 0.4, easing: 'ease-out', fill: 'backwards' };
    const moveOpts = scrubbed ? { duration: 1000, fill: 'both' } : { duration: DUR, easing: 'cubic-bezier(.2,.8,.2,1)' };
    const fadeOut = scrubbed ? [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }] : [{ opacity: 1 }, { opacity: 0 }];
    const outOpts = scrubbed ? { duration: 1000, fill: 'both' } : { duration: DUR * 0.45, easing: 'ease-in', fill: 'forwards' };
    perf('m.measure', t0); t0 = performance.now();
    for (const tx of arrived) add(tx.animate(fadeIn, inOpts));
    let moved = 0;
    for (const [el, b] of after) {
      const a = before.get(el);
      if (!a) { add(el.animate(fadeIn, inOpts)); continue; }
      const ar = a.r, dx = ar.left - b.left, dy = ar.top - b.top;
      // boxes (figures, equations) may change shape; text and headings scale uniformly by height
      const box = el.classList.contains('fbody') || el.classList.contains('eq') || el.classList.contains('raw') || el.classList.contains('bib');
      let sx = b.width ? ar.width / b.width : 1, sy = b.height ? ar.height / b.height : 1;
      if (!box) { sx = sy = (b.height ? ar.height / b.height : 1); }
      if (!isFinite(sx) || sx <= 0) sx = 1;
      if (!isFinite(sy) || sy <= 0) sy = 1;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      add(el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }], moveOpts));
      moved++;
    }
    perf('m.animate', t0); t0 = performance.now();
    // leaving: a ghost fades where the piece was
    const frag = document.createDocumentFragment();
    let ghosts = 0;
    for (const [el, a] of before) {
      if (after.has(el)) continue;   // (no rect read here: it would force a layout after the animations start)
      if (!near(a.r, 0) || ghosts > 600) continue;
      const g = el.cloneNode(true);
      g.removeAttribute('data-id');
      Object.assign(g.style, { left: `${a.r.left}px`, top: `${a.r.top}px`, width: `${a.r.width}px`, height: `${a.r.height}px`, font: a.font, color: a.color, backgroundColor: a.bg, transform: 'none', overflow: 'hidden' });
      frag.append(g); ghosts++;
      add(g.animate(fadeOut, outOpts));
    }
    ghostEl.append(frag);
    perf('m.ghosts', t0);
    if (window.__drPerf) window.__drPerf.push(['counts', { before: before.size, after: after.size, moved, ghosts }]);
    return anims;
  }

  // a timed change: everything near the reader moves at once
  function morph(mutate, anchor) {
    rootEl.classList.add('morphing');
    clearFocus();
    if (reduced) { mutate(); settle(anchor); done(); return; }
    const M = 160;
    hydrate(M);
    const before = snapshot(M);
    mutate();
    settle(anchor);
    for (let i = 0; i < 3 && drawStaleInView(M); i++) settle(anchor);
    buildMotion(before, M, false);
    busy = true;
    setTimeout(() => { ghostEl.replaceChildren(); done(); }, DUR + 40);
  }

  function done() {
    busy = false;
    rootEl.classList.remove('morphing');
    findStale();
    if (mapReady) mapSync();
    relayout();
    refreshStale();
    warmSoon();
    if (queued) { const q = queued; queued = null; q(); }
  }

  function settle(anchor) {
    if (!anchor || !anchor.el.isConnected) return;
    const r = visibleRect(anchor.el);
    if (!r) return;
    W.scrollBy(0, r.top + anchor.frac * r.height - anchor.y);
  }

  // ── zoom as a position, not a jump ───────────────────────────────────
  // The wheel, a pinch and the slider move one continuous position (4 = Full … 0 = Topic). The reader can stop
  // half way, or turn back; when the input stops, the position springs to the nearer level. The motion itself
  // is the stage's (below) when its keyframes are ready. Otherwise it is live: leaving a level prepares the
  // change to the next one for what is on screen (everything else waits, see renderAll), with its motion
  // paused, and the position sets how far the motion has run, frame by frame.
  const K_BAND = { 4: 30, 3: 45, 2: 60, 1: 150 };
  let pos = 4, goal = 4, tr = null, rafId = 0, lastT = 0, holding = false, snapTimer = 0;
  let aimLevel = null, aimAnchor = null, gesturePoint = null;
  const progress = () => (tr ? (pos - tr.from) / (tr.to - tr.from) : 0);
  function anchorNow() {
    const a = aimAnchor || (gesturePoint ? anchorAt(gesturePoint.x, gesturePoint.y) : defaultAnchor());
    aimAnchor = null;
    return a;
  }
  function prepare(to) {
    const from = level, M = 160, anchor = anchorNow();
    rootEl.classList.add('morphing');
    clearFocus();
    let t0 = performance.now(); const T0 = t0;
    hydrate(M);
    perf('p.hydrate', t0); t0 = performance.now();
    const before = snapshot(M);
    perf('p.snapshot', t0); t0 = performance.now();
    // zooming out shrinks the text, pulling units from a few screens away into view: give them tokens too
    const reach = W.innerHeight * (to < from ? 3 : 1.2);
    const hot = unitsNear(reach, reach);
    // mid-gesture, a narrow band: the next level is a moment away, and what comes on screen is drawn anyway
    const band = to === 0 ? null : bandAround(anchor, holding ? Math.min(12, K_BAND[to]) : K_BAND[to], hot);
    level = to;
    localLevel.clear();
    docEl.dataset.level = to;
    rootEl.dataset.level = to;
    renderAll(hot, band);
    perf('p.render', t0); t0 = performance.now();
    settle(anchor);
    for (let i = 0; i < 3 && drawStaleInView(M); i++) settle(anchor);
    perf('p.settle', t0); t0 = performance.now();
    tr = { from, to, anchor, anims: buildMotion(before, M, true) };
    perf('p.motion', t0);
    busy = true;
    perf('prepare', T0);
  }
  function scrub(t) {
    const ms = Math.max(0, Math.min(1, t)) * 1000;
    for (const a of tr.anims) a.currentTime = ms;
  }
  function finish() {   // the motion ran to its end: the page simply is the new level
    for (const a of tr.anims) a.cancel();
    ghostEl.replaceChildren();
    tr = null;
  }
  function revert() {   // back where it started: the old level is drawn again under the reader
    const { from, anchor } = tr;
    for (const a of tr.anims) a.cancel();
    ghostEl.replaceChildren();
    tr = null;
    level = from;
    docEl.dataset.level = from;
    rootEl.dataset.level = from;
    renderAll(from === 0 ? null : bandAround(anchor, 8, new Set()), from === 0 ? null : bandAround(anchor, K_BAND[from], new Set()));
    settle(anchor);
    for (let i = 0; i < 3 && drawStaleInView(160); i++) settle(anchor);
  }
  function apply() {
    if (stage && stageFrame()) return;
    if (!tr) {
      if (Math.abs(pos - level) < 1e-3) return;
      if (!stageOff && stageBegin() && stageFrame()) return;
      prepare(aimLevel !== null && aimLevel !== level ? aimLevel : pos < level ? level - 1 : level + 1);
    }
    const t = progress();
    if (t >= 1 - 1e-3) {   // arrived; if the position goes on, so does the zoom
      scrub(1); finish();
      if (aimLevel === level) aimLevel = null;
      if (Math.abs(pos - level) > 1e-3) apply();
      return;
    }
    if (t < 0) {           // turned back past the level it started from
      revert();
      if (Math.abs(pos - level) > 1e-3) apply();
      return;
    }
    scrub(t);
  }
  function tick(now) {
    rafId = 0;
    const dt = lastT ? Math.min(50, now - lastT) : 16;
    lastT = now;
    pos += (goal - pos) * (1 - Math.exp(-dt / (holding ? 45 : 95)));   // follows the hand closely, settles softly
    if (Math.abs(goal - pos) < 0.004) pos = goal;
    apply();
    placeThumb();
    if (pos !== goal) rafId = requestAnimationFrame(tick);
    else { lastT = 0; rest(); }
  }
  const kick = () => { if (mapShown) mapAway(); if (!rafId) rafId = requestAnimationFrame(tick); };
  function release() {   // the hand let go: spring to the level it was heading for
    holding = false;
    if (stage) { const d = pos - stage.last; goal = Math.max(0, Math.min(4, Math.abs(d) > 0.3 ? stage.last + Math.sign(d) : stage.last)); }
    else if (tr) { const t = progress(); goal = t > 0.3 ? tr.to : tr.from; } else goal = Math.round(goal);
    kick();
  }
  function rest() {
    if (holding) return;
    if (stage) {
      const L = Math.round(pos);
      if (Math.abs(pos - L) > 1e-3) { goal = L; kick(); return; }
      stageCommit(Math.max(stage.lo, Math.min(stage.hi, L)));
    } else if (tr) {
      const t = progress();
      if (t > 1e-3 && t < 1 - 1e-3) { goal = t > 0.5 ? tr.to : tr.from; kick(); return; }
      if (t <= 1e-3) revert(); else finish();
    }
    stageOff = false;
    busy = false;
    aimLevel = null;
    gesturePoint = null;
    rootEl.classList.remove('morphing');
    updateBar();
    relayout();
    refreshStale();
    hydrateSoon();
    warmSoon();
    if (queued) { const q = queued; queued = null; q(); }
  }
  function zoomBy(dz, point) {
    if (busy && !tr && !stage) return;   // a timed change (a paragraph opening, a language) is running
    if (!tr && !stage && !holding) gesturePoint = point;   // the zoom centres on the pointer
    holding = true;
    aimLevel = null;
    goal = Math.max(0, Math.min(4, goal + dz));
    clearTimeout(snapTimer);
    snapTimer = setTimeout(release, 160);
    kick();
  }
  // a jump to a level (a click, a key, a link): one motion straight there
  function setLevel(L, anchor) {
    L = Math.max(0, Math.min(4, Math.round(L)));
    if (busy && !tr && !stage) { queued = () => setLevel(L, anchor); return; }
    if (stage) { aimLevel = L; holding = false; goal = L; kick(); return; }   // the stage plays on to L
    if (tr) { if (progress() > 0.5) { scrub(1); finish(); } else revert(); pos = goal = level; }
    if (L === level) {
      if (localLevel.size) {   // close the paragraphs the reader opened
        const band = level === 0 ? null : bandAround(anchor || defaultAnchor(), K_BAND[level], new Set());
        morph(() => { localLevel.clear(); renderAll(unitsNear(W.innerHeight, W.innerHeight), band); }, anchor || defaultAnchor());
      }
      return;
    }
    aimLevel = L;
    aimAnchor = anchor || null;
    gesturePoint = null;
    holding = false;
    goal = L;
    kick();
  }
  // after a pause in scrolling, what is on screen becomes tokens, so the next zoom starts without that work
  let hydrateTimer = 0;
  function hydrateSoon() {
    clearTimeout(hydrateTimer);
    hydrateTimer = setTimeout(() => { if (!busy && !reduced) hydrate(200); }, 220);
  }
  // ── the stage: a zoom that lays nothing out ──────────────────────────
  // Crossing a level above costs one layout of everything near the reader (30-70 ms on an ordinary paper), a
  // hitch the hand feels on the wheel and on the slider. So while the reader is still, the stretch of paper on
  // screen is laid out at each level ahead of time, one level per idle moment, and every visible piece of it is
  // kept as a positioned copy: five keyframes. A zoom hides the page and plays the keyframes on a stage above it:
  // a piece present at two neighbouring levels slides and scales from one to the other, a piece present at one
  // fades. Every frame, level crossings included, only moves and fades copies. At rest the page is drawn at the
  // level reached, exactly as its keyframe was, and takes the stage's place in the same frame. Where no keyframe
  // is ready (a fresh page, a far jump), the zoom falls back to the live motion above.
  const stageEl = h('div', 'zstage');
  // The stage and its sandbox live in a closed shadow tree. The thousands of copies they add, move and drop are then
  // not in the page's document: nothing watching the page (browser extensions above all: translators, ad blockers,
  // which a served page lets in and a local file does not) has to process them. Measured with this computer's own
  // extensions loaded, keeping them in the page froze a served page for seconds at a time.
  const zhost = h('div', 'zhost');
  root.append(zhost);
  const zroot = zhost.attachShadow({ mode: 'closed' });
  zroot.adoptedStyleSheets = [shadowSheet()];
  zroot.append(stageEl);

  // the reader's own stylesheet, for inside the shadow tree: rules that start from <html> (the language's line
  // height, dark mode) start from the host instead, which carries the same attributes
  function shadowSheet() {
    const out = [];
    const hosted = (sel) => sel.replace(/(^|[\s,>+~(])\.tf-root((?:\[[^\]]*\])*)(?=[\s,>+~)]|$)/g,
      (m, pre, q) => `${pre}:host${q ? `(${q})` : ''}`);
    const walk = (rules) => {
      for (const r of rules) {
        if (r.media && r.cssRules) { out.push(`@media ${r.media.mediaText} {`); walk(r.cssRules); out.push('}'); }
        else if (r.selectorText !== undefined) out.push(`${hosted(r.selectorText)} { ${r.style.cssText} }`);
        else out.push(r.cssText);
      }
    };
    for (const sh of document.styleSheets) {
      let rules;
      try { rules = sh.cssRules; } catch { continue; }   // another origin's sheet (the fonts): not readable, and not needed
      if ([...rules].some((r) => r.selectorText === '.tf-root .zstage')) walk(rules);
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(out.join('\n'));
    return sheet;
  }
  function mirrorLang() { zhost.setAttribute('lang', rootEl.lang); zhost.dataset.lang = lang; }
  // and the type's (applyType): the sandbox lays a level out with the page's rules for them (a sans-serif paragraph is
  // smaller), and the stage hides the margins the page hides
  function mirrorType() {
    const r = rootEl;
    for (const k of ['font', 'width', 'hide', 'theme', 'style']) { if (r.dataset[k]) zhost.dataset[k] = r.dataset[k]; else delete zhost.dataset[k]; }
  }
  mirrorType();
  // KaTeX's stylesheet, once the page has it (loaded, or carried inside), is wanted inside too (drawn formulas in the
  // copies and the sandbox)
  let katexInside = false;
  function katexCss() {
    const sheet = !katexInside && document.querySelector('link[href*="katex"], style#katex-css');
    if (!sheet) return false;
    katexInside = true;
    zroot.append(sheet.cloneNode(true));
    return true;
  }
  const caps = [null, null, null, null, null];   // level -> keyframe
  const tried = [];                              // level -> the situation a capture was last attempted in
  let capEpoch = 0, stage = null, stageOff = false, warmTimer = 0, lastPointer = null, lastScrollT = 0;
  let IDS = [];                                  // units in reading order
  const HEAD_IDX = new Map();                    // heading -> reading position of the first unit after it
  const capKey = () => `${lang}|${innerWidth}|${W.innerHeight}|${capEpoch}`;
  const setLevelAttr = (L) => { level = L; docEl.dataset.level = L; rootEl.dataset.level = L; };
  // a level flipped and flipped back must leave no CSS transition running on the page, nor be measured half way
  const CSST = window.CSSTransition;
  function settleTransitions() { if (CSST) for (const a of document.getAnimations()) if (a instanceof CSST) a.finish(); }

  function bandRange(i0, i1, k) {
    const band = new Set();
    for (let i = Math.max(0, i0 - k); i <= Math.min(IDS.length - 1, i1 + k); i++) band.add(IDS[i]);
    for (const b of lvBlocks) { const p = b._pos ?? 0; if (p >= i0 - k && p <= i1 + k) band.add(b); }
    return band;
  }

  // how a piece looks, written out, since its copy will not sit where the page's CSS can reach it
  function looks(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
    const css = `font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily};font-variant:${cs.fontVariant};` +
      `color:${cs.color};background-color:${cs.backgroundColor};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform};` +
      `box-shadow:${cs.boxShadow};text-align:${cs.textAlign};${cs.textWrap ? `text-wrap:${cs.textWrap};` : ''}`;
    // type: what a copy's look is apart from its ink and its size (a heavier weight counts as one weight)
    return { css, fs: parseFloat(cs.fontSize) || 16, disp: cs.display, type: `${cs.fontStyle} ${parseFloat(cs.fontWeight) >= 550 ? 'b' : 'n'} ${cs.fontFamily}|${cs.backgroundColor}` };
  }
  // the boxes drawn behind the words: Topic chips and cards, theorem rules, the Takeaway spine
  const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
  function decoLooks(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.display === 'contents' || cs.visibility === 'hidden') return null;
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => [cs[`border${s}Width`], cs[`border${s}Style`], cs[`border${s}Color`]]);
    const drawn = !clear(cs.backgroundColor) || cs.boxShadow !== 'none' || sides.some(([w, s, c]) => parseFloat(w) > 0 && s !== 'none' && !clear(c));
    return drawn ? `background-color:${cs.backgroundColor};border-width:${sides.map((x) => x[0]).join(' ')};border-style:${sides.map((x) => x[1]).join(' ')};` +
      `border-color:${sides.map((x) => x[2]).join(' ')};border-radius:${cs.borderRadius};box-shadow:${cs.boxShadow}` : null;
  }

  // every visible piece between page heights lo and hi: where it is, how it looks, what it moves with.
  // root: the page, or a sandbox copy of it; oy turns its viewport heights into page heights; own: the pieces are
  // the sandbox's, to be moved onto the stage (the page's own are copied)
  function collect(root, units, lo, hi, oy, L, own) {
    const P = new Map(), U = new Map(), lk = new Map(), dk = new Map();
    const rectOf = (r) => ({ x: r.left, y: r.top + oy, w: r.width, h: r.height });
    const inRange = (r) => r.width > 0 && r.height > 0 && r.bottom + oy > lo && r.top + oy < hi;
    const piece = (el, id, grp, kind, ctx) => {
      const r = el.getBoundingClientRect();
      if (!inRange(r)) return false;
      const k = `${ctx}|${el.tagName}|${el.className}`;
      let st = lk.get(k);
      if (st === undefined) { st = looks(el); lk.set(k, st); }
      if (st) P.set(id, { ...rectOf(r), st, kind, grp, el, take: own });
      return !!st;
    };
    const deco = (el, id, grp, k) => {
      const r = el.getBoundingClientRect();
      if (!inRange(r)) return;
      let css = dk.get(k);
      if (css === undefined) { css = decoLooks(el); dk.set(k, css); }
      if (css) P.set(id, { ...rectOf(r), st: { css, fs: 1 }, kind: 'd', grp, id });
    };
    for (const [uid, u] of units) {
      const r = u.getBoundingClientRect();
      if (!inRange(r)) continue;
      U.set(uid, rectOf(r));
      deco(u, `d:u:${uid}`, uid, `u|${u.className}`);
      for (const el of u.querySelectorAll('[data-id]')) piece(el, el.dataset.id, uid, el.classList.contains('dot') ? 'b' : 't', u.className);
    }
    for (const sec of root.querySelectorAll('section.chunk')) deco(sec, `d:c:${sec.id}`, `h:${sec.id}`, `c|${sec.className}`);
    for (const bx of root.querySelectorAll('.box')) { const f = bx.querySelector('.u'); deco(bx, `d:b:${bx.id}`, f && f.dataset.u, `b|${bx.className}`); }
    if (L === 1) {   // the spine of a Takeaway section is a pseudo-element: drawn from its section's box
      const any = root.querySelector('section.chunk > .body');
      const line = any ? getComputedStyle(any, '::before').backgroundColor : '';
      for (const sec of root.querySelectorAll('section.chunk')) {
        const body = sec.querySelector(':scope > .body'), r = body && body.getBoundingClientRect();
        if (r && r.height > 24 && r.bottom + oy > lo && r.top + oy < hi) {
          P.set(`d:s:${sec.id}`, { x: r.left + 3, y: r.top + oy + 10, w: 1, h: r.height - 20, st: { css: `background-color:${line}`, fs: 1 }, kind: 'd', grp: `h:${sec.id}`, id: `d:s:${sec.id}` });
        }
      }
    }
    for (const el of root.querySelectorAll('.paper-head > [data-id], .hd, .stake > [data-id], .box-h, .fbody, .eq, .raw, .bib')) {
      const sec = el.closest('section.chunk');
      let grp = null, kind = 't';
      if (el.classList.contains('hd') || el.parentNode.classList.contains('stake')) grp = sec && `h:${sec.id}`;
      else if (el.classList.contains('box-h')) { const f = el.parentNode.querySelector('.u'); grp = f && f.dataset.u; }
      else {
        kind = 'b';
        const fig = el.classList.contains('fbody') ? el.parentNode : null, cap = fig && fig.querySelector('figcaption.u');
        const blk = fig || el;
        grp = cap ? cap.dataset.u : blk._pos !== undefined ? IDS[blk._pos] : null;
      }
      if (piece(el, el.dataset.id, grp, kind, el.parentNode.className) && el.classList.contains('hd')) {
        const p = P.get(el.dataset.id);
        U.set(el.dataset.id, { x: p.x, y: p.y, w: p.w, h: p.h });
      }
    }
    return { P, U };
  }

  // the pieces become copies (kept aside: the pairs below are made of them), hidden until a zoom plays them
  const DECO_Z = { c: 0, b: 1, s: 2, u: 3 };   // cards under theorem rules under the spine under chips
  const zOf = (p) => (p.kind === 'd' ? DECO_Z[p.id[2]] ?? 3 : 9);   // and the words over all of them
  let capSerial = 0;
  function keep(L, got, lo, hi, hot, band, start, end) {
    for (const p of got.P.values()) {
      let el;
      if (p.kind === 'd') {
        el = document.createElement('div');
        el.className = 'zp';
        el.style.cssText = `${p.st.css};width:${p.w}px;height:${p.h}px;opacity:0`;
      } else {
        el = p.take ? p.el : p.el.cloneNode(true);
        el.removeAttribute('data-id'); el.removeAttribute('id');
        for (const x of el.querySelectorAll('[id]')) x.removeAttribute('id');
        el.classList.remove('flash');
        const inline = el.tagName === 'SPAN';
        el.classList.add('zp', inline ? 'zi' : 'zb');
        el.style.cssText = `${p.st.css}display:${inline ? 'inline-block' : p.st.disp};width:${p.w}px;height:${p.h}px;opacity:0`;
      }
      p.pp = { el };
      p.el = null;
    }
    caps[L] = { key: capKey(), P: got.P, U: got.U, lo, hi, hot, band, start, end, n: ++capSerial };
  }
  function drop(L) { caps[L] = null; dropPair(L); dropPair(L + 1); }

  // Pairs: the copies of two neighbouring levels, grouped by how they move from one to the other. Copies that move
  // alike (the words of a line that keeps its shape, the words of a paragraph fading out) are one group: one layer the
  // GPU draws once, one animation. A dense paper then moves a few hundred groups instead of thousands of words: each
  // animation costs the page a little every frame, and thousands of them filled the frame (2512.23916: half the frames
  // dropped). A pair is built while the reader is still, once both its levels have keyframes; a zoom only plays it.
  const pairs = [null, null, null, null, null];   // the upper level -> its pair with the level below
  function pairReady(hi) { const P = pairs[hi], A = caps[hi], B = caps[hi - 1]; return !!(P && A && B && P.a === A.n && P.b === B.n); }
  function dropPair(hi) { if (pairs[hi]) { pairs[hi].layer.remove(); pairs[hi] = null; } }
  // How one copy can stand for both: a text copy in the same type (ink and size aside) scales by the ratio of the font
  // sizes, a box of the same size moves as it is; its ink turns at the level. When the type changes (the author's serif
  // to the summary's sans), two copies crossfade. Returns the scale, or 0.
  function oneCopy(a, b) {
    if ((a.st.type || a.st.css) !== (b.st.type || b.st.css)) return 0;
    if (a.kind === 't' && b.kind === 't') { const k = b.st.fs / a.st.fs; return Math.abs(b.w - k * a.w) < 1.5 && Math.abs(b.h - k * a.h) < 2.5 ? k : 0; }
    return Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5 ? 1 : 0;
  }
  function buildPair(hi) {
    const A = caps[hi], B = caps[hi - 1], groups = [], by = new Map();
    const group = (key, make) => {
      let g = by.get(key);
      if (!g) { g = { ...make(), el: h('div', 'zg'), y0: Infinity, y1: -Infinity }; by.set(key, g); groups.push(g); }
      return g;
    };
    const add = (g, p, x, y) => {   // a member sits at its own place, shown: its group shows, hides and moves it
      const el = p.pp.el.cloneNode(true);
      el.style.transform = `translate(${x}px,${y}px)`;
      el.style.opacity = '1';
      g.el.append(el);
      g.y0 = Math.min(g.y0, y); g.y1 = Math.max(g.y1, y + p.h);
    };
    for (const [id, a] of A.P) {
      const b = B.P.get(id), z = zOf(a), k = b ? oneCopy(a, b) : 0;
      if (k) {   // copies that map the same way (scale k, then the same shift: a line keeping its shape) are one group
        const dx = b.x - k * a.x, dy = b.y - k * a.y;
        add(group(`m|${z}|${a.grp}|${k.toFixed(3)}|${dx.toFixed(1)}|${dy.toFixed(1)}`, () => ({ kind: 'move', k, dx, dy, z })), a, a.x, a.y);
      } else if (b) {
        const text = a.kind === 't' && b.kind === 't';
        groups.push({ kind: 'x', side: 0, a, b, text, el: a.pp.el.cloneNode(true), z }, { kind: 'x', side: 1, a, b, text, el: b.pp.el.cloneNode(true), z });
      } else add(group(`o|${z}|${a.grp}`, () => ({ kind: 'out', grp: a.grp, z })), a, a.x, a.y);
    }
    for (const [id, b] of B.P) if (!A.P.has(id)) { const z = zOf(b); add(group(`i|${z}|${b.grp}`, () => ({ kind: 'in', grp: b.grp, z })), b, b.x, b.y); }
    groups.sort((x, y) => x.z - y.z);
    const layer = h('div', 'zl');
    layer.append(...groups.map((g) => g.el));
    dropPair(hi);
    stageEl.append(layer);
    // laid out once now, while nothing moves; then set aside (a set-aside layer keeps its layout, so showing it is cheap)
    layer.classList.add('live');
    requestAnimationFrame(() => setTimeout(() => { if (!(stage && stage.pair && stage.pair.P.layer === layer)) layer.classList.remove('live'); }));
    pairs[hi] = { a: A.n, b: B.n, layer, groups };
  }
  // the page's top and end are where a zoom must stop too; known when the band reaches them
  const reachesStart = (band) => !band || band.has(IDS[0]);
  const reachesEnd = (band) => !band || band.has(IDS[IDS.length - 1]);

  // the level on screen: the page as it is, a screen above and below, its tokens copied
  function captureHere() {
    const H = W.innerHeight, sy = W.scrollY, lo = sy - H, hi = sy + 2 * H;
    const near = new Set();
    for (const [uid, el] of unitEl) { const r = el.getBoundingClientRect(); if ((r.width || r.height) && r.bottom + sy > lo && r.top + sy < hi) near.add(uid); }
    if (!near.size) return;
    for (const uid of near) if (unitEl.get(uid)._mode !== 'tok') renderUnit(uid, true);
    const got = collect(docEl, [...near].map((u) => [u, unitEl.get(u)]), lo, hi, W.scrollY, level, false);
    const idx = [...near].map((u) => order.get(u));
    const band = level === 0 ? null : bandRange(Math.min(...idx), Math.max(...idx), K_BAND[level]);
    keep(level, got, lo, hi, near, band, reachesStart(band) ? 0 : -Infinity, reachesEnd(band) ? docEl.getBoundingClientRect().bottom + W.scrollY : Infinity);
  }

  // Another level is laid out in a sandbox: a hidden copy of the stretch of paper a zoom would draw (the band,
  // with the sections and boxes around it), never painted. The page itself is not touched, so nothing of it has
  // to be laid out again; the sandbox's pieces are measured and moved onto the stage.
  const sandEl = h('div', 'zsand');
  zroot.append(sandEl);
  function sandbox(L, band, first, last) {
    const units = new Map(), heads = new Map(), lv = new Set(lvBlocks);
    const inBand = (x) => !band || band.has(x);
    const S = band && unitEl.get(first), E = band && unitEl.get(last);
    const between = (sec) => {   // a section from the band's first unit to its last, units of its own or not
      if (!band) return true;
      const p = S.compareDocumentPosition(sec), q = E.compareDocumentPosition(sec);
      return !!((p & Node.DOCUMENT_POSITION_CONTAINS) || (q & Node.DOCUMENT_POSITION_CONTAINS) ||
        ((p & Node.DOCUMENT_POSITION_FOLLOWING) && (q & Node.DOCUMENT_POSITION_PRECEDING)));
    };
    const plain = (el) => { el.classList.remove('linked', 'focal', 'flash', 'local-open'); return el; };
    function copy(node) {
      const cl = node.classList;
      if (cl.contains('u')) {
        const uid = node.dataset.u;
        if (!inBand(uid)) return null;
        const el = plain(node.cloneNode(false));
        for (const c of node.children) {
          if (c === node._tx) { el._tx = c.cloneNode(false); el.append(el._tx); } else el.append(c.cloneNode(true));
        }
        units.set(uid, el);
        drawUnit(uid, L, el, null, false);
        return el;
      }
      if (lv.has(node) && !inBand(node)) return null;
      if (node.tagName === 'FIGURE') { const cap = node.querySelector(':scope > figcaption.u'); if (cap && !inBand(cap.dataset.u)) return null; }
      if (cl.contains('hd')) { const el = plain(node.cloneNode(true)); heads.set(el.dataset.id, el); return el; }
      if (cl.contains('stake') || cl.contains('box-h') || cl.contains('fbody') || cl.contains('eq') || cl.contains('raw')) {
        const el = node.cloneNode(true);
        if (lv.has(node)) { el.dataset.l = L; el._pos = node._pos; }
        return el;
      }
      if (cl.contains('side') || cl.contains('lside')) return node.cloneNode(true);
      if (cl.contains('paper-head')) return reachesStart(band) ? node.cloneNode(true) : null;
      if (cl.contains('bib')) return reachesEnd(band) ? node.cloneNode(true) : null;
      if (node.tagName === 'SECTION' && !between(node)) return null;
      const el = plain(node.cloneNode(false));   // a container: kept with what it holds of the band
      if (lv.has(node) || node.tagName === 'FIGURE') el.dataset.l = L;
      el._pos = node._pos;
      let any = false;
      for (const c of node.children) { const k = copy(c); if (k) { el.append(k); any = true; } }
      return any || node.tagName === 'SECTION' || cl.contains('chunks') ? el : null;
    }
    const root = h('div', CJK_DOC ? 'doc cjk' : 'doc');
    root.dataset.level = L;
    for (const c of docEl.children) { const k = copy(c); if (k) root.append(k); }
    return { root, units, heads };
  }
  function captureAt(L, cands) {
    const H = W.innerHeight, k = K_BAND[L];
    const idx = cands.map((c) => c.idx).filter((i) => i !== undefined);
    if (!idx.length) return;
    const i0 = Math.min(...idx), i1 = Math.max(...idx);
    const band = L === 0 ? null : bandRange(i0, i1, k);
    const first = IDS[Math.max(0, i0 - k)], last = IDS[Math.min(IDS.length - 1, i1 + k)];
    const { root, units, heads } = sandbox(L, band, first, last);
    const pr = docEl.parentElement.getBoundingClientRect();   // (TextFold: the body's content box)
    sandEl.style.left = `${pr.left}px`;
    sandEl.style.width = `${pr.width}px`;
    sandEl.replaceChildren(root);
    const oy = docEl.getBoundingClientRect().top + W.scrollY - root.getBoundingClientRect().top;   // (lays the sandbox out)
    const lim = { start: reachesStart(band) ? 0 : -Infinity, end: reachesEnd(band) ? root.getBoundingClientRect().bottom + oy : Infinity };
    // what a zoom anchored on any of the candidates may show at L
    let lo = Infinity, hi = -Infinity;
    for (const c of cands) {
      const el = c.el.dataset.u ? units.get(c.key) : heads.get(c.key), r = el && el.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) continue;
      const [a, b] = need(c, { y: r.top + oy, h: r.height }, lim);
      lo = Math.min(lo, a); hi = Math.max(hi, b);
    }
    lo -= 0.15 * H; hi += 0.15 * H;
    if (band) {   // nothing beyond the band was drawn
      const fe = first !== IDS[0] && units.get(first), le = last !== IDS[IDS.length - 1] && units.get(last);
      if (fe) lo = Math.max(lo, fe.getBoundingClientRect().top + oy);
      if (le) hi = Math.min(hi, le.getBoundingClientRect().bottom + oy);
    }
    let got = null;
    const hot = new Set();
    if (lo < hi) {
      for (const [uid, el] of units) {
        const r = el.getBoundingClientRect();
        if ((r.width || r.height) && r.bottom + oy > lo - 0.3 * H && r.top + oy < hi + 0.3 * H) hot.add(uid);
      }
      for (const uid of hot) drawUnit(uid, L, units.get(uid), new Map(), true);
      got = collect(root, [...hot].map((u) => [u, units.get(u)]), lo, hi, oy, L, true);
      if (lim.end !== Infinity) lim.end = root.getBoundingClientRect().bottom + oy;
    }
    sandEl.replaceChildren();
    if (got) keep(L, got, lo, hi, hot, band, lim.start, lim.end);
  }

  // The stretch of page (at some level, in its keyframe's coordinates) that a zoom anchored on c may show. The
  // anchor's point under the pointer stays put; the pointer may be anywhere on c that is on screen. The page
  // cannot scroll above its top or below its end, and neither does the stage.
  const clampTop = (y, lim) => Math.max(lim.start, Math.min(Math.max(lim.start, lim.end - W.innerHeight), y));
  function need(c, at, lim) {
    const H = W.innerHeight;
    const f0 = c.Hc ? Math.min(1, Math.max(0, -c.T / c.Hc)) : 0, f1 = c.Hc ? Math.min(1, Math.max(0, (H - c.T) / c.Hc)) : 0;
    const top = (f) => clampTop(at.y + f * at.h - (c.T + f * c.Hc), lim);
    const a = top(f0), b = top(f1);
    return [Math.min(a, b), Math.max(a, b) + H];
  }
  // what a zoom may be anchored on: whatever is on screen (units and headings)
  function visibleCands() {
    const H = W.innerHeight, out = [];
    const add = (el, key, idx) => { const r = el.getBoundingClientRect(); if ((r.width || r.height) && r.bottom > 0 && r.top < H) out.push({ el, key, idx, T: r.top, Hc: r.height, X: r.left }); };
    for (const [uid, el] of unitEl) add(el, uid, order.get(uid));
    for (const [, hd] of headEls) add(hd, hd.dataset.id, HEAD_IDX.get(hd));
    return out;
  }
  // zooming in, every anchor on a full screen of chips would need the whole paper laid out at the deeper levels:
  // prepare for the one a zoom will likely start from: what is under the pointer when it rests on the paper,
  // else the reading line (where the slider and the keys zoom). A few paragraphs on screen are all prepared.
  function zoomInCands(all) {
    const out = all.length <= 12 ? [...all] : [];
    const onPaper = lastPointer && (() => { const e = document.elementFromPoint(lastPointer.x, lastPointer.y); return e && docEl.contains(e); })();
    const a = onPaper ? anchorAt(lastPointer.x, lastPointer.y) : defaultAnchor();
    const key = a && (a.el.dataset.u || a.el.dataset.id);
    if (key && !out.some((x) => x.key === key)) {
      const r = a.el.getBoundingClientRect();
      out.push({ el: a.el, key, idx: a.el.dataset.u ? order.get(key) : HEAD_IDX.get(a.el), T: r.top, Hc: r.height, X: r.left });
    }
    return out;
  }
  // the keyframe of the level on screen must be the page as it is: every visible unit where the keyframe has it
  // (up to one offset for all, when something far above changed height), and the screen inside it
  function fits(cap, vis) {
    let d0 = null;
    for (const c of vis) {
      const at = cap.U.get(c.key);
      if (!at) return null;
      const d = at.y - (c.T + W.scrollY);
      d0 ??= d;
      if (Math.abs(d - d0) > 1 || Math.abs(at.h - c.Hc) > 1 || Math.abs(at.x - c.X) > 1) return null;
    }
    if (d0 === null) return null;
    const top = W.scrollY + d0;
    return top >= cap.lo && top + W.innerHeight <= cap.hi ? { d0 } : null;
  }
  function covers(L, cands) {
    const cap = caps[L];
    if (!cap) return false;
    if (L === level) return !!fits(cap, cands);
    for (const c of cands) {
      const at = cap.U.get(c.key);
      if (!at) return false;
      const [a, b] = need(c, at, cap);
      if (a < cap.lo || b > cap.hi) return false;
    }
    return true;
  }

  // while the reader is still: the next keyframe that is missing, one per task, nearest level first
  function warmSoon(ms = 360) { clearTimeout(warmTimer); if (!reduced) warmTimer = setTimeout(warm, ms); }
  function warm() {
    if (busy || stage || tr || drag || holding || localLevel.size || staleQ.length || document.hidden) return;
    if (performance.now() - lastScrollT < 180) return warmSoon(200);
    if (katexCss()) { capEpoch++; return warmSoon(400); }
    const key = capKey();
    caps.forEach((c, L) => { if (c && c.key !== key) drop(L); });
    const all = visibleCands();
    if (!all.length) return;
    for (const L of [level, level - 1, level + 1, level - 2, level + 2, level - 3, level + 3, level - 4, level + 4]) {
      if (L < 0 || L > 4) continue;
      const cands = L <= level ? all : zoomInCands(all);
      if (covers(L, cands)) continue;
      const sig = `${key}|${level}|${Math.round(W.scrollY)}|${cands.map((c) => c.key).join(',')}`;
      if (tried[L] === sig) continue;   // tried in this very situation already: it cannot do better
      // the map lit up under the pointer would be copied lit; other levels are laid out apart and can go ahead
      if (L === level && (docEl.classList.contains('mapfocus') || docEl.dataset.role)) { warmSoon(600); continue; }
      tried[L] = sig;
      const t0 = performance.now();
      if (L === level) captureHere(); else captureAt(L, cands);
      perf(`cap${L}`, t0);
      return warmSoon(20);
    }
    for (const up of [level, level + 1, level - 1, level + 2, level - 2, level + 3, level - 3, level + 4]) {
      if (up < 1 || up > 4 || !caps[up] || !caps[up - 1] || pairReady(up)) continue;
      const t0 = performance.now();
      buildPair(up);
      perf(`pair${up}`, t0);
      return warmSoon(20);
    }
  }

  // a zoom begins: the keyframes take over if they hold the screen at this level and at the next in its direction
  function stageBegin() {
    if (reduced || localLevel.size) return false;
    const t0 = performance.now(), key0 = capKey(), cap = caps[level];
    if (!cap || cap.key !== key0) return false;
    const f = fits(cap, visibleCands());
    if (!f) return false;
    const anchor = aimAnchor || (gesturePoint ? anchorAt(gesturePoint.x, gesturePoint.y) : defaultAnchor());
    if (!anchor) return false;
    const key = anchor.el.dataset.u || anchor.el.dataset.id, r = anchor.el.getBoundingClientRect();
    const P = r.top + anchor.frac * r.height, shift = [];
    const ok = (L) => {   // each level is placed so the anchor's point stays where it is on screen
      const c = caps[L];
      if (!c || c.key !== key0) return false;
      if (L === level) { shift[L] = W.scrollY + f.d0; return true; }
      const at = c.U.get(key);
      if (!at) return false;
      const s = clampTop(at.y + anchor.frac * at.h - P, c);
      if (s < c.lo || s + W.innerHeight > c.hi) return false;
      shift[L] = s;
      return true;
    };
    ok(level);
    let lo = level, hi = level;
    while (lo > 0 && ok(lo - 1) && pairReady(lo)) lo--;
    while (hi < 4 && ok(hi + 1) && pairReady(hi + 1)) hi++;
    if (pos < level ? lo === level : hi === level) return false;
    aimAnchor = null;
    stage = { el: anchor.el, key, shift, lo, hi, pair: null, last: level, sy: W.scrollY };
    busy = true;
    clearFocus(); hidePeek();
    rootEl.classList.add('morphing');
    clipStage();
    stageEl.classList.add('on');   // opaque: it covers the page, which stays as it is and is not painted again
    perf('stage', t0);
    if (window.__drPerf) window.__drPerf.push(['t.stage', performance.now()]);
    if (window.__drDrift) window.__drPerf.push(['beginDrift', stageDrift(level, shift[level])]);
    return true;
  }

  // Between two neighbouring levels: what each copy does as the position runs from the upper level (t = 0) to the
  // lower (t = 1), written as one paused animation per copy whose progress is the position. Moving an animation's
  // progress writes nothing into the document, so the page's observers (and browser extensions watching the page:
  // translators, ad blockers, which are let into a served page though not into a file) have nothing to process, and
  // each copy is a layer the GPU moves without drawing it again. Only copies whose path crosses the screen play.
  const SMOOTH = [0, 0.25, 0.5, 0.75, 1].map((x) => [x, x * x * (3 - 2 * x)]);   // smoothstep, sampled
  const fadeOut = (a, b) => [{ offset: 0, opacity: 1 }, ...SMOOTH.map(([x, y]) => ({ offset: a + (b - a) * x, opacity: 1 - y })), { offset: 1, opacity: 0 }];
  const fadeIn = (a, b) => [{ offset: 0, opacity: 0 }, ...SMOOTH.map(([x, y]) => ({ offset: a + (b - a) * x, opacity: y })), { offset: 1, opacity: 1 }];
  const STAY = [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 1 }];
  const tf = (x, y, sx, sy) => `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
  function enterPair(lo) {
    const s = stage, prev = s.pair, P = pairs[lo + 1];
    if (prev) {
      s.last = lo < prev.lo ? lo + 1 : lo;   // the level just crossed
      for (const an of prev.anims) an.cancel();   // its groups fall back to their resting state: hidden
      if (prev.P !== P) { prev.P.layer.classList.remove('live'); prev.P.layer.style.opacity = '0'; }
    }
    P.layer.classList.add('live');   // only the pair in play is rendered at all; the others skip style, paint and hit testing
    P.layer.style.opacity = '1';
    const A = caps[lo + 1], B = caps[lo], sa = s.shift[lo + 1], sb = s.shift[lo], H = W.innerHeight, anims = [];
    const seen = (y0, y1) => y1 > -120 && y0 < H + 120;
    const drift = (g) => { const a = g && A.U.get(g), b = g && B.U.get(g); return a && b ? [b.x - a.x, (b.y - sb) - (a.y - sa)] : [0, 0]; };
    const play = (el, from, to, fades) => {
      const an = el.animate([{ offset: 0, transform: from }, ...fades, { offset: 1, transform: to }], { duration: 1000, fill: 'both' });
      an.pause();
      anims.push(an);
    };
    for (const g of P.groups) {
      if (g.kind === 'move') {   // a group moving as one (scaled by k), from the upper level's place to the lower's
        if (!seen(Math.min(g.y0 - sa, g.k * g.y0 + g.dy - sb), Math.max(g.y1 - sa, g.k * g.y1 + g.dy - sb))) continue;
        play(g.el, tf(0, -sa, 1, 1), tf(g.dx, g.dy - sb, g.k, g.k), STAY);
      } else if (g.kind === 'out') {   // only above: it travels with its paragraph and fades in the first half
        if (!seen(g.y0 - sa, g.y1 - sa)) continue;   // seen only where it starts (gone before it would come into view)
        const [dx, dy] = drift(g.grp);
        play(g.el, tf(0, -sa, 1, 1), tf(dx, dy - sa, 1, 1), fadeOut(0, 0.5));
      } else if (g.kind === 'in') {   // only below: it arrives with its paragraph in the second half
        if (!seen(g.y0 - sb, g.y1 - sb)) continue;
        const [dx, dy] = drift(g.grp);
        play(g.el, tf(-dx, -dy - sb, 1, 1), tf(0, -sb, 1, 1), fadeIn(0.35, 1));
      } else {   // a copy whose type changes: it slides and scales between its two places, crossfading with its twin
        const { a, b } = g, ya = a.y - sa, yb = b.y - sb, me = g.side ? b : a;
        if (!seen(Math.min(ya, yb), Math.max(ya + a.h, yb + b.h) + 40)) continue;
        // text scales by its font size, centred on its line; a box takes the other box
        const ends = g.text
          ? [tf(a.x, ya + a.h / 2 - (me.h * a.st.fs / me.st.fs) / 2, a.st.fs / me.st.fs, a.st.fs / me.st.fs), tf(b.x, yb + b.h / 2 - (me.h * b.st.fs / me.st.fs) / 2, b.st.fs / me.st.fs, b.st.fs / me.st.fs)]
          : [tf(a.x, ya, a.w / me.w, a.h / me.h), tf(b.x, yb, b.w / me.w, b.h / me.h)];
        play(g.el, ...ends, g.side ? fadeIn(0.3, 0.6) : fadeOut(0.4, 0.7));
      }
    }
    s.pair = { lo, anims, P };
    if (window.__drPerf) window.__drPerf.push(['pair', lo, anims.length, P.groups.length, A.P.size + B.P.size]);
  }
  function stageFrame() {
    const s = stage;
    if (pos < s.lo - 1e-6 || pos > s.hi + 1e-6) {   // past the last keyframe: the live page carries on from there
      stageCommit(pos < s.lo ? s.lo : s.hi);
      stageOff = true;
      busy = false;
      return false;
    }
    const lo = Math.max(s.lo, Math.min(s.hi - 1, Math.floor(pos))), t = Math.min(1, Math.max(0, lo + 1 - pos));
    if (!s.pair || s.pair.lo !== lo) enterPair(lo);
    const near = Math.round(pos);
    if (s.chrome !== near) {   // the legend and the tagline follow the zoom (set on them: an attribute on <html> restyles everything)
      s.chrome = near;
      legend.style.display = near <= 2 ? 'flex' : 'none';
      tagline.style.display = near <= 2 ? 'none' : '';
    }
    const ms = t * 1000;
    for (const an of s.pair.anims) an.currentTime = ms;
    return true;
  }
  // the zoom came to rest on L: the page is drawn at L as its keyframe was and shown where the stage shows it
  function stageCommit(L) {
    const s = stage, t0 = performance.now();
    stage = null;
    if (s.pair) for (const an of s.pair.anims) an.cancel();
    if (L !== level) {
      const cap = caps[L];
      setLevelAttr(L);
      localLevel.clear();
      renderAll(cap.hot, cap.band);
      settleTransitions();
      const at = cap.U.get(s.key), r = visibleRect(s.el);
      if (at && r) W.scrollBy(0, r.top - (at.y - s.shift[L]));
      if (window.__drDrift) window.__drPerf.push(['commitDrift', L, stageDrift(L, s.shift[L])]);
    }
    for (const P of pairs) if (P) { P.layer.classList.remove('live'); P.layer.style.opacity = '0'; }
    legend.style.display = ''; tagline.style.display = '';
    stageEl.classList.remove('on');
    perf('commit', t0);
    if (window.__drPerf) window.__drPerf.push(['t.commit', performance.now()]);
  }
  // the reader scrolls, or the window changes, mid-zoom: the zoom lands on the nearest level at once
  function stageDrift(L, shift) {   // (measuring only: how far the copies sit from the page's own pieces)
    const errs = [];
    for (const [id, p] of caps[L].P) {
      if (p.kind === 'd' || errs.length > 400) continue;
      const el = docEl.querySelector(`[data-id="${CSS.escape(id)}"]`), r = el && visibleRect(el);
      if (!r || r.bottom < 0 || r.top > W.innerHeight) continue;
      errs.push(Math.max(Math.abs(r.left - p.x), Math.abs(r.top - (p.y - shift)), Math.abs(r.width - p.w), Math.abs(r.height - p.h)));
    }
    errs.sort((a, b) => a - b);
    return { n: errs.length, med: Math.round((errs[errs.length >> 1] || 0) * 100) / 100, max: Math.round((errs[errs.length - 1] || 0) * 100) / 100 };
  }
  function snapNow() {
    if (!stage) return;
    clearTimeout(snapTimer);
    holding = false;
    cancelAnimationFrame(rafId); rafId = 0; lastT = 0;
    pos = goal = Math.max(stage.lo, Math.min(stage.hi, Math.round(pos)));
    stageFrame();
    rest();
  }
  listen(ISDOC ? window : SCR, 'scroll', () => {
    lastScrollT = performance.now();
    if (stage && Math.abs(W.scrollY - stage.sy) > 1) snapNow();
    if (!busy) { hydrateSoon(); warmSoon(200); }   // a fifth of a second still: the reader stopped there
  }, { passive: true });
  listen(window, 'pointermove', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; if (level < 4 && !busy) warmSoon(); }, { passive: true });

  function toggleUnit(uid) {
    if (busy) return;
    const el = unitEl.get(uid);
    const r = el.getBoundingClientRect();
    morph(() => {
      if (localLevel.has(uid)) localLevel.delete(uid); else localLevel.set(uid, 4);
      renderUnit(uid, true);
    }, { el, y: r.top, frac: 0 });
  }

  function defaultAnchor() {
    const col = docEl.getBoundingClientRect();
    return anchorAt(col.left + Math.min(col.width / 2, 260), W.innerHeight * 0.38);
  }
  // ── chrome: the bar, the legend, the language ───────────────────────
  // The bar is a slider, in the manner of a segmented control: a raised thumb sits under the level, follows the
  // zoom position continuously, and follows the finger while dragged (dragging scrubs the zoom itself). On
  // release it springs to the nearer level. A click jumps.
  const thumb = h('span', 'zthumb');
  bar.append(thumb);
  BAR.forEach((L, i) => {
    if (i) bar.append(Object.assign(h('span', 'sep'), { textContent: '›' }));
    const b = h('button'); b.type = 'button'; b.dataset.l = L;
    b.title = `${i + 1}`;
    b.addEventListener('click', (e) => { if (e.detail === 0) setLevel(L); });   // the keyboard's Enter (pointer clicks: see pointerup)
    bar.append(b);
  });
  const barButtons = () => [...bar.querySelectorAll('button')];
  let geom = null;   // centres and sizes of the labels, measured once per layout
  function measureBar() {
    const bars = bar.getBoundingClientRect();
    geom = barButtons().map((b) => { const r = b.getBoundingClientRect(); return { l: +b.dataset.l, left: r.left - bars.left, width: r.width, centre: r.left + r.width / 2 }; });
  }
  function placeThumb() {
    if (!geom) measureBar();
    const i = 4 - pos, lo = Math.max(0, Math.min(4, Math.floor(i))), hi = Math.min(4, lo + 1), f = i - lo;
    const a = geom[lo], b = geom[hi];
    if (!a || !b) return;
    const x = a.left + (b.left - a.left) * f, w = a.width + (b.width - a.width) * f;
    thumb.style.transform = `translateX(${x}px)`;
    thumb.style.width = `${w}px`;
    const on = Math.round(pos);
    barButtons().forEach((btn) => btn.classList.toggle('on', +btn.dataset.l === on));
  }
  function posAt(x) {   // the zoom position under a point of the bar
    if (!geom) measureBar();
    const c = geom.map((g) => g.centre);
    if (x <= c[0]) return 4;
    if (x >= c[4]) return 0;
    const i = c.findIndex((v, k) => x >= v && x <= c[k + 1]);
    return 4 - i - (x - c[i]) / (c[i + 1] - c[i]);
  }
  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (busy && !tr && !stage)) return;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    measureBar();
    drag = { x0: e.clientX, moved: false };
    clearTimeout(snapTimer);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) > 3) { drag.moved = true; holding = true; aimLevel = null; gesturePoint = null; }
    if (drag.moved) { goal = posAt(e.clientX); kick(); }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    bar.classList.remove('dragging');
    if (moved) release(); else setLevel(Math.round(posAt(e.clientX)));   // a click on a label
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.setAttribute('role', 'slider');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '4');
  function updateBar() {
    barButtons().forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.l === level)));
    bar.setAttribute('aria-valuenow', String(level));
    bar.setAttribute('aria-valuetext', opts.labels[level]);
    if (opts.onLevel) opts.onLevel(level);
    placeThumb();
  }
  // ── input ────────────────────────────────────────────────────────────
  // ⌘/Ctrl + wheel and a trackpad pinch zoom around the pointer; over the slider, the plain wheel zooms
  listen(window, 'wheel', (e) => {
    const overBar = !!(e.target.closest && bar.contains(e.target));
    if (!e.ctrlKey && !e.metaKey && !overBar) { snapNow(); return; }
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? W.innerHeight : 1;
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
    zoomBy(-d / 240, overBar ? null : { x: e.clientX, y: e.clientY });
  }, { passive: false });
  let g0 = 0;     // Safari's pinch
  listen(window, 'gesturestart', (e) => { e.preventDefault(); g0 = goal; if (!tr && !stage) gesturePoint = { x: e.clientX, y: e.clientY }; holding = true; });
  listen(window, 'gesturechange', (e) => {
    e.preventDefault();
    if (busy && !tr && !stage) return;
    goal = Math.max(0, Math.min(4, g0 + Math.log(e.scale) * 2.4));
    kick();
  });
  listen(window, 'gestureend', (e) => { e.preventDefault(); release(); });
  // Veneta MemoAi: the stage covers the reader's column and the scroller only, not the rest of the application.
  function clipStage() {
    const s = ISDOC ? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight } : SCR.getBoundingClientRect(), d = docEl.getBoundingClientRect();
    const l = Math.max(s.left, d.left - 8), r = Math.min(s.right, d.right + 8);
    zhost.style.clipPath = `inset(${Math.max(0, s.top)}px ${Math.max(0, window.innerWidth - r)}px ${Math.max(0, window.innerHeight - s.bottom)}px ${Math.max(0, l)}px)`;
  }
  // ── start (Veneta MemoAi: TextFold's own start-up, without its chrome) ──
  let relayoutTimer = null;
  listen(window, 'resize', () => { snapNow(); capEpoch++; geom = null; placeThumb(); warmSoon(); });
  const editing = (node) => {
    if (!(node instanceof Element)) return false;
    if (node.closest('input, textarea, select, [role="textbox"], [role="dialog"], [role="combobox"], dialog')) return true;
    const editable = node.closest('[contenteditable]');
    return !!editable && editable.getAttribute('contenteditable') !== 'false';
  };
  listen(window, 'keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (editing(e.target) || editing(document.activeElement)) return;
    if (e.key === '-' || e.key === '_') setLevel(level - 1);
    else if (e.key === '=' || e.key === '+') setLevel(level + 1);
    else if (/^[1-5]$/.test(e.key)) setLevel(BAR[+e.key - 1]);
    else if (e.key === 'Escape' && localLevel.size) setLevel(level);
    else return;
    e.preventDefault();
  });
  docEl.addEventListener('click', (e) => {
    if (e.target.closest('a, details, summary')) return;
    if (level === 4 && !localLevel.size) return;
    if (String(getSelection()).length) return;
    const el = e.target.closest('.u');
    if (!el || !el.dataset.u) return;
    if (level === 0 && !localLevel.size) {
      const r = el.getBoundingClientRect();
      setLevel(2, { el, y: r.top, frac: 0 });
    } else toggleUnit(el.dataset.u);
  });
  build();
  IDS = [...order.keys()];
  {   // the Topic cards' rows (reader.css): a section with sections under it heads theirs, and one after a deeper one starts its own
    const lv = (c) => c.level || 2, top = Math.min(...D.chunks.map(lv));
    D.chunks.forEach((c, i) => {
      const sc = headEls.find((x) => x[0] === c), next = D.chunks[i + 1], prev = D.chunks[i - 1];
      if (!sc) return;
      const sec = sc[1].parentNode;
      if (next && lv(next) > lv(c) && (c.num || c.title)) sec.classList.add('parent', ...(lv(c) === top ? ['top'] : []));
      if (prev && lv(prev) > lv(c)) sec.classList.add('newrow');
    });
  }
  {   // a heading's place in reading order: the first unit after it
    let pend = [];
    for (const el of docEl.querySelectorAll('.hd, .u')) {
      if (el.classList.contains('hd')) pend.push(el);
      else { for (const hd of pend) HEAD_IDX.set(hd, order.get(el.dataset.u)); pend = []; }
    }
    for (const hd of pend) HEAD_IDX.set(hd, IDS.length - 1);
  }
  docEl.dataset.level = level;
  rootEl.dataset.level = level;
  pos = goal = level;
  renderHeads();
  opts.labels.forEach((name, L) => { const b = bar.querySelector(`button[data-l="${L}"]`); if (b) b.textContent = name; });
  renderAll();
  updateBar();
  if (document.fonts) {
    document.fonts.ready.then(() => { capEpoch++; geom = null; placeThumb(); warmSoon(30); });
    listen(document.fonts, 'loadingdone', () => { capEpoch++; warmSoon(); });
  }
  hydrateSoon();
  warmSoon(600);
  // The same units with other ladders (the AI levels arriving over the local ones): the page morphs to them.
  function setData(next) {
    const same = next.chunks.length === D.chunks.length && Object.keys(next.units).length === Object.keys(U).length
      && Object.keys(U).every((uid) => next.units[uid] && next.units[uid].toks.length === U[uid].toks.length);
    if (!same) return false;
    const apply = () => {
      for (const uid of Object.keys(U)) U[uid].lad = next.units[uid].lad;
      D.chunks.forEach((c, i) => { c.lad = next.chunks[i].lad; });
      renderHeads();
      capEpoch++;
      for (let L = 0; L < 5; L++) drop(L);
    };
    if (busy || tr || stage) { queued = () => setData(next); return true; }
    if (level === 4 && !localLevel.size) { apply(); warmSoon(); return true; }
    const hot = unitsNear(W.innerHeight * 1.5, W.innerHeight * 1.5);
    const band = level === 0 ? null : bandAround(defaultAnchor(), K_BAND[level] || 60, hot);
    morph(() => { apply(); renderAll(hot, band); }, defaultAnchor());
    return true;
  }
  function destroy() {
    for (const f of off) f();
    clearTimeout(warmTimer); clearTimeout(snapTimer); clearTimeout(hydrateTimer); clearTimeout(relayoutTimer);
    cancelAnimationFrame(rafId);
    for (const a of document.getAnimations()) { try { if (zroot.contains(a.effect && a.effect.target) || ghostEl.contains(a.effect && a.effect.target) || docEl.contains(a.effect && a.effect.target)) a.cancel(); } catch (_) { /* gone */ } }
    zhost.remove();
    rootEl.classList.remove('morphing');
  }
  const api = { setLevel, zoomBy, setData, destroy, get level() { return level; }, get pos() { return pos; }, get staged() { return !!stage; },
    get busy() { return busy; }, get keyframes() { return caps.map((c) => (c ? c.P.size : 0)); },
    scrubTo(p) { clearTimeout(snapTimer); holding = true; aimLevel = null; goal = Math.max(0, Math.min(4, p)); kick(); }, letGo() { release(); } };
  window.__reader = api;
  return api;
}
