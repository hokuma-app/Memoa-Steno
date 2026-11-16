#!/usr/bin/env node
// Snelle ontwikkellus: test alleen wat sinds de laatste volle suite is veranderd.
//
//   node custom/dev-snel.mjs            gerichte poort (dev-lus), doel: enkele minuten
//   node custom/dev-snel.mjs --t1       idem, plus de T1-specs die bij de wijziging horen
//   node custom/dev-snel.mjs --vol      volledige poort (release-lus); legt bij groen de basis vast
//
// De basis staat in .local/laatste-volle-suite.json (sha en tijd). Is die ouder dan 48 uur of
// ontbreekt hij, dan zegt de gerichte poort dat en adviseert --vol. Een pakket bouwen hoort
// altijd bij --vol: de gerichte poort is geen releasebewijs.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const app = path.join(root, 'app');
const baseFile = path.join(root, '.local', 'laatste-volle-suite.json');
const MAX_AGE_MS = 48 * 3600 * 1000;
const args = new Set(process.argv.slice(2));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const results = [];

function run(label, cmd, cmdArgs, cwd = root, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  const ok = r.status === 0;
  results.push({ label, ok, s: Math.round((Date.now() - t0) / 1000) });
  return ok;
}

function summary() {
  console.log('\n--- dev-snel ---');
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FOUT'} ${r.label} (${r.s} s)`);
  const ok = results.every((r) => r.ok);
  console.log(ok ? 'Groen.' : 'Rood.');
  return ok;
}

if (args.has('--vol')) {
  const npm = (s) => run(s, 'npm', ['--prefix', 'app', 'run', s]);
  run('python', path.join(root, '.venv/bin/python'), ['-m', 'unittest', 'discover', 'tests', '-q']);
  npm('test:unit:main'); npm('test:unit:renderer'); npm('typecheck:renderer'); npm('lint:main');
  npm('lint:i18n'); npm('i18n:inventory'); npm('lint:renderer');
  for (const [label, env] of [['t1 default', {}], ['t1 veneta', { VITE_VENETA_MEMOAI: '1' }]]) {
    run(`build ${label}`, 'npm', ['--prefix', 'app', 'run', 'build:renderer'], root, env);
    run(label, 'npx', ['cross-env', 'NODE_PATH=node_modules', 'playwright', 'test', '--config', '../e2e/playwright.config.ts', '--project=t1', '--reporter=line'], app);
  }
  // test:unit:main kent 5 tests die zonder gebouwde bin/steno-audio-encode altijd falen; die
  // tellen als bekend zolang dit de enige fouten zijn. Controleer dat bij rood met de hand.
  const ok = summary();
  if (ok && git('status', '--porcelain') === '') {
    fs.mkdirSync(path.dirname(baseFile), { recursive: true });
    fs.writeFileSync(baseFile, JSON.stringify({ sha: git('rev-parse', 'HEAD'), at: new Date().toISOString() }, null, 2));
    console.log(`Basis vastgelegd op ${git('rev-parse', '--short', 'HEAD')}.`);
  } else if (ok) console.log('Werkboom niet schoon: basis niet vastgelegd. Commit eerst.');
  process.exit(ok ? 0 : 1);
}

let base = null;
try { base = JSON.parse(fs.readFileSync(baseFile, 'utf8')); } catch { /* geen basis */ }
if (!base) { console.log('Geen volle suite vastgelegd. Draai eerst: node custom/dev-snel.mjs --vol'); process.exit(2); }
if (Date.now() - Date.parse(base.at) > MAX_AGE_MS) console.log(`Let op: volle suite is ouder dan 48 uur (${base.at}). Advies: --vol.`);

const changed = [...new Set([
  ...git('diff', '--name-only', base.sha).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean))];
if (!changed.length) { console.log(`Niets veranderd sinds ${base.sha.slice(0, 7)}.`); process.exit(0); }
console.log(`${changed.length} bestand(en) veranderd sinds ${base.sha.slice(0, 7)}.`);

const renderer = changed.filter((f) => f.startsWith('app/renderer/src/') && /\.(tsx?|css)$/.test(f));
const mainJs = changed.filter((f) => /^app\/[^/]+\.(c?js)$/.test(f));
const py = changed.filter((f) => /^(src|tests)\/.+\.py$|^simple_recorder\.py$/.test(f));
const specs = changed.filter((f) => /^e2e\/specs\/.+\.spec\.ts$/.test(f));

if (renderer.length) {
  run('typecheck', 'npm', ['--prefix', 'app', 'run', 'typecheck:renderer']);
  run('vitest related', 'npx', ['vitest', 'related', '--run', ...renderer.map((f) => path.relative(app, path.join(root, f)))], app);
  run('lint:i18n', 'npm', ['--prefix', 'app', 'run', 'lint:i18n']);
}
if (mainJs.length) {
  const tests = new Set();
  for (const f of mainJs) {
    const t = f.endsWith('.test.js') ? f : f.replace(/\.c?js$/, '.test.js');
    if (fs.existsSync(path.join(root, t))) tests.add(path.basename(t));
  }
  if (mainJs.includes('app/main.js')) run('lint:main', 'npm', ['--prefix', 'app', 'run', 'lint:main']);
  if (tests.size) run('node --test', 'node', ['--test', ...tests], app);
}
if (py.length) {
  const mods = py.filter((f) => f.startsWith('src/')).map((f) => path.basename(f, '.py'));
  const tests = new Set(py.filter((f) => f.startsWith('tests/')).map((f) => path.basename(f, '.py')));
  for (const t of fs.readdirSync(path.join(root, 'tests')).filter((f) => /^test_.*\.py$/.test(f))) {
    const body = fs.readFileSync(path.join(root, 'tests', t), 'utf8');
    if (mods.some((m) => body.includes(m))) tests.add(path.basename(t, '.py'));
  }
  if (tests.size) run('python', path.join(root, '.venv/bin/python'), ['-m', 'unittest', ...[...tests].map((t) => `tests.${t}`)]);
}
if (args.has('--t1')) {
  const keys = [...new Set(changed.map((f) => f.match(/modules\/([^/]+)\//)?.[1] ?? path.basename(f).split('.')[0]).filter((k) => k.length > 3))];
  const related = new Set(specs.map((f) => path.basename(f)));
  for (const s of fs.readdirSync(path.join(root, 'e2e/specs')).filter((f) => f.endsWith('.t1.spec.ts'))) {
    const body = fs.readFileSync(path.join(root, 'e2e/specs', s), 'utf8');
    if (keys.some((k) => s.includes(k) || body.includes(k))) related.add(s);
  }
  if (related.size) {
    run('build veneta', 'npm', ['--prefix', 'app', 'run', 'build:renderer'], root, { VITE_VENETA_MEMOAI: '1' });
    run(`t1 (${related.size} specs)`, 'npx', ['cross-env', 'NODE_PATH=node_modules', 'playwright', 'test', '--config', '../e2e/playwright.config.ts', '--project=t1', '--reporter=line', ...related], app);
  } else console.log('Geen T1-specs bij deze wijziging.');
}
process.exit(summary() ? 0 : 1);
