'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Content-free failure reasons the interface may show (mirrors src/veneta_checklist.py MESSAGES).
const REASONS = new Set(['server_unreachable', 'server_start_failed', 'model_missing', 'model_not_local', 'timeout',
  'invalid_answer', 'empty_answer', 'not_json', 'wrong_shape', 'truncated', 'provider_not_local', 'invalid_request', 'config_invalid', 'failed']);
// Two bounded model rounds of up to 150 s each, one server start of up to 30 s, plus margin.
const DEFAULT_TIMEOUT_MS = 2 * 150000 + 30000 + 60000;

function createChecklistRunner({ getUserDataDir, getBackendPath, getBackendCwd, spawn, killProcessTree, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const active = new Set();
  const run = (request) => new Promise((resolve, reject) => {
    let requestFile; let child; let timer; let settled = false;
    const failure = (reason = 'failed') => Object.assign(new Error('De lokale checklistanalyse kon niet worden afgerond.'),
      { reason: REASONS.has(reason) ? reason : 'failed' });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(cancel);
      try { if (requestFile) fs.unlinkSync(requestFile); }
      catch (cleanup) { if (cleanup.code !== 'ENOENT') error = failure(); }
      if (error) reject(error); else resolve(value);
    };
    const stop = (reason) => {
      if (settled) return;
      if (Number.isInteger(child?.pid) && child.pid > 0) {
        try { killProcessTree(child.pid); } catch (_) { /* Only the owned process may be stopped. */ }
      }
      finish(failure(reason));
    };
    const cancel = () => stop('failed');
    try {
      const namespace = path.join(getUserDataDir(), 'veneta-modules');
      const directory = path.join(namespace, 'requests');
      for (const target of [namespace, directory]) {
        try {
          const stat = fs.lstatSync(target);
          if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure();
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      requestFile = path.join(directory, crypto.randomUUID() + '.json');
      const serialized = JSON.stringify(request);
      if (Buffer.byteLength(serialized, 'utf8') > 262144) throw failure();
      fs.writeFileSync(requestFile, serialized, { mode: 0o600, flag: 'wx' });
      child = spawn(getBackendPath(), ['checklist-evaluate', requestFile], { cwd: getBackendCwd() });
      active.add(cancel);
      const chunks = []; let outputBytes = 0; let errorBytes = 0;
      timer = setTimeout(() => stop('timeout'), timeoutMs);
      child.stdout.on('data', (data) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
        outputBytes += bytes.length;
        if (outputBytes > 262144) cancel(); else chunks.push(bytes);
      });
      child.stderr.on('data', (data) => {
        errorBytes += Buffer.byteLength(data);
        if (errorBytes > 65536) cancel();
      });
      child.on('error', () => finish(failure()));
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          let reason = 'failed';
          try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (body && typeof body.reason === 'string') reason = body.reason; }
          catch (_) { /* Unreadable diagnostics stay anonymous. */ }
          finish(failure(reason)); return;
        }
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_) { finish(failure()); }
      });
    } catch (_) { finish(failure()); }
  });
  run.cancelAll = () => { for (const cancel of [...active]) cancel(); };
  return run;
}

createChecklistRunner.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
module.exports = { createChecklistRunner, CHECKLIST_REASONS: REASONS };
