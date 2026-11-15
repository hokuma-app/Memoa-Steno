'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const plan = require('./build-veneta-0107.cjs').plan.map(step => ({
  ...step,
  args: step.args.map(arg => arg.replaceAll('veneta-0.10.7', 'veneta-0.11.0')
    .replace('electron-builder.veneta-0107.cjs', 'electron-builder.veneta-0110.cjs')),
}));
if (require.main === module) {
  const env = { ...process.env, VITE_VENETA_MEMOAI: '1', HF_HUB_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  for (const step of plan) {
    const result = spawnSync(step.command, step.args, { cwd: step.cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(path.join(root, '.local/veneta-0.11.0/mac-arm64/Veneta MemoAi.app'));
}
module.exports = { plan };
