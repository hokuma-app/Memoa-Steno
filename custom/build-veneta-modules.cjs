'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function buildPlan() {
  return [
    { command: path.join(root, '.venv/bin/pyinstaller'), cwd: root,
      args: ['stenoai.spec', '--noconfirm', '--distpath', '.local/veneta-product-modules/backend',
        '--workpath', '.local/veneta-product-modules/pyinstaller'] },
    { command: 'npm', cwd: path.join(root, 'app'), args: ['run', 'build:renderer'] },
    { command: path.join(root, 'app/node_modules/.bin/electron-builder'), cwd: path.join(root, 'app'),
      args: ['--dir', '--mac', '--arm64', '--config', 'electron-builder.veneta-modules.cjs', '--publish', 'never'] },
  ];
}

if (require.main === module) {
  const env = { ...process.env, VITE_VENETA_MEMOAI: '1', HF_HUB_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  for (const step of buildPlan()) {
    const result = spawnSync(step.command, step.args, { cwd: step.cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(path.join(root, '.local/veneta-product-modules/mac-arm64/Veneta MemoAi.app'));
}
module.exports = { buildPlan };
