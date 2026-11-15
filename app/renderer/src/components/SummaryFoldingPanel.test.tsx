import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FoldDocument } from '@/lib/summaryFoldingContracts';
import { SummaryFoldingPanel } from './SummaryFoldingPanel';

const bridge = vi.hoisted(() => ({
  load: vi.fn(),
  local: vi.fn(),
  generate: vi.fn(),
  cancel: vi.fn(),
  onProgress: vi.fn(),
  progress: null as null | ((value: { done: number; total: number }) => void),
}));
const provider = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ summaryFolding: bridge, ai: { getProvider: provider.get } }) }));
// The reader itself needs a browser (animations, layout); its behaviour is proven in the Playwright specs.
vi.mock('@/modules/summary-folding/TextFoldReader', () => ({
  TextFoldReader: (props: { document: FoldDocument; bar: HTMLElement | null }) => (
    <div data-testid="reader" data-provenance={props.document.provenance} data-hash={props.document.sourceHash} data-bar={props.bar ? 'yes' : 'no'} />
  ),
}));

const make = (provenance: 'local' | 'ai'): FoldDocument => ({
  schemaVersion: 2,
  sourceHash: 'synthetic-hash',
  provenance,
  sections: [],
});
const flush = () => act(async () => {});
const note = <h2>Canonieke notitie</h2>;
const renderPanel = (props: { reportId?: string } = {}) =>
  render(
    <SummaryFoldingPanel summaryFile="synthetic.json" sourceRevision="one" {...props}>
      {note}
    </SummaryFoldingPanel>
  );

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  bridge.progress = null;
  bridge.load.mockResolvedValue({ success: true, document: null });
  bridge.local.mockResolvedValue({ success: true, document: make('local') });
  bridge.generate.mockReturnValue(new Promise(() => {}));
  bridge.cancel.mockResolvedValue({ success: true });
  provider.get.mockResolvedValue({ success: true, ai_provider: 'local' });
  bridge.onProgress.mockImplementation((cb: (value: { done: number; total: number }) => void) => {
    bridge.progress = cb;
    return () => {
      bridge.progress = null;
    };
  });
});

it('wires the whole Standard note (summary, topics and key points) into the panel', () => {
  const source = readFileSync('renderer/src/routes/MeetingDetail.tsx', 'utf8');
  expect(source).toContain('sourceRevision={JSON.stringify({ summary, discussionAreas, keyPoints })}');
  const start = source.indexOf('<SummaryFoldingPanel summaryFile={summaryFile} sourceRevision={JSON.stringify({ summary');
  const panel = source.slice(start, source.indexOf('</SummaryFoldingPanel>', start));
  expect(panel).toContain('{summaryAndTopics}');
  expect(panel).toContain('{keyPointsSection}');
  expect(panel).not.toContain('actionItems');
});

it('shows the note at once, then all five levels from the local document, without a button and with the model run behind it', async () => {
  let release: (value: unknown) => void = () => {};
  bridge.local.mockReturnValue(new Promise((resolve) => (release = resolve)));
  renderPanel();
  expect(screen.getByText('Canonieke notitie')).toBeTruthy();
  expect(screen.queryByTestId('reader')).toBeNull();
  await act(async () => release({ success: true, document: make('local') }));
  const reader = await screen.findByTestId('reader');
  expect(reader.getAttribute('data-provenance')).toBe('local');
  expect(screen.getByTestId('summary-folding-panel').getAttribute('data-provenance')).toBe('local');
  expect(screen.getByText(/voorlopig/i)).toBeTruthy();
  expect(bridge.generate).toHaveBeenCalledTimes(1);
  expect(bridge.generate).toHaveBeenCalledWith('synthetic.json');
  expect(bridge.cancel).not.toHaveBeenCalled();
});

it('shows a stored AI document directly: no local pass, no model run, no provisional note', async () => {
  bridge.load.mockResolvedValue({ success: true, document: make('ai') });
  renderPanel();
  expect((await screen.findByTestId('reader')).getAttribute('data-provenance')).toBe('ai');
  expect(bridge.local).not.toHaveBeenCalled();
  expect(bridge.generate).not.toHaveBeenCalled();
  expect(screen.queryByText(/voorlopig/i)).toBeNull();
});

it('hands the AI levels to the same reader when they are ready and then stops asking', async () => {
  let finish: (value: unknown) => void = () => {};
  bridge.generate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  renderPanel();
  await screen.findByTestId('reader');
  await act(async () => bridge.progress?.({ done: 2, total: 5 }));
  expect(screen.getByRole('status').textContent).toContain('stap 2 van 5');
  await act(async () => finish({ success: true, document: make('ai') }));
  await waitFor(() => expect(screen.getByTestId('reader').getAttribute('data-provenance')).toBe('ai'));
  expect(screen.queryByText(/voorlopig/i)).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  await flush();
  expect(bridge.generate).toHaveBeenCalledTimes(1);
});

