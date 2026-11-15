import type { ElectronApplication } from '@playwright/test';
import type { LiveSegmentInput } from './live-transcript';

type Source = { finals: LiveSegmentInput[]; partials: LiveSegmentInput[] };

/** Model-free producer fixture: mirror main.js's buffer-before-broadcast contract.
 * A channel-only fixture loses one-shot packets when a portal remounts; production
 * exposes the retained source through get-live-transcript-state for that case.
 */
export async function emitBufferedLiveSegments(app: ElectronApplication, sessionName: string, segments: LiveSegmentInput[]) {
  await app.evaluate(({ ipcMain }, payload: { sessionName: string; segments: LiveSegmentInput[] }) => {
    if (process.env.STENOAI_E2E !== '1' || process.env.STENOAI_E2E_MOCK_IPC !== '1') {
      throw new Error('Synthetic source requires the owned model-free fixture');
    }
    const host = global as typeof global & { __syntheticChecklistSource?: Map<string, Source> };
    if (!host.__syntheticChecklistSource) {
      const sources = new Map<string, Source>();
      const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>> })._invokeHandlers;
      const original = registry.get('get-live-transcript-state');
      if (typeof original !== 'function') throw new Error('Missing source snapshot fixture');
      registry.set('get-live-transcript-state', async (...args: unknown[]) => {
        const base = await original(...args);
        const source = sources.get(base.sessionName as string);
        return source ? { ...base, segments: [...source.finals, ...source.partials], ready: true } : base;
      });
      host.__syntheticChecklistSource = sources;
    }
    const source = host.__syntheticChecklistSource.get(payload.sessionName) ?? { finals: [], partials: [] };
    for (const segment of payload.segments) {
      if (segment.isFinal) {
        source.finals.push(segment);
        source.finals.sort((a, b) => a.start - b.start);
        source.partials = source.partials.filter((item) => item.speaker !== segment.speaker || item.start > segment.end);
      } else {
        source.partials = [...source.partials.filter((item) => item.speaker !== segment.speaker), segment];
      }
    }
    host.__syntheticChecklistSource.set(payload.sessionName, source);
    // The host's own buffer and checklist planner see the same segments, as they do from the real sidecar.
    (global as typeof global & { __venetaLive?: { ingest(segments: LiveSegmentInput[]): void } }).__venetaLive?.ingest(payload.segments);
  }, { sessionName, segments });
  const mainWindow = await app.browserWindow(await app.firstWindow());
  await mainWindow.evaluate((window, payload: { sessionName: string; segments: LiveSegmentInput[] }) => {
    for (const segment of payload.segments) window.webContents.send('live-transcript-chunk', { sessionName: payload.sessionName, segment });
  }, { sessionName, segments });
}
