'use strict';
// Build only the explicitly selected Veneta presentation, never install/publish.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = path.join(root, 'app');
const backend = path.join(root, '.local/backend-memoa-r2/stenoai/stenoai');
if (!fs.existsSync(backend)) {
  throw new Error('Build the approved backend at .local/backend-memoa-r2 first.');
}
const env = { ...process.env, VITE_VENETA_MEMOAI: '1', HF_HUB_OFFLINE: '1' };
for (const [command, args] of [
  ['npm', ['run', 'build:renderer']],
  [path.join(app, 'node_modules/.bin/electron-builder'),
    ['--dir', '--mac', '--arm64', '--config', 'electron-builder.veneta.cjs', '--publish', 'never']],
]) {
  const result = spawnSync(command, args, { cwd: app, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(path.join(root, '.local/veneta-interface/mac-arm64/Veneta MemoAi.app'));
