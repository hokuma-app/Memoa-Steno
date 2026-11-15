'use strict';
/**
 * Settings > AI > "Model per functie" (0.10.0): the IPC between the pickers and the backend CLI.
 *
 * Downloading and deleting keep their existing channels ('pull-model', 'cancel-pull',
 * 'delete-model'); the backend guards those. This module adds the list, the per-function choice,
 * the size preview of a typed name and the "Test dit model" trial. Every argument is validated
 * here too, so a compromised renderer cannot reach the CLI with an unchecked value.
 */
const FUNCTIONS = new Set(['summary', 'summary_fold', 'checklist']);
const NAME_MAX = 200;
const failure = (reason) => ({ success: false, reason });
// Same shape as the backend's own name check; the backend remains the authority.
const plainName = (value) => typeof value === 'string' && value.length <= NAME_MAX && !/[\u0000-\u001f\u007f]/.test(value);

function parseLast(text) {
  const lines = String(text).trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch (_) { /* log noise: try the line before */ }
  }
  throw new Error('Geen leesbaar antwoord van de backend.');
}

function registerModelChoiceIpc({ ipcMain, runPythonScript, sendDebugLog = () => {}, totalRamGb = () => undefined, isBusy = () => false }) {
  let probing = false;
  // Backend refusals arrive as a JSON line on stdout of a non-zero exit; surface them as results.
  const run = async (args) => {
    try {
      return parseLast(await runPythonScript('simple_recorder.py', args, true));
    } catch (error) {
      try {
        const parsed = parseLast(error.stdout || '');
        if (parsed && parsed.success === false) return parsed;
      } catch (_) { /* generic failure below */ }
      sendDebugLog(`Model choice command failed: ${args[0]}`);
      return failure('failed');
    }
  };

  ipcMain.handle('model-choices', async () => {
    const result = await run(['model-choices']);
    const ram = totalRamGb();
    return ram === undefined || !result.success ? result : { ...result, total_ram_gb: ram };
  });

  ipcMain.handle('model-choice-set', async (_event, fn, name) => {
    if (!FUNCTIONS.has(fn)) return failure('invalid_function');
    if (!plainName(name)) return failure('invalid');
    return run(['set-function-model', fn, name]);
  });

  ipcMain.handle('model-choice-preview', async (_event, name) => {
    if (!plainName(name) || !name.trim()) return failure(name === '' ? 'empty' : 'invalid');
    return run(['model-add-preview', name]);
  });

  // Explicit click only, local only, one at a time, never while a recording or processing runs.
  ipcMain.handle('model-choice-test', async (_event, fn) => {
    if (!FUNCTIONS.has(fn)) return failure('invalid_function');
    if (probing || isBusy()) return failure('busy');
    probing = true;
    try {
      return await run(['test-model-function', fn]);
    } finally {
      probing = false;
    }
  });
}

module.exports = { registerModelChoiceIpc, FUNCTIONS };
