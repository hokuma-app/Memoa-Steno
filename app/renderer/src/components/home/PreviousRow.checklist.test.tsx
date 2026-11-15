import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Meeting } from '@/lib/ipc';
import { resetNoteScores } from '@/modules/conversation-checklist/noteScores';
import { PreviousRow } from './PreviousRow';

const state = vi.hoisted(() => ({ enabled: true, noteScores: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ checklists: state }) }));
vi.mock('@/lib/router', () => ({ navigate: vi.fn() }));
vi.mock('@/lib/meetingsListContext', () => ({ useMeetingsList: () => null }));
const meeting = (over: Record<string, unknown> = {}) => ({ session_info: { name: 'Klantgesprek De Vries', summary_file: '/n/met_summary.md', processed_at: '2026-10-29T14:02:00Z', duration_seconds: 840 }, summary: 'Kort.', ...over }) as unknown as Meeting;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
beforeEach(() => {
  resetNoteScores(); state.enabled = true;
  state.noteScores.mockReset().mockResolvedValue({ success: true, scores: { '/n/met_summary.md': { title: 'Adviseur Gesprek', covered: 7, total: 8 } } });
});
afterEach(cleanup);

it('shows Checklist 7/8 on a recent note that has a checklist result', async () => {
  render(<PreviousRow meeting={meeting()} />);
  await settle();
  expect(screen.getByText('Checklist 7/8')).toBeTruthy();
});

it('shows no badge on a note without a result, on a live row, or while the module is off', async () => {
  const none = render(<PreviousRow meeting={meeting({ session_info: { name: 'Teamoverleg', summary_file: '/n/zonder_summary.md' } })} />);
  await settle(); expect(none.container.textContent).not.toContain('Checklist'); none.unmount();
  const live = render(<PreviousRow meeting={meeting({ is_recording: true })} />);
  await settle(); expect(live.container.textContent).not.toContain('Checklist'); live.unmount();
  state.enabled = false; resetNoteScores(); state.noteScores.mockClear();
  const off = render(<PreviousRow meeting={meeting()} />);
  await settle();
  expect(off.container.textContent).not.toContain('Checklist');
  expect(state.noteScores).not.toHaveBeenCalled();
});
