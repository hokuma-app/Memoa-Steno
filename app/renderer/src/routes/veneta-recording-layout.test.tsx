import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ veneta: true }));
vi.mock('@/lib/productBrand', () => ({ get IS_VENETA_MEMOAI() { return state.veneta; } }));
vi.mock('@/components/MeetingsShell', () => ({ MeetingsShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/MeetingLanguageSelect', () => ({ MeetingLanguageSelect: () => null }));
vi.mock('@/lib/router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useRecording', () => ({ useRecording: () => ({ status: 'recording' }) }));
vi.mock('@/hooks/useLiveMeeting', () => ({ useLiveMeeting: () => ({ active: true, title: 'Weekly sync', notes: 'Decisions', setNotes: vi.fn(), setTitle: vi.fn() }) }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ recording: { getLanguage: async () => ({ success: true, language: 'auto' }) } }) }));
import { Recording } from './Recording';
afterEach(cleanup);

describe('recording column contract', () => {
  it('provides an independent real transcript slot beside accessible notes only for Veneta', () => {
    const { rerender } = render(<Recording />);
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
