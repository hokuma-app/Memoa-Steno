'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
function buildPlan() {
  return require('./build-veneta-modules.cjs').buildPlan().map(step => ({
    ...step,
    args: step.args.map(arg => arg.replaceAll('veneta-product-modules', 'veneta-summary-folding')
      .replace('electron-builder.veneta-modules.cjs', 'electron-builder.veneta-summary.cjs')),
  }));
}
if (require.main === module) {
  const env = { ...process.env, VITE_VENETA_MEMOAI: '1', HF_HUB_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  for (const step of buildPlan()) {
    const result = spawnSync(step.command, step.args, { cwd: step.cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(path.resolve(__dirname, '../.local/veneta-summary-folding/mac-arm64/Veneta MemoAi.app'));
}
module.exports = { buildPlan };
