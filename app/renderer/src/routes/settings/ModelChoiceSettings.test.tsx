import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import type { ModelChoices } from '@/lib/modelChoiceContracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModelChoiceSettings } from './ModelChoiceSettings';

const bridge = vi.hoisted(() => {
  const listeners: { progress?: (e: { model: string; progress: string }) => void; complete?: (e: Record<string, unknown>) => void } = {};
  return {
    listeners,
    modelChoice: { list: vi.fn(), set: vi.fn(), preview: vi.fn(), test: vi.fn() },
    models: { pull: vi.fn(), cancelPull: vi.fn(), delete: vi.fn(), ackPullComplete: vi.fn() },
    on: {
      modelPullProgress: (cb: (e: { model: string; progress: string }) => void) => {
        listeners.progress = cb;
        return () => undefined;
      },
      modelPullComplete: (cb: (e: Record<string, unknown>) => void) => {
        listeners.complete = cb;
        return () => undefined;
      },
    },
  };
});
vi.mock('@/lib/ipc', () => ({ ipc: () => bridge }));

const entry = (over: Record<string, unknown>) => ({
  id: 'x', name: 'X', publisher: 'P', size_bytes: 4_300_000_000, license: 'Apache-2.0', source_url: 'https://example.org/x',
  hf_repo: '', functions: ['summary', 'summary_fold', 'checklist'], device_class: 'mac', status: 'aanbevolen', note: '',
  choice_name: 'x:1', pull_tag: 'x:1', pull_size_bytes: 4_300_000_000, installed: false, ...over,
});
function choices(over: Partial<ModelChoices> = {}): { success: true } & ModelChoices {
  return {
    success: true, provider: 'local', server_running: true, catalog_error: null, total_ram_gb: 16,
    functions: {
      summary: { choice: 'gemma4:e2b-it-qat', effective: 'gemma4:e2b-it-qat' },
      summary_fold: { choice: '', effective: 'gemma4:e2b-it-qat' },
      checklist: { choice: '', effective: 'gemma4:e2b-it-qat' },
    },
    installed: [
      { name: 'gemma4:e2b-it-qat', size_bytes: 4_336_358_185, format: 'gguf', quantization: 'Q4_0', parameter_size: '5B', functions: ['summary', 'summary_fold', 'checklist'] },
      { name: 'stub-extra:1b', size_bytes: 1_288_490_188, format: 'safetensors', quantization: 'nvfp4', parameter_size: '1B', functions: [] },
    ],
    catalog: [
      entry({ id: 'gemma4-e2b', name: 'Gemma 4 E2B', choice_name: 'gemma4:e2b-it-qat', pull_tag: 'gemma4:e2b-it-qat', device_class: 'klein', installed: true }),
      entry({ id: 'nemo-small', name: 'Nemo Klein', choice_name: 'hf.co/nvidia/n:Q4_K_M', pull_tag: 'hf.co/nvidia/n:Q4_K_M', device_class: 'klein', status: 'kandidaat' }),
      entry({ id: 'nemo-big', name: 'Nemo Groot', choice_name: '', pull_tag: '', status: 'kandidaat', pull_size_bytes: 21_000_000_000 }),
    ] as ModelChoices['catalog'],
    ...over,
  };
}
const user = { choices: choices() };
beforeEach(() => {
  user.choices = choices();
  bridge.modelChoice.list.mockImplementation(async () => structuredClone(user.choices));
  bridge.modelChoice.set.mockImplementation(async (fn: 'summary' | 'summary_fold' | 'checklist', name: string) => {
    user.choices.functions[fn] = { choice: name, effective: name || user.choices.functions.summary.effective };
    return { success: true, function: fn, choice: name, effective: user.choices.functions[fn].effective };
  });
  bridge.models.pull.mockResolvedValue({ success: true });
  bridge.models.cancelPull.mockResolvedValue({ success: true, error: null });
  bridge.models.delete.mockResolvedValue({ success: true, error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const open = async (fn: string) => {
  const row = await screen.findByTestId(`model-function-${fn}`);
  fireEvent.click(within(row).getByTestId(`model-change-${fn}`));
  return within(row);
};

describe('ModelChoiceSettings', () => {
  it('shows a row per function with the effective model, and same-as-summary for the other two', async () => {
    render(<ModelChoiceSettings />);
    expect((await screen.findByTestId('model-current-summary')).textContent).toBe('Gemma 4 E2B');
    expect(screen.getByTestId('model-current-checklist').textContent).toBe(t('models.sameAsSummaryNow', { model: 'Gemma 4 E2B' }));
    expect(screen.getByTestId('model-current-summary_fold').textContent).toContain('Gemma 4 E2B');
  });

  it('lists what is on this Mac (live) above the recommended models, with badges', async () => {
    render(<ModelChoiceSettings />);
    const picker = await open('checklist');
    const text = picker.getByTestId('model-picker-checklist').textContent ?? '';
    expect(text.indexOf(t('models.onThisMac'))).toBeLessThan(text.indexOf(t('models.recommended')));
    expect(picker.getByTestId('installed-stub-extra:1b').textContent).toContain('safetensors');
    expect(picker.getByTestId('installed-stub-extra:1b').textContent).toContain('nvfp4');
    expect(picker.queryByTestId('catalog-gemma4-e2b')).toBeNull();
    expect(within(picker.getByTestId('installed-gemma4:e2b-it-qat')).getByText(t('models.badgeSmall'))).toBeTruthy();
    expect(within(picker.getByTestId('catalog-nemo-small')).getByText(t('models.badgeSmall'))).toBeTruthy();
    expect(within(picker.getByTestId('catalog-nemo-small')).getByText(t('models.badgeCandidate'))).toBeTruthy();
    expect(picker.getByTestId('catalog-nemo-big').textContent).toContain(t('models.downloadNotDirect'));
  });

  it('chooses an installed model for exactly one function, and can return to same-as-summary', async () => {
    render(<ModelChoiceSettings />);
    const picker = await open('checklist');
    fireEvent.click(picker.getByRole('radio', { name: /stub-extra:1b/ }));
    await waitFor(() => expect(bridge.modelChoice.set).toHaveBeenCalledWith('checklist', 'stub-extra:1b'));
    expect(bridge.modelChoice.set).toHaveBeenCalledTimes(1);
    fireEvent.click(picker.getByLabelText(t('models.sameAsSummary')));
    await waitFor(() => expect(bridge.modelChoice.set).toHaveBeenLastCalledWith('checklist', ''));
  });

  it('the summary row has no same-as-summary option', async () => {
    render(<ModelChoiceSettings />);
    const picker = await open('summary');
    expect(picker.queryByLabelText(t('models.sameAsSummary'))).toBeNull();
  });

  it('downloads only after the click, then switches that function to the new model', async () => {
    render(<ModelChoiceSettings />);
    const picker = await open('summary_fold');
    expect(bridge.models.pull).not.toHaveBeenCalled();
    fireEvent.click(within(picker.getByTestId('catalog-nemo-small')).getByText(t('models.download')));
    await waitFor(() => expect(bridge.models.pull).toHaveBeenCalledWith('hf.co/nvidia/n:Q4_K_M'));
    act(() => bridge.listeners.progress?.({ model: 'hf.co/nvidia/n:Q4_K_M', progress: 'pulling model 40% (400/1000) [Part 1]' }));
    expect(picker.getByRole('progressbar')).toBeTruthy();
    await act(async () => {
      await bridge.listeners.complete?.({ model: 'hf.co/nvidia/n:Q4_K_M', success: true });
    });
    await waitFor(() => expect(bridge.modelChoice.set).toHaveBeenCalledWith('summary_fold', 'hf.co/nvidia/n:Q4_K_M'));
  });

  it('a cancelled download changes no choice', async () => {
    render(<ModelChoiceSettings />);
    const picker = await open('summary_fold');
    fireEvent.click(within(picker.getByTestId('catalog-nemo-small')).getByText(t('models.download')));
    await waitFor(() => expect(bridge.models.pull).toHaveBeenCalled());
    fireEvent.click(picker.getByText(t('models.cancel')));
    expect(bridge.models.cancelPull).toHaveBeenCalledWith('hf.co/nvidia/n:Q4_K_M');
    await act(async () => {
      await bridge.listeners.complete?.({ model: 'hf.co/nvidia/n:Q4_K_M', success: false, error: 'Cancelled', cancelled: true });
    });
    expect(bridge.modelChoice.set).not.toHaveBeenCalled();
    expect(await screen.findByText(t('models.downloadCancelled'))).toBeTruthy();
  });

  it('adds a model by name: validation first, the size shown, a download only on the explicit click', async () => {
    bridge.modelChoice.preview.mockResolvedValue({
      success: true, name: 'hf.co/org/repo:Q4_K_M', kind: 'hf', size_bytes: 1_932_735_283, installed: false,
      disk: { ok: true, free_bytes: 9e10, needed_bytes: 3e9 },
    });
    render(<ModelChoiceSettings />);
    const add = await screen.findByTestId('model-add');
    fireEvent.change(within(add).getByLabelText(t('models.add.label')), { target: { value: 'hf.co/org/repo:Q4_K_M' } });
    fireEvent.click(within(add).getByText(t('models.add.check')));
    await waitFor(() => expect(bridge.modelChoice.preview).toHaveBeenCalledWith('hf.co/org/repo:Q4_K_M'));
    expect((await within(add).findByTestId('model-add-status')).textContent).toMatch(/1[.,]9 GB/);
    expect(bridge.models.pull).not.toHaveBeenCalled();
    fireEvent.click(within(add).getByText(t('models.add.start', { model: 'hf.co/org/repo:Q4_K_M' })));
    await waitFor(() => expect(bridge.models.pull).toHaveBeenCalledWith('hf.co/org/repo:Q4_K_M'));
    expect(bridge.modelChoice.set).not.toHaveBeenCalled();
  });

  it('refuses a cloud name with its own message and offers no download', async () => {
    bridge.modelChoice.preview.mockResolvedValue({ success: false, reason: 'cloud' });
    render(<ModelChoiceSettings />);
    const add = await screen.findByTestId('model-add');
    fireEvent.change(within(add).getByLabelText(t('models.add.label')), { target: { value: 'gemma4:31b-cloud' } });
    fireEvent.click(within(add).getByText(t('models.add.check')));
    expect((await within(add).findByTestId('model-add-status')).textContent).toContain(t('models.reason.cloud'));
    expect(within(add).queryByText(/^Download /)).toBeNull();
    expect(bridge.models.pull).not.toHaveBeenCalled();
  });

  it('says so when the size is unknown, and blocks a download that does not fit the disk', async () => {
    bridge.modelChoice.preview.mockResolvedValueOnce({
      success: true, name: 'a:1', kind: 'ollama', size_bytes: null, installed: false, disk: { ok: true, free_bytes: 9e10, needed_bytes: 2e9 },
    });
    render(<ModelChoiceSettings />);
    const add = await screen.findByTestId('model-add');
    const input = within(add).getByLabelText(t('models.add.label'));
    fireEvent.change(input, { target: { value: 'a:1' } });
    fireEvent.click(within(add).getByText(t('models.add.check')));
    expect((await within(add).findByTestId('model-add-status')).textContent).toContain(t('models.sizeUnknown'));
    bridge.modelChoice.preview.mockResolvedValueOnce({
      success: true, name: 'big:1', kind: 'ollama', size_bytes: 9e10, installed: false, disk: { ok: false, free_bytes: 1e9, needed_bytes: 1e11 },
    });
    fireEvent.change(input, { target: { value: 'big:1' } });
    fireEvent.click(within(add).getByText(t('models.add.check')));
    await waitFor(() => expect(within(add).getByTestId('model-add-status').textContent).toContain(t('models.add.diskLow')));
    expect(within(add).queryByText(t('models.add.start', { model: 'big:1' }))).toBeNull();
  });

  it('cannot delete a model that a function uses; an unused one is deleted after confirmation', async () => {
    render(<ModelChoiceSettings />);
    const picker = await open('checklist');
    const inUse = picker.getByLabelText(t('models.delete', { model: 'gemma4:e2b-it-qat' })) as HTMLButtonElement;
    expect(inUse.disabled).toBe(true);
    fireEvent.click(picker.getByLabelText(t('models.delete', { model: 'stub-extra:1b' })));
    expect(bridge.models.delete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText(t('models.deleteConfirm')));
    await waitFor(() => expect(bridge.models.delete).toHaveBeenCalledWith('stub-extra:1b'));
  });

  it('shows the host refusal when a deletion is refused anyway', async () => {
    bridge.models.delete.mockResolvedValue({ success: false, error: 'x', reason: 'in_use', functions: ['checklist'] });
    render(<ModelChoiceSettings />);
    const picker = await open('checklist');
    fireEvent.click(picker.getByLabelText(t('models.delete', { model: 'stub-extra:1b' })));
    fireEvent.click(await screen.findByText(t('models.deleteConfirm')));
    expect(await screen.findByText(t('models.deleteFailed', { reason: t('models.reason.in_use') }))).toBeTruthy();
  });

  it('the trial runs only on click, per function, and reports validity, time and a reason', async () => {
    bridge.modelChoice.test.mockResolvedValueOnce({ success: true, function: 'checklist', model: 'm', valid: true, ms: 1234, reason: null });
    render(<ModelChoiceSettings />);
    await screen.findByTestId('model-function-checklist');
    expect(bridge.modelChoice.test).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('model-test-checklist'));
    await waitFor(() => expect(screen.getByTestId('model-test-result-checklist').textContent).toContain(t('models.yes')));
    expect(screen.getByTestId('model-test-result-checklist').textContent).toMatch(/1[.,]2 s/);
    expect(bridge.modelChoice.test).toHaveBeenCalledTimes(1);
    expect(bridge.modelChoice.test).toHaveBeenCalledWith('checklist');
    bridge.modelChoice.test.mockResolvedValueOnce({ success: true, function: 'summary', model: 'm', valid: false, ms: 800, reason: 'truncated' });
    fireEvent.click(screen.getByTestId('model-test-summary'));
    await waitFor(() => expect(screen.getByTestId('model-test-result-summary').textContent).toContain(t('models.testReason.truncated')));
    expect(screen.getByTestId('model-test-result-summary').textContent).toContain(t('models.no'));
  });

  it('with a non-local provider only explains and shows no rows', async () => {
    user.choices = choices({ provider: 'cloud' });
    render(<ModelChoiceSettings />);
    expect(await screen.findByText(t('models.localOnly'))).toBeTruthy();
    expect(screen.queryByTestId('model-function-summary')).toBeNull();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    bridge.modelChoice.list.mockRejectedValueOnce(new Error('x'));
    render(<ModelChoiceSettings />);
    fireEvent.click(await screen.findByText(t('models.retry')));
    expect(await screen.findByTestId('model-function-summary')).toBeTruthy();
  });

  it('keeps the other model list on this screen in step: a choice invalidates the shared model queries', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(<QueryClientProvider client={qc}><ModelChoiceSettings /></QueryClientProvider>);
    const picker = await open('summary');
    fireEvent.click(picker.getByRole('radio', { name: /stub-extra:1b/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['models'] }));
  });

  it('reloads when the older model list changes the shared model queries', async () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><ModelChoiceSettings /></QueryClientProvider>);
    await screen.findByTestId('model-function-summary');
    const before = bridge.modelChoice.list.mock.calls.length;
    await act(async () => { qc.setQueryData(['models', 'current'], { model: 'stub-extra:1b' }); });
    await waitFor(() => expect(bridge.modelChoice.list.mock.calls.length).toBeGreaterThan(before));
  });
});
