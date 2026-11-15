import re, sys
import os
SRC=os.path.join(os.environ.get('TEXTFOLD_SRC','textfold-src'),'textfold/web/reader.js')
OUT=sys.argv[1]
L=open(SRC,encoding='utf-8').read().split('\n')
def r(a,b): return '\n'.join(L[a-1:b])
RANGES=[]  # (ours description, a, b)
parts=[]
def seg(a,b,edits=()):
    t=r(a,b)
    for old,new in edits:
        if old not in t: sys.exit('edit not found in %d-%d: %r'%(a,b,old[:70]))
        t=t.replace(old,new)
    RANGES.append((a,b)); parts.append(t)

HEAD='''// TextFold reader, morphing word by word (FLIP, ghosts, the stage's keyframes, continuous zoom, the slider bar).
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
'''
parts.append(HEAD)
seg(117,126,[("    const z = trOf(u);\n    const l = z ? z.lad : u.lad;","    const l = u.lad;"),("    if (z) return { toks: z.toks, sents: z.sents, ev: u.lad.ev.filter((s) => s < z.sents.length), brief: l.brief, tn: l.tn, topic: l.topic, glue: l.glue, p: `${lang}~` };\n","")])
seg(127,352,[
 ("    const mk = marksFor(uid), mine = keepMine && mk && L > 0 && L < 4 ? [...new Set([...mk.exact, ...mk.soft])].sort((a, b) => a - b) : null;","    const mk = null, mine = null;"),
 ("    const fm = findMarks.get(uid);   // the words found (find in the text, below)\n    if (fm) for (const x of out) x.fd = fm.get(x.id) || 0;\n",""),
 ("  const atCls = (t) => (t.a ? (A[t.a].wrap ??= A[t.a].html.includes('ltx_cite')) ? ' at wrap' : ' at' : t.x ? ' at' : '');","  const atCls = (t) => (t.a ? ' at' : t.x ? ' at' : '');"),
 ("  const hlCls = (p) => (HL[p.hl] || '') + (p.hl && p.sh && p.sh !== 2 ? ` sh${p.sh}` : '');\n",""),
 ("  const fdCls = (p) => (p.fd ? (p.fd === 2 ? ' fd fdc' : ' fd') : '');\n",""),
 ("  let lastShade = SHADES.includes(+store.get('dr-shade')) ? +store.get('dr-shade') : 2;\n  const useShade = (s) => { if (SHADES.includes(s)) { lastShade = s; store.set('dr-shade', String(s)); } };\n",""),
])
seg(427,428)
seg(443,457)
seg(459,472,[("    const el = h(tag, `u ${u.role} r-${u.lad.role}${u.lad.model === 'local' ? ' is-local' : ''}${labeled ? ' numbered' : ''}`);","    const el = h(tag, `u ${u.role} r-${u.lad.role}${u.lad.model === 'local' ? ' is-local' : ''}${labeled ? ' numbered' : ''}`);")])
BUILD='''
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
'''
parts.append(BUILD)
seg(677,764,[("  const order = new Map();   // uid -> position in the paper\n","")])
seg(765,1073,[
 ("    if (!selbar.hidden) hideSelbar();\n    if (popNote) closeNote();\n    if (busy && !tr && !stage) return;","    if (busy && !tr && !stage) return;"),
 ("    if (!selbar.hidden) hideSelbar();\n    if (popNote) closeNote();\n    L = Math.max","    L = Math.max"),
])
seg(1074,1123,[
 ("  document.body.append(zhost);","  root.append(zhost);"),
 ("      if ([...rules].some((r) => r.selectorText === '.zstage')) walk(rules);","      if ([...rules].some((r) => r.selectorText === '.tf-root .zstage')) walk(rules);"),
 ("    const hosted = (sel) => sel.replace(/(^|[\\s,>+~(])(?:html|:root)((?:\\[[^\\]]*\\]|\\.[\\w-]+|:not\\([^)]*\\))*)(?=[\\s,>+~)]|$)/g,\n      (m, pre, q) => `${pre}:host${q ? `(${q})` : ''}`);","    const hosted = (sel) => sel.replace(/(^|[\\s,>+~(])\\.tf-root((?:\\[[^\\]]*\\])*)(?=[\\s,>+~)]|$)/g,\n      (m, pre, q) => `${pre}:host${q ? `(${q})` : ''}`);"),
 ("  function mirrorLang() { zhost.setAttribute('lang', document.documentElement.lang); zhost.dataset.lang = lang; }","  function mirrorLang() { zhost.setAttribute('lang', document.documentElement.lang); zhost.dataset.lang = lang; }"),
])
seg(1124,1133)
seg(1134,1678,[
 ("    const bs = getComputedStyle(document.body), pl = parseFloat(bs.paddingLeft) || 0;\n    sandEl.style.left = `${pl}px`;\n    sandEl.style.width = `${document.body.clientWidth - pl - (parseFloat(bs.paddingRight) || 0)}px`;","    const pr = docEl.parentElement.getBoundingClientRect();   // (TextFold: the body's content box)\n    sandEl.style.left = `${pr.left}px`;\n    sandEl.style.width = `${pr.width}px`;"),
 ("  addEventListener('scroll', () => {","  listen(ISDOC ? window : SCR, 'scroll', () => {"),
 ("    stageEl.classList.add('on');   // opaque: it covers the page, which stays as it is and is not painted again","    clipStage();\n    stageEl.classList.add('on');   // opaque: it covers the page, which stays as it is and is not painted again"),
 ("  addEventListener('pointermove', (e)","  listen(window, 'pointermove', (e)"),
])
seg(1691,1704,[("function toggleUnit","function toggleUnit")])
seg(4065,4137,[
 ("  const bar = document.getElementById('zoombar');\n",""),
 ("    findStale();\n    if (mapReady) { tview.hidden = level !== 0; mapSync(); savePosSoon(); }\n",""),
 ("    bar.setAttribute('aria-valuetext', T[ui].levels[level]);","    bar.setAttribute('aria-valuetext', opts.labels[level]);\n    if (opts.onLevel) opts.onLevel(level);"),
 ("  bar.addEventListener('pointerdown'","  bar.addEventListener('pointerdown'"),
])
seg(4482,4500,[
 ("  addEventListener('wheel', (e) => {\n    const overBar = !!(e.target.closest && e.target.closest('#zoombar'));","  listen(window, 'wheel', (e) => {\n    const overBar = !!(e.target.closest && bar.contains(e.target));"),
 ("  addEventListener('gesturestart'","  listen(window, 'gesturestart'"),
 ("  addEventListener('gesturechange'","  listen(window, 'gesturechange'"),
 ("  addEventListener('gestureend'","  listen(window, 'gestureend'"),
])
TAIL=open(sys.argv[2],encoding='utf-8').read()
body='\n'.join(p for p in parts[1:] if p)
# global replacements
body=re.sub(r'\bdocument\.documentElement\b','rootEl',body)
body=re.sub(r'(?<![.\w])scrollY\b','W.scrollY',body)
body=re.sub(r'(?<![.\w])innerHeight\b','W.innerHeight',body)
body=re.sub(r'window\.scrollBy\(','W.scrollBy(',body)
body=re.sub(r'(?<![.\w])scrollBy\(','W.scrollBy(',body)
open(OUT,'w',encoding='utf-8').write(HEAD+body+TAIL)
open(OUT+'.ranges','w').write(repr(RANGES))
