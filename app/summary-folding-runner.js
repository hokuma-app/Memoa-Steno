'use strict';
// Content-free failure reasons the interface may show. Anything else is 'failed'.
const REASONS = new Set(['invalid_structure', 'too_long', 'provider_unavailable', 'invalid_request', 'timeout', 'failed']);
const MESSAGE = 'De detailniveaus konden niet worden voorbereid.';
const failure = reason => Object.assign(new Error(MESSAGE), { reason: REASONS.has(reason) ? reason : 'failed' });
// Local models on Apple silicon can take minutes for a long detailed summary
// with retries. The run ends after 15 minutes in total, or earlier when the
// backend reports no progress for 4 minutes (one hung model call).
const TOTAL_MS = 15 * 60 * 1000;
const IDLE_MS = 4 * 60 * 1000;
const PROGRESS = /^\{"progress": ?\{"done": ?(\d{1,4}), ?"total": ?(\d{1,4})\}\}$/;
function createSummaryFoldRunner({ getBackendPath, getBackendCwd, getEnv, spawn, killProcessTree, timeoutMs = TOTAL_MS, idleTimeoutMs = IDLE_MS }) {
  const active = new Set();
  const run = (request, { onProgress, local = false } = {}) => new Promise((resolve, reject) => {
    let child; let total; let idle; let settled = false;
    const finish = (reason, value) => {
      if (settled) return;
      settled = true; clearTimeout(total); clearTimeout(idle); active.delete(cancel);
      if (reason) reject(failure(reason)); else resolve(value);
    };
    const stop = reason => {
      if (settled) return;
      if (Number.isInteger(child?.pid) && child.pid > 0) { try { killProcessTree(child.pid); } catch (_) { /* Only own child. */ } }
      finish(reason);
    };
    const cancel = () => stop('failed');
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => stop('timeout'), idleTimeoutMs); };
    try {
      const input = JSON.stringify(request);
      if (Buffer.byteLength(input) > 262144) { finish('too_long'); return; }
      child = spawn(getBackendPath(), local ? ['summary-fold', '--local'] : ['summary-fold', '--progress'], { cwd: getBackendCwd(), env: getEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      active.add(cancel);
      total = setTimeout(() => stop('timeout'), timeoutMs);
      arm();
      const chunks = []; let bytes = 0; let stderr = 0; let pending = '';
      child.stdout.on('data', data => {
        if (settled) return;
        bytes += Buffer.byteLength(data);
        if (bytes > 4194304) cancel(); else chunks.push(Buffer.from(data));
      });
      // stderr carries only counter lines; anything else is discarded unread.
      child.stderr.on('data', data => {
        if (settled) return;
        stderr += Buffer.byteLength(data);
        if (stderr > 65536) { cancel(); return; }
        pending += Buffer.from(data).toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          const match = PROGRESS.exec(line.trim());
          if (!match) continue;
          const done = Number(match[1]); const all = Number(match[2]);
          if (all < 1 || done > all) continue;
          arm();
          try { onProgress?.({ done, total: all }); } catch (_) { /* Progress display is optional. */ }
        }
      });
      child.stdin.on('error', cancel);
      child.on('error', cancel);
      child.on('close', code => {
        if (settled) return;
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { finish('failed'); return; }
        if (code !== 0) { finish(typeof parsed?.reason === 'string' ? parsed.reason : 'failed'); return; }
        finish(null, parsed);
      });
      child.stdin.end(input);
    } catch (_) { cancel(); }
  });
  run.cancelAll = () => { for (const cancel of [...active]) cancel(); };
  run.timeouts = { totalMs: timeoutMs, idleMs: idleTimeoutMs };
  return run;
}
module.exports = { createSummaryFoldRunner, REASONS };