it('keeps the local levels when preparing fails and shows only the content-free reason, without retrying by itself', async () => {
  bridge.generate.mockResolvedValue({ success: false, error: 'PRIVATE model text', reason: 'invalid_structure' });
  renderPanel();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('geen geldige structuur');
  expect(alert.textContent).not.toContain('PRIVATE');
  expect(screen.getByTestId('reader').getAttribute('data-provenance')).toBe('local');
  await flush();
  expect(bridge.generate).toHaveBeenCalledTimes(1);
});

it('does not alarm the reader when the host is busy: levels stay local and nothing is shown as an error', async () => {
  bridge.generate.mockResolvedValue({ success: false, error: 'x', reason: 'busy' });
  renderPanel();
  await screen.findByTestId('reader');
  await flush();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/voorlopig/i)).toBeTruthy();
});

it('keeps the canonical note and shows an alert when even the local levels cannot be made', async () => {
  bridge.local.mockResolvedValue({ success: false, error: 'x' });
  renderPanel();
  expect((await screen.findByRole('alert')).textContent).toContain('niet worden geladen');
  expect(screen.getByText('Canonieke notitie')).toBeTruthy();
  expect(screen.queryByTestId('reader')).toBeNull();
  expect(bridge.generate).not.toHaveBeenCalled();
});

it('cancels a running preparation when the note is closed', async () => {
  const view = renderPanel();
  await screen.findByTestId('reader');
  view.unmount();
  expect(bridge.cancel).toHaveBeenCalledTimes(1);
});

it('passes the selected report id through load, local levels and the background preparation', async () => {
  renderPanel({ reportId: 'custom-1' });
  await screen.findByTestId('reader');
  expect(bridge.load).toHaveBeenCalledWith('synthetic.json', 'custom-1');
  expect(bridge.local).toHaveBeenCalledWith('synthetic.json', 'custom-1');
  expect(bridge.generate).toHaveBeenCalledWith('synthetic.json', 'custom-1');
});

const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it('tries again later when the host was busy, until the levels are made, without alarming the reader', async () => {
  vi.useFakeTimers();
  try {
    bridge.generate.mockResolvedValueOnce({ success: false, error: 'x', reason: 'busy' })
      .mockResolvedValueOnce({ success: false, error: 'x', reason: 'busy' })
      .mockResolvedValueOnce({ success: true, document: make('ai') });
    renderPanel();
    await settle(0);
    expect(bridge.generate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    await settle(15000); expect(bridge.generate).toHaveBeenCalledTimes(2);
    await settle(15000); expect(bridge.generate).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('reader').getAttribute('data-provenance')).toBe('ai');
    await settle(120000); expect(bridge.generate).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});

it('stops retrying after a bounded number of busy answers and keeps the local levels', async () => {
  vi.useFakeTimers();
  try {
    bridge.generate.mockResolvedValue({ success: false, error: 'x', reason: 'busy' });
    renderPanel();
    await settle(0);
    await settle(15000 * 30);
    expect(bridge.generate).toHaveBeenCalledTimes(7);
    expect(screen.getByTestId('reader').getAttribute('data-provenance')).toBe('local');
    expect(screen.queryByRole('alert')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('does not retry after the note was closed', async () => {
  vi.useFakeTimers();
  try {
    bridge.generate.mockResolvedValue({ success: false, error: 'x', reason: 'busy' });
    const view = renderPanel();
    await settle(0);
    view.unmount();
    await settle(15000 * 10);
    expect(bridge.generate).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it.each(['remote', 'cloud', 'adapter'])('with a %s provider the AI levels are only made on an explicit button, never on opening', async (aiProvider) => {
  provider.get.mockResolvedValue({ success: true, ai_provider: aiProvider });
  renderPanel();
  expect((await screen.findByTestId('reader')).getAttribute('data-provenance')).toBe('local');
  await flush();
  expect(bridge.generate).not.toHaveBeenCalled();
  expect(screen.getByText(/gaat eenmalig naar de ingestelde AI-aanbieder/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'AI-niveaus maken' }));
  await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
  expect(bridge.generate).toHaveBeenCalledWith('synthetic.json');
});

it('removes the AI-niveaus button once the AI document is there, and passes the report id', async () => {
  provider.get.mockResolvedValue({ success: true, ai_provider: 'cloud' });
  bridge.generate.mockResolvedValue({ success: true, document: make('ai') });
  renderPanel({ reportId: 'custom-1' });
  await screen.findByTestId('reader');
  fireEvent.click(await screen.findByRole('button', { name: 'AI-niveaus maken' }));
  await waitFor(() => expect(screen.getByTestId('reader').getAttribute('data-provenance')).toBe('ai'));
  expect(bridge.generate).toHaveBeenCalledWith('synthetic.json', 'custom-1');
  expect(screen.queryByRole('button', { name: 'AI-niveaus maken' })).toBeNull();
});

it('treats an unknown provider as not local: no automatic model run', async () => {
  provider.get.mockResolvedValue({ success: false, error: 'x' });
  renderPanel();
  await screen.findByTestId('reader');
  await flush();
  expect(bridge.generate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'AI-niveaus maken' })).toBeTruthy();
});

it('does not show the button for a local provider and makes the levels by itself', async () => {
  renderPanel();
  await screen.findByTestId('reader');
  expect(bridge.generate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'AI-niveaus maken' })).toBeNull();
});
