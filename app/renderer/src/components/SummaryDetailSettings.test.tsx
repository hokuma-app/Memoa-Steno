import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SummaryDetailSettings } from './SummaryDetailSettings';
const bridge = vi.hoisted(() => ({ getSettings: vi.fn(), setSettings: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ summaryFolding: bridge }) }));
vi.mock('@/modules/summary-folding/SummaryDetailControl', () => ({
  SummaryDetailControl: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label="Samenvattingsdetail"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="brief">Beknopt</option>
      <option value="balanced">Gebalanceerd</option>
      <option value="detailed">Uitgebreid</option>
    </select>
  ),
}));
it('places future-summary detail after automatic notes and before the provider setting', () => {
  const source = readFileSync('renderer/src/routes/settings/AiTab.tsx', 'utf8');
  const section = source.slice(source.indexOf('function SummarisationSection()'));
  expect(section.indexOf('<SummaryDetailSettings />')).toBeGreaterThan(
    section.indexOf('onCheckedChange={(v) => setAutoSummarize.mutate(v)}')
  );
  expect(section.indexOf('<SummaryDetailSettings />')).toBeLessThan(
    section.indexOf("label={t('settingsAiTab.aiProvider')}")
  );
});
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  bridge.getSettings.mockResolvedValue({ success: true, summary_detail: 'detailed' });
});
it('hydrates the persisted detail without saving and is disabled before hydration', async () => {
  let finish!: (value: unknown) => void;
  bridge.getSettings.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<SummaryDetailSettings />);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.disabled).toBe(true);
  expect(select.value).toBe('detailed');
  await act(async () => finish({ success: true, summary_detail: 'balanced' }));
  expect(select.value).toBe('balanced');
  expect(select.disabled).toBe(false);
  expect(bridge.setSettings).not.toHaveBeenCalled();
  expect(screen.getByText(/Geldt alleen voor toekomstige/).textContent).toContain(
    'Bestaande notities worden niet gewijzigd'
  );
});
it.each(['brief', 'balanced', 'detailed'])(
  'persists %s once, locks while saving and retains the previous value on failure',
  async (next) => {
    bridge.getSettings.mockResolvedValue({
      success: true,
      summary_detail: next === 'detailed' ? 'brief' : 'detailed',
    });
    let finish!: (value: unknown) => void;
    bridge.setSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<SummaryDetailSettings />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    const previous = select.value;
    fireEvent.change(select, { target: { value: next } });
    expect(bridge.setSettings).toHaveBeenCalledExactlyOnceWith(next);
    expect(select.disabled).toBe(true);
    await act(async () => finish({ success: false, error: 'synthetic' }));
    expect(select.value).toBe(previous);
    expect(select.disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('vorige keuze blijft actief');
    fireEvent.change(select, { target: { value: next } });
    await act(async () => finish({ success: true, summary_detail: next }));
    expect(select.value).toBe(next);
    expect(screen.queryByRole('alert')).toBeNull();
  }
);
it('recovers from rejected hydration without enabling an unconfirmed default', async () => {
  bridge.getSettings.mockRejectedValueOnce(new Error('synthetic'));
  render(<SummaryDetailSettings />);
  await screen.findByRole('alert');
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
  await waitFor(() =>
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false)
  );
  expect(bridge.getSettings).toHaveBeenCalledTimes(2);
});
