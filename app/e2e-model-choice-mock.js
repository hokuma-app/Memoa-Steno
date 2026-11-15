'use strict';
/**
 * T1 stand-in for the model-choice side of the backend CLI (STENOAI_E2E_MOCK_IPC=1 only).
 *
 * The real IPC module (model-choice-ipc.js) stays in the loop and talks to this object instead of
 * the Python CLI, so the renderer, the IPC validation and the persistence across an app restart
 * are real; only Ollama, the registry and the model are replaced by a stub state file in the
 * (temporary) user data directory. It reads the REAL catalogue file, so the badges and sizes shown
 * are the shipped ones. Nothing here pulls, deletes or runs a model.
 */
const fs = require('fs');
const path = require('path');

const FUNCTIONS = ['summary', 'summary_fold', 'checklist'];
const CLOUD = /(^|[:/_.-])cloud($|[:/_.-])/i;
const OLLAMA_NAME = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const HF_NAME = /^hf\.co\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;

function nameProblem(raw) {
  if (typeof raw !== 'string') return 'invalid';
  const name = raw.trim();
  if (!name) return 'empty';
  if (name.length > 200) return 'too_long';
  if (CLOUD.test(name)) return 'cloud';
  if (name.startsWith('hf.co/') ? !HF_NAME.test(name) : !OLLAMA_NAME.test(name)) return 'invalid';
  return null;
}

/** The shipped catalogue: the repository file in development, the copy inside the bundled backend in a
 *  package (this file then lives in app.asar, where `../src` does not exist). */
function catalogFile() {
  const repo = path.join(__dirname, '..', 'src', 'data', 'model_catalog.json');
  if (fs.existsSync(repo)) return repo;
  return path.join(process.resourcesPath || '', 'stenoai', '_internal', 'src', 'data', 'model_catalog.json');
}

const stateFile = () => path.join(process.env.STENOAI_USER_DATA_DIR, 'model-choice-e2e.json');
const STUB_TAGS = [
  { name: 'gemma4:e2b-it-qat', size_bytes: 4336358185, format: 'gguf', quantization: 'Q4_0', parameter_size: '5.1B' },
  { name: 'stub-extra:1b', size_bytes: 1288490188, format: 'safetensors', quantization: 'nvfp4', parameter_size: '1B' },
];

const save = (state) => fs.writeFileSync(stateFile(), JSON.stringify(state), { mode: 0o600 });
function load() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (_) {
    const fresh = { choices: { summary: 'gemma4:e2b-it-qat', summary_fold: '', checklist: '' }, installed: STUB_TAGS, pulls: [], tests: [] };
    save(fresh); // a first read lays the stub state down, so a spec can inspect it before any write
    return fresh;
  }
}
const effective = (state, fn) => state.choices[fn] || state.choices.summary;
const usersOf = (state, name) => FUNCTIONS.filter((fn) => effective(state, fn) === name);

function choices() {
  const state = load();
  const catalog = JSON.parse(fs.readFileSync(catalogFile(), 'utf8')).models;
  const names = new Set(state.installed.map((m) => m.name));
  return {
    success: true, provider: 'local', server_running: true, catalog_error: null,
    functions: Object.fromEntries(FUNCTIONS.map((fn) => [fn, { choice: state.choices[fn], effective: effective(state, fn) }])),
    installed: state.installed.map((m) => ({ ...m, functions: usersOf(state, m.name) })),
    catalog: catalog.map((e) => {
      const tag = e.ollama_tags.gguf || e.ollama_tags.nvfp4 || '';
      return {
        id: e.id, name: e.name, publisher: e.publisher, size_bytes: e.size_bytes, license: e.license, source_url: e.source_url,
        hf_repo: e.hf_repo, functions: e.functions, device_class: e.device_class, status: e.status, note: e.note,
        choice_name: tag, pull_tag: tag, pull_size_bytes: e.size_bytes, installed: Boolean(tag) && names.has(tag),
      };
    }),
  };
}

function setFunction(fn, name) {
  if (!FUNCTIONS.includes(fn)) return { success: false, reason: 'invalid_function' };
  if (name === '' && fn === 'summary') return { success: false, reason: 'empty' };
  if (name !== '') { const problem = nameProblem(name); if (problem) return { success: false, reason: problem }; }
  const state = load();
  state.choices[fn] = name.trim();
  save(state);
  return { success: true, function: fn, choice: state.choices[fn], effective: effective(state, fn) };
}

function preview(name) {
  const problem = nameProblem(name);
  if (problem) return { success: false, reason: problem, error: problem };
  const state = load();
  return {
    success: true, name: name.trim(), kind: name.trim().startsWith('hf.co/') ? 'hf' : 'ollama',
    size_bytes: /unknown/.test(name) ? null : 1_932_735_283, installed: state.installed.some((m) => m.name === name.trim()),
    disk: { ok: !/full/.test(name), free_bytes: 90_000_000_000, needed_bytes: 3_000_000_000 },
  };
}

function trial(fn) {
  const state = load();
  const model = effective(state, fn);
  const reason = process.env.STENOAI_E2E_MODEL_TEST_FAIL || null;
  state.tests.push(fn);
  save(state);
  return { success: true, function: fn, model, valid: !reason, ms: 1234, reason };
}

// Used by the mocked 'pull-model' channel: a download is recorded when it starts and the model
// only appears in the installed list when it finishes (a cancelled download leaves nothing).
function startPull(name) {
  const problem = nameProblem(name);
  if (problem) return { success: false, reason: problem };
  const state = load();
  state.pulls.push(name);
  save(state);
  return { success: true, model: name };
}

function finishPull(name) {
  const state = load();
  if (!state.installed.some((m) => m.name === name)) {
    state.installed.push({ name, size_bytes: 1_932_735_283, format: name.startsWith('hf.co/') ? 'gguf' : 'safetensors', quantization: 'Q4_K_M', parameter_size: '' });
  }
  save(state);
}

function removeModel(name) {
  const state = load();
  if (!state.installed.some((m) => m.name === name)) return { success: false, reason: 'not_installed', error: 'Refusing to delete unsupported model: ' + name };
  const functions = usersOf(state, name);
  if (functions.length) return { success: false, reason: 'in_use', functions, error: 'in_use' };
  state.installed = state.installed.filter((m) => m.name !== name);
  state.deleted = (state.deleted || []).concat(name);
  save(state);
  return { success: true, error: null };
}

async function runPythonScript(_script, args) {
  const [command, ...rest] = args;
  let result;
  if (command === 'model-choices') result = choices();
  else if (command === 'set-function-model') result = setFunction(rest[0], rest[1]);
  else if (command === 'model-add-preview') result = preview(rest[0]);
  else if (command === 'test-model-function') {
    const delay = Number(process.env.STENOAI_E2E_MODEL_TEST_MS || 0);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    result = trial(rest[0]);
  } else result = { success: false, reason: 'failed' };
  return JSON.stringify(result);
}

module.exports = { runPythonScript, startPull, finishPull, removeModel, load };
