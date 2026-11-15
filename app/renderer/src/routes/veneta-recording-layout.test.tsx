import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ veneta: true, recording: { status: 'recording' } as Record<string, unknown> }));
vi.mock('@/lib/productBrand', () => ({ get IS_VENETA_MEMOAI() { return state.veneta; } }));
vi.mock('@/hooks/useProductSettings', () => ({ useVenetaProfile: () => state.veneta, useModuleEnabled: () => state.veneta }));
const mounts = vi.hoisted(() => ({ count: 0, props: [] as unknown[] }));
vi.mock('@/modules/conversation-checklist/ChecklistRuntime', async () => {
  const React = await import('react');
  return { ChecklistRuntime: (props: Record<string, unknown>) => {
    mounts.props.push(props);
    React.useEffect(() => { mounts.count++; }, []);
    return <h2>Gesprekschecklist</h2>;
  } };
});
vi.mock('@/components/MeetingsShell', () => ({ MeetingsShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/MeetingLanguageSelect', () => ({ MeetingLanguageSelect: () => null }));
vi.mock('@/lib/router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useRecording', () => ({ useRecording: () => state.recording }));
vi.mock('@/hooks/useLiveMeeting', () => ({ useLiveMeeting: () => ({ active: true, title: 'Weekly sync', notes: 'Decisions', setNotes: vi.fn(), setTitle: vi.fn() }) }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ recording: { getLanguage: async () => ({ success: true, language: 'auto' }) } }) }));
import { Recording } from './Recording';
afterEach(cleanup);

describe('recording column contract', () => {
  it('mounts the checklist display once, without session or transcript props, whatever the recording poll reports (the host owns the identity and the plan)', () => {
    mounts.count = 0; mounts.props = [];
    state.recording = { status: 'recording', sessionName: 'Note', recordingId: null, recordingSummaryFile: '/Users/x/notes/../notes/a_summary.md', recordingTargetConfirmed: false };
    const view = render(<Recording />);
    for (const recording of [
      { status: 'recording', sessionName: 'Note', recordingId: '1001', recordingSummaryFile: null },
      { status: 'recording', sessionName: 'Note', recordingId: null, recordingSummaryFile: null },
      { status: 'recording', sessionName: 'Note', recordingId: '2002', recordingSummaryFile: '/private/notes/a_summary.md', recordingTargetConfirmed: true },
      { status: 'recording', sessionName: 'Andere', recordingId: null, recordingSummaryFile: null },
    ]) { state.recording = recording; view.rerender(<Recording />); expect(screen.getByRole('heading', { name: 'Gesprekschecklist' })).toBeTruthy(); }
    expect(mounts.count).toBe(1);
    expect(mounts.props.every((props) => Object.keys(props as object).length === 0)).toBe(true);
    state.recording = { status: 'recording' };
  });
  it('provides an independent real transcript slot beside accessible notes only for Veneta', () => {
    const { rerender } = render(<Recording />);
    expect(screen.getByRole('heading', { name: 'Gesprekschecklist' })).toBeTruthy();
    expect(document.getElementById('veneta-live-transcript-slot')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Mijn notities' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Mijn notities' })).toBeTruthy();
    state.veneta = false; rerender(<Recording />);
    expect(document.getElementById('veneta-live-transcript-slot')).toBeNull();
    expect(screen.getByText('My notes')).toBeTruthy();
    state.veneta = true;
  });
  it('scopes layout CSS and reserves a wide column with a narrow accessible sheet', () => {
    const css = readFileSync('renderer/src/veneta-layout.css', 'utf8');
    expect(css).toContain("html[data-product='veneta-memoai']");
    expect(css).toContain('@media (min-width: 1100px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('40vh');
    expect(css).not.toMatch(/position:\s*fixed/);
  });
});
