import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Oracle test: the same synthetic content in TextFold's own reader (a local clone, TEXTFOLD_SRC) and in the
 * Veneta module. Both run the same transitions; the pieces that slide, fade out (ghosts) and appear are counted
 * the same way in both, and frames are written for looking at. Skipped without the clone.
 */
const SRC = process.env.TEXTFOLD_SRC || path.join(os.homedir(), '.hermes/cache/scratch/textfold-src');
const OUT = process.env.FOLD_ORACLE_OUT || path.join(process.env.TMPDIR || os.tmpdir(), 'fold092', 'oracle');
const WEB = path.join(SRC, 'textfold', 'web');
const SEQUENCE = [4, 3, 2, 1, 0, 1, 2, 3, 4];
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const NAMES = ['Onderwerpen', 'Kernzin', 'Kern', 'Beknopt', 'Volledig'];

type Rec = { from: number; to: number; counts?: { moved: number; ghosts: number; before: number; after: number } | null; kinds?: unknown; staged?: boolean; pairs?: unknown[][] };
interface W {
  __reader: { scrubTo(p: number): void; letGo(): void; setLevel(l: number): void; staged: boolean };
  __drPerf: unknown[][];
  __fold: { toPaperData(doc: unknown): unknown; docs: { local: unknown } };
}
test.skip(!fs.existsSync(path.join(WEB, 'reader.js')), 'TextFold clone not available');
test.setTimeout(240_000);

function oraclePage(paper: unknown) {
  const read = (f: string) => fs.readFileSync(path.join(WEB, f), 'utf8');
  const data = {
    meta: { id: 'oracle', title: 'Synthetisch overleg', name: 'Synthetisch overleg', authors: [], lang: 'en', source: { kind: 'markdown' } },
    atoms: {}, bib: '', edges: [], alias: {}, app: false, langs: { en: 'English' }, katex: null, mermaid: null,
    ...(paper as object),
  };
  let html = read('template.html');
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  html = html.replace('{{TITLE}}', 'oracle').replace('{{CLASS}}', 'static').replace('{{SIDEBAR}}', '')
    .replace('{{HEAD}}', () => `<style>${read('reader.css')}</style><style>.topbar,.paper-head,.zoom .hint,.madewith{display:none !important}</style>`)
    .replace('{{SCRIPTS}}', () => `<script>${read('i18n.js')}</script><script>${read('reader.js')}</script>`)
    .replace('{{DATA}}', () => json);
  const file = path.join(OUT, 'textfold-oracle.html');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, html);
  return file;
}

const CLASSIFY = `(() => {
  const out = { move: 0, in: 0, out: 0, other: 0, total: 0, transformed: 0 };
  for (const a of document.getAnimations()) {
    if (!a.effect || !a.effect.getKeyframes || a.constructor.name !== 'Animation') continue;
    const kf = a.effect.getKeyframes();
    const t = kf.some((k) => k.transform && k.transform !== 'none');
    const o = kf.map((k) => (k.opacity === undefined ? null : Number(k.opacity)));
    out.total++;
    if (t) out.transformed++;
    if (o.length && o[0] === 0 && o[o.length - 1] === 1) out.in++;
    else if (o.length && o[0] === 1 && o[o.length - 1] === 0) out.out++;
    else if (t) out.move++;
    else out.other++;
  }
  return out;
})()`;

async function settle(page: Page, ms = 2600) {
  await page.waitForTimeout(ms);
}

async function run(page: Page, label: string) {
  const frames: Record<string, string> = {};
  const live: Rec[] = [];
  const stage: Rec[] = [];
  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  // 1. live path: transitions straight after load, before any keyframe was prepared; counts from the motion itself
  for (let i = 0; i < SEQUENCE.length - 1; i++) {
    const [from, to] = [SEQUENCE[i], SEQUENCE[i + 1]];
    await page.evaluate(() => { (window as unknown as W).__drPerf = []; });
    await page.evaluate((p) => (window as unknown as W).__reader.scrubTo(p), from + (to < from ? -0.5 : 0.5));
    await page.waitForTimeout(450);
    const counts = await page.evaluate(() => ((window as unknown as W).__drPerf as unknown[][]).filter((e) => e[0] === 'counts').map((e) => e[1]));
    const kinds = await page.evaluate(CLASSIFY);
    const staged = await page.evaluate(() => (window as unknown as W).__reader.staged);
    live.push({ from, to, counts: (counts[0] ?? null) as Rec['counts'], kinds, staged });
    await page.evaluate((l) => (window as unknown as W).__reader.scrubTo(l), to);
    await page.evaluate(() => (window as unknown as W).__reader.letGo());
    await page.waitForTimeout(250);
  }
  // 2. the stage: keyframes prepared while still, then the same transitions frame by frame
  await page.evaluate(() => (window as unknown as W).__reader.scrubTo(4)); await page.evaluate(() => (window as unknown as W).__reader.letGo());
  await settle(page, 3500);
  for (let i = 0; i < SEQUENCE.length - 1; i++) {
    const [from, to] = [SEQUENCE[i], SEQUENCE[i + 1]];
    await settle(page, 1800);
    await page.evaluate(() => { (window as unknown as W).__drPerf = []; });
    for (const f of FRACTIONS) {
      const p = from + (to - from) * f;
      await page.evaluate((v) => (window as unknown as W).__reader.scrubTo(v), p);
      await page.waitForTimeout(120);
      if (f === 0.5) {
        const kinds = await page.evaluate(CLASSIFY);
        const staged = await page.evaluate(() => (window as unknown as W).__reader.staged);
        const pairs = await page.evaluate(() => ((window as unknown as W).__drPerf as unknown[][]).filter((e) => e[0] === 'pair'));
        stage.push({ from, to, staged, kinds, pairs });
      }
      const file = path.join(dir, `${i + 1}-${NAMES[from]}-${NAMES[to]}-${Math.round(f * 100)}.png`);
      await page.screenshot({ path: file });
      frames[`${from}>${to}@${f}`] = file;
    }
    await page.evaluate(() => (window as unknown as W).__reader.letGo());
  }
  return { live, stage, frames };
}

