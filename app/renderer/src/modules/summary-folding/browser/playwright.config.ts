import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  outputDir: path.join(
    process.env.TMPDIR || path.join(os.homedir(), '.hermes/cache/scratch'),
    'summary-folding-browser-results'
  ),
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5196',
    browserName: 'chromium',
    channel: process.env.SUMMARY_FOLD_BROWSER_CHANNEL,
    headless: true,
  },
  webServer: {
    command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5196',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:5196/src/modules/summary-folding/browser/index.html',
    reuseExistingServer: false,
  },
});
