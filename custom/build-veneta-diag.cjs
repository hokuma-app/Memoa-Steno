'use strict';
// Build plan for a diagnostic 0.10.0 package in its own folder: .local/veneta-0.10.0-diag-<n> (n from DIAG_N, default 1).
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const diag = `veneta-0.10.0-diag-${process.env.DIAG_N || '1'}`;
function buildPlan() {
  return require('./build-veneta-summary.cjs').buildPlan().map(step => ({
    ...step,
    args: step.args.map(arg => arg.replaceAll('veneta-summary-folding', diag)
      .replace('electron-builder.veneta-summary.cjs', `electron-builder.veneta-0100-diag${process.env.DIAG_N || '1'}.cjs`)),
  }));
}
if (require.main === module) {
  const env = { ...process.env, VITE_VENETA_MEMOAI: '1', HF_HUB_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  for (const step of buildPlan()) {
    const result = spawnSync(step.command, step.args, { cwd: step.cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(path.resolve(__dirname, `../.local/${diag}/mac-arm64/Veneta MemoAi.app`));
}
module.exports = { buildPlan };