test('same words move, fade and appear in TextFold and in the Veneta module', async ({ browser }) => {
  // our page first: it also gives the paper data in TextFold's shape
  let ours = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await ours.addInitScript(() => { (window as unknown as W).__drPerf = []; });
  await ours.goto('/src/modules/summary-folding/browser/index.html');
  await ours.waitForFunction(() => !!(window as unknown as W).__reader && !!(window as unknown as W).__fold);
  const paper = await ours.evaluate(() => (window as unknown as W).__fold.toPaperData((window as unknown as W).__fold.docs.local));
  const file = oraclePage(paper);
  const theirs = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await theirs.addInitScript(() => { (window as unknown as W).__drPerf = []; });
  await theirs.goto('file://' + file);
  await theirs.waitForFunction(() => !!(window as unknown as W).__reader);
  await theirs.waitForTimeout(500);
  const width = async (p: Page, sel: string) => p.evaluate((s) => document.querySelector(s)!.getBoundingClientRect().width, sel);
  await theirs.evaluate(() => window.scrollTo(0, 0));
  const top = await theirs.evaluate(() => document.getElementById('doc')!.getBoundingClientRect().top);
  await ours.evaluate((t) => { (document.querySelector('[data-testid=column]') as HTMLElement).style.paddingTop = t + 'px'; window.scrollTo(0, 0); }, top);
  const LAYOUT = `[...document.querySelectorAll('.u, .hd')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.u || e.dataset.id, Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; })`;
  const layoutTheirs: (string | number)[][] = await theirs.evaluate(LAYOUT);
  const layoutOurs: (string | number)[][] = await ours.evaluate(LAYOUT);
  const layoutDiff = layoutTheirs.map((a, i) => [a[0], a.slice(1).map((v, k) => Number(v) - Number(layoutOurs[i][k + 1]))]).filter(([, d]) => (d as number[]).some((v) => v !== 0)).slice(0, 8);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'layout-diff.json'), JSON.stringify({ n: [layoutTheirs.length, layoutOurs.length], first: layoutTheirs.slice(0, 3), firstOurs: layoutOurs.slice(0, 3), layoutDiff }, null, 1));
  const widths = { theirs: await width(theirs, '#doc'), ours: await width(ours, '.tf-root .doc') };
  const resultTheirs = await run(theirs, 'textfold');
  await ours.close();
  ours = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await ours.addInitScript(() => { (window as unknown as W).__drPerf = []; });
  await ours.goto('/src/modules/summary-folding/browser/index.html');
  await ours.waitForFunction(() => !!(window as unknown as W).__reader);
  await ours.evaluate((t) => { (document.querySelector('[data-testid=column]') as HTMLElement).style.paddingTop = t + 'px'; window.scrollTo(0, 0); }, top);
  await ours.waitForTimeout(500);
  const resultOurs = await run(ours, 'veneta');
  fs.writeFileSync(path.join(OUT, 'oracle-results.json'), JSON.stringify({ widths, theirs: resultTheirs, ours: resultOurs }, null, 1));
  // The pieces on the page at every level, as the reader keeps them (data-id), whole document: what stays, fades and appears
  // between two levels follows from them alone, and is the same for both readers when they run the same data.
  const IDS = `[...document.querySelectorAll('.doc [data-id]')].filter((e) => !e.closest('[hidden]') && !e.dataset.id.startsWith('ph:')).map((e) => e.dataset.id)`;
  const levels = async (p: Page) => {
    const sets: Record<number, string[]> = {};
    for (const L of [4, 3, 2, 1, 0]) {
      await p.evaluate((l) => (window as unknown as W).__reader.setLevel(l), L);
      await p.waitForTimeout(2200);
      sets[L] = await p.evaluate(IDS);
    }
    return sets;
  };
  const idsTheirs = await levels(theirs);
  const idsOurs = await levels(ours);
  // Only units drawn as tokens in both pages are compared (TextFold draws the ones near the reader as tokens, the rest as text).
  const unitOf = (id: string) => (id.startsWith('dot:') ? id.slice(4) : id.startsWith('h:') || id.startsWith('st:') ? 'chunk-' + id.split(':')[1] : id.split(':')[0]);
  const group = (ids: string[]) => { const m = new Map<string, string[]>(); for (const id of ids) { const k = unitOf(id); (m.get(k) ?? m.set(k, []).get(k)!).push(id); } return m; };
  const compared = new Map<number, string[]>();
  const sizes: Record<number, number[]> = {};
  const transitions = (mine: Record<number, string[]>, keep: Set<string>) => SEQUENCE.slice(0, -1).map((from, i) => {
    const to = SEQUENCE[i + 1];
    const sel = (L: number) => new Set(mine[L].filter((id) => keep.has(unitOf(id))));
    const a = sel(from), b = sel(to);
    return { from, to, stay: [...a].filter((x) => b.has(x)).length, out: [...a].filter((x) => !b.has(x)).length, in: [...b].filter((x) => !a.has(x)).length };
  });
  let keep: Set<string> | null = null;
  for (const L of [4, 3, 2, 1, 0]) {
    const gt = group(idsTheirs[L]), go = group(idsOurs[L]);
    const drawn = (m: Map<string, string[]>, k: string) => (m.get(k) ?? []).some((id) => !id.startsWith('dot:'));
    const both = [...gt.keys()].filter((k) => drawn(gt, k) && drawn(go, k));
    compared.set(L, both);
    keep = new Set(keep ? both.filter((k) => keep!.has(k)) : both);
    sizes[L] = [idsTheirs[L].length, idsOurs[L].length];
    for (const k of both) expect([...go.get(k)!].sort(), `level ${L}, ${k}`).toEqual([...gt.get(k)!].sort());
  }
  const shared = keep!;
  expect(shared.size).toBeGreaterThan(8);
  const tt = transitions(idsTheirs, shared), to = transitions(idsOurs, shared);
  fs.writeFileSync(path.join(OUT, 'oracle-transitions.json'), JSON.stringify({ unitsCompared: shared.size, textfold: tt, veneta: to, sizes }, null, 1));
  expect(to).toEqual(tt);
  // the stage: keyframes were ready for every transition in both, with the same number of pairs
  expect(resultOurs.stage.map((x: Rec) => [x.from, x.to, x.staged])).toEqual(resultTheirs.stage.map((x: Rec) => [x.from, x.to, x.staged]));
  expect(resultOurs.stage.every((x: Rec) => x.staged)).toBe(true);
  await ours.close(); await theirs.close();
});

test('continuous zoom: the same wheel, pinch and key input ends at the same level in TextFold and in the Veneta module', async ({ browser }) => {
  const ours = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await ours.goto('/src/modules/summary-folding/browser/index.html');
  await ours.waitForFunction(() => !!(window as unknown as W).__reader);
  const paper = await ours.evaluate(() => (window as unknown as W).__fold.toPaperData((window as unknown as W).__fold.docs.local));
  const theirs = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await theirs.goto('file://' + oraclePage(paper));
  await theirs.waitForFunction(() => !!(window as unknown as W).__reader);
  const CASES: { name: string; start: number; wheel: number[]; ctrl?: boolean; keys?: string[] }[] = [
    { name: 'a short roll stops half way and springs back', start: 4, wheel: [60] },
    { name: 'a longer roll crosses one level', start: 4, wheel: [220] },
    { name: 'a long roll crosses several levels', start: 4, wheel: [220, 220, 220] },
    { name: 'rolling back turns round half way', start: 2, wheel: [160, -330] },
    { name: 'a pinch (ctrl + wheel) zooms in', start: 2, wheel: [-300], ctrl: true },
    { name: 'the keys 1 to 5 jump', start: 4, wheel: [], keys: ['5', '2', '4'] },
  ];
  const results: Record<string, { theirs: string; ours: string }> = {};
  for (const c of CASES) {
    const end: string[] = [];
    for (const page of [theirs, ours]) {
      await page.evaluate((l) => (window as unknown as W).__reader.setLevel(l), c.start);
      await page.waitForTimeout(1800);
      // the wheel events of one gesture in one frame, as a trackpad delivers a burst (deterministic for both readers)
      await page.evaluate(({ wheel, ctrl }) => {
        const bar = document.querySelector('.zoombar')!;
        const r = bar.getBoundingClientRect();
        for (const deltaY of wheel) bar.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: !!ctrl, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      }, { wheel: c.wheel, ctrl: c.ctrl });
      for (const k of c.keys ?? []) { await page.keyboard.press(k); await page.waitForTimeout(1500); }
      await page.waitForTimeout(1800);
      end.push(String(await page.locator('.zoombar').getAttribute('aria-valuenow')));
    }
    results[c.name] = { theirs: end[0], ours: end[1] };
  }
  fs.writeFileSync(path.join(OUT, 'oracle-zoom.json'), JSON.stringify(results, null, 1));
  for (const [name, r] of Object.entries(results)) expect(r.ours, name).toBe(r.theirs);
  await ours.close(); await theirs.close();
});
