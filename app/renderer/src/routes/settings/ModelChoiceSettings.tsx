import * as React from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { DownloadProgressBar } from '@/components/DownloadProgressBar';
import { IS_VENETA_MEMOAI } from '@/lib/productBrand';
import { t } from '@/i18n';
import { ipc } from '@/lib/ipc';
import {
  MODEL_FUNCTIONS,
  type AddPreviewResponse,
  type CatalogModel,
  type InstalledModel,
  type ModelChoices,
  type ModelFunction,
  type ModelTestResponse,
} from '@/lib/modelChoiceContracts';
import { COMPACT_BTN, COMPACT_INPUT } from './primitives';
import { parsePullPercent } from './model-card';
import { modelMayExceedMemory } from './model-memory';

/** Settings > AI > "Model per functie": a model per function, a live list, recommendations and
 *  adding a model. Downloads and deletions run only after an explicit click; the trial button
 *  runs an invented conversation through one function and never on its own. */

const REFUSAL: Record<string, () => string> = {
  cloud: () => t('models.reason.cloud'),
  invalid: () => t('models.reason.invalid'),
  empty: () => t('models.reason.empty'),
  too_long: () => t('models.reason.too_long'),
  disk_full: () => t('models.reason.disk_full'),
  in_use: () => t('models.reason.in_use'),
  not_installed: () => t('models.reason.not_installed'),
  invalid_function: () => t('models.reason.invalid_function'),
  save_failed: () => t('models.reason.save_failed'),
  busy: () => t('models.reason.busy'),
  failed: () => t('models.reason.failed'),
};
const TEST_REASON: Record<string, () => string> = {
  server_unreachable: () => t('models.testReason.server_unreachable'),
  server_start_failed: () => t('models.testReason.server_start_failed'),
  model_missing: () => t('models.testReason.model_missing'),
  model_not_local: () => t('models.testReason.model_not_local'),
  timeout: () => t('models.testReason.timeout'),
  invalid_answer: () => t('models.testReason.invalid_answer'),
  invalid_structure: () => t('models.testReason.invalid_structure'),
  empty_answer: () => t('models.testReason.empty_answer'),
  not_json: () => t('models.testReason.not_json'),
  wrong_shape: () => t('models.testReason.wrong_shape'),
  truncated: () => t('models.testReason.truncated'),
  provider_not_local: () => t('models.testReason.provider_not_local'),
  invalid_request: () => t('models.testReason.invalid_request'),
  too_long: () => t('models.testReason.too_long'),
  provider_unavailable: () => t('models.testReason.provider_unavailable'),
  busy: () => t('models.testReason.busy'),
  failed: () => t('models.testReason.failed'),
};
const FUNCTION_LABEL: Record<ModelFunction, () => string> = {
  summary: () => t('models.fn.summary'),
  summary_fold: () => t('models.fn.summary_fold'),
  checklist: () => t('models.fn.checklist'),
  agenda: () => t('models.fn.agenda'),
};
const FUNCTION_DESCRIPTION: Record<ModelFunction, () => string> = {
  summary: () => t('models.fnDesc.summary'),
  summary_fold: () => t('models.fnDesc.summary_fold'),
  checklist: () => t('models.fnDesc.checklist'),
  agenda: () => t('models.fnDesc.agenda'),
};
/** Copy for a content-free reason code, with the generic text as the fallback. */
const lookup = (table: Record<string, () => string>, code: unknown) =>
  (typeof code === 'string' && Object.hasOwn(table, code) ? table[code] : table.failed)();
const refusalText = (code: unknown) => lookup(REFUSAL, code);
const testReasonText = (code: unknown) => lookup(TEST_REASON, code);

const LOCALE = IS_VENETA_MEMOAI ? 'nl-NL' : 'en-US';
function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return t('models.sizeUnknown');
  const gb = bytes / 1_000_000_000;
  const number = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: gb < 100 ? 1 : 0 });
  return gb < 1 ? `${Math.round(bytes / 1_000_000)} MB` : `${number.format(gb)} GB`;
}
const fnLabel = (fn: ModelFunction) => FUNCTION_LABEL[fn]();

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: ModelChoices };

function useModelChoices() {
  const [load, setLoad] = React.useState<Load>({ state: 'loading' });
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = React.useCallback(async () => {
    try {
      const result = await ipc().modelChoice.list();
      if (!alive.current) return;
      setLoad(result.success ? { state: 'ready', data: result } : { state: 'error' });
    } catch {
      if (alive.current) setLoad({ state: 'error' });
    }
  }, []);
  React.useEffect(() => {
    void reload();
  }, [reload]);
  return { load, reload, retry: () => { setLoad({ state: 'loading' }); void reload(); } };
}

interface Download {
  progress: string;
  /** Function that should switch to this model when the download finishes (none: just add it). */
  forFunction: ModelFunction | null;
  choice: string;
}

function useDownloads(onFinished: () => void, choose: (fn: ModelFunction, name: string) => Promise<void>) {
  const [downloads, setDownloads] = React.useState<Record<string, Download>>({});
  const [notice, setNotice] = React.useState<{ tag: string; text: string } | null>(null);
  const ref = React.useRef(downloads);
  const finished = React.useRef(onFinished);
  const chooseRef = React.useRef(choose);
  React.useEffect(() => {
    ref.current = downloads;
    finished.current = onFinished;
    chooseRef.current = choose;
  });

  React.useEffect(() => {
    const offProgress = ipc().on.modelPullProgress(({ model, progress }) => {
      setDownloads((prev) => (prev[model] ? { ...prev, [model]: { ...prev[model], progress } } : prev));
    });
    const offComplete = ipc().on.modelPullComplete(async ({ model, success, error, cancelled }) => {
      const finishedDownload = ref.current[model];
      setDownloads((prev) => {
        const { [model]: _drop, ...rest } = prev;
        return rest;
      });
      ipc().models.ackPullComplete(model);
      if (!finishedDownload) return;
      if (success && finishedDownload.forFunction) await chooseRef.current(finishedDownload.forFunction, finishedDownload.choice);
      if (!success) {
        setNotice({
          tag: model,
          text: cancelled ? t('models.downloadCancelled') : t('models.downloadFailed', { reason: refusalText(error) }),
        });
      }
      finished.current();
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, []);

  const start = async (tag: string, forFunction: ModelFunction | null, choice: string) => {
    setNotice(null);
    setDownloads((prev) => ({ ...prev, [tag]: { progress: '', forFunction, choice } }));
    const result = await ipc().models.pull(tag);
    if (!result.success) {
      // A refusal (cloud, disk) comes back directly; a normal failure also arrives as an event.
      setDownloads((prev) => {
        const { [tag]: _drop, ...rest } = prev;
        return rest;
      });
      const reason = (result as { reason?: string }).reason ?? (result as { error?: string }).error;
      if (!(result as { cancelled?: boolean }).cancelled) {
        setNotice({ tag, text: t('models.downloadFailed', { reason: refusalText(reason) }) });
      }
    }
  };
  const cancel = (tag: string) => void ipc().models.cancelPull(tag);
  return { downloads, notice, start, cancel };
}

function Badges({ entry }: { entry: CatalogModel }) {
  const pill = 'rounded-full border px-2 py-0.5 text-[11px] leading-none';
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid={`badges-${entry.id}`}>
      {entry.device_class === 'klein' && (
        <span className={pill} style={{ borderColor: 'var(--border-strong, var(--border-subtle))', color: 'var(--fg-1)' }}>
          {t('models.badgeSmall')}
        </span>
      )}
      <span
        className={pill}
        style={{
          borderColor: 'var(--border-strong, var(--border-subtle))',
          color: 'var(--fg-1)',
          background: entry.status === 'aanbevolen' ? 'var(--surface-sunken)' : 'transparent',
        }}
      >
        {entry.status === 'aanbevolen' ? t('models.badgeRecommended') : t('models.badgeCandidate')}
      </span>
    </span>
  );
}

function catalogFor(catalog: CatalogModel[], name: string): CatalogModel | undefined {
  return catalog.find((entry) => entry.choice_name === name || entry.pull_tag === name);
}

function DownloadBar({ tag, download, onCancel }: { tag: string; download: Download; onCancel: () => void }) {
  return (
    <div className="mt-2" data-testid={`download-${tag}`}>
      <DownloadProgressBar
        label={t('models.downloading', { model: tag })}
        percent={parsePullPercent(download.progress)}
        aria-label={t('models.downloadingBar', { model: tag })}
      />
      <Button variant="outline" className={`${COMPACT_BTN} mt-2`} onClick={onCancel}>
        {t('models.cancel')}
      </Button>
    </div>
  );
}

function FunctionRow({
  fn,
  data,
  open,
  onToggle,
  onChoose,
  onDelete,
  downloads,
  notice,
  onDownload,
  onCancel,
  saveError,
}: {
  fn: ModelFunction;
  data: ModelChoices;
  open: boolean;
  onToggle: () => void;
  onChoose: (fn: ModelFunction, name: string) => void;
  onDelete: (model: InstalledModel) => void;
  downloads: Record<string, Download>;
  notice: { tag: string; text: string } | null;
  onDownload: (entry: CatalogModel, fn: ModelFunction) => void;
  onCancel: (tag: string) => void;
  saveError: boolean;
}) {
  const state = data.functions[fn];
  const [test, setTest] = React.useState<{ running: boolean; result: ModelTestResponse | null }>({ running: false, result: null });
  const sameAsSummary = fn !== 'summary';
  const chosenName = state.choice || state.effective;
  const chosenEntry = catalogFor(data.catalog, chosenName);
  const display = chosenEntry?.name ?? chosenName;
  // The agenda follows the checklist's model until it has a choice of its own (0.11.0); the others follow the summary.
  const followsChecklist = fn === 'agenda';
  const summary = state.choice === '' && sameAsSummary
    ? (followsChecklist ? t('models.sameAsChecklistNow', { model: display }) : t('models.sameAsSummaryNow', { model: display }))
    : display;
  const groupName = `model-${fn}`;
  const recommended = data.catalog.filter((entry) => entry.functions.includes(fn) && !entry.installed);

  const runTest = async () => {
    setTest({ running: true, result: null });
    try {
      setTest({ running: false, result: await ipc().modelChoice.test(fn) });
    } catch {
      setTest({ running: false, result: { success: false, reason: 'failed' } });
    }
  };

  return (
    <div
      className="py-4"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
      data-testid={`model-function-${fn}`}
    >
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[14px]" style={{ color: 'var(--fg-1)', marginBottom: 2 }}>
            {fnLabel(fn)}
          </div>
          <div className="text-[13px] leading-[1.5]" style={{ color: 'var(--fg-2)' }}>
            {FUNCTION_DESCRIPTION[fn]()}
          </div>
          <div
            className="mt-1 text-[13px]"
            style={{ color: 'var(--fg-1)' }}
            data-testid={`model-current-${fn}`}
            aria-label={t('models.current', { function: fnLabel(fn) })}
          >
            {summary}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className={COMPACT_BTN} onClick={onToggle} aria-expanded={open} data-testid={`model-change-${fn}`}>
            {open ? t('models.close') : t('models.change')}
          </Button>
          <Button
            variant="outline"
            className={COMPACT_BTN}
            onClick={() => void runTest()}
            disabled={test.running}
            title={t('models.testExplain')}
            data-testid={`model-test-${fn}`}
          >
            {test.running ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                {t('models.testing')}
              </>
            ) : (
              t('models.test')
            )}
          </Button>
        </div>
      </div>

      <div role="status" aria-live="polite" className="mt-2 text-[13px]" style={{ color: 'var(--fg-2)' }} data-testid={`model-test-result-${fn}`}>
        {test.result &&
          (test.result.success ? (
            <>
              {t('models.testResult', {
                valid: test.result.valid ? t('models.yes') : t('models.no'),
                seconds: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(test.result.ms / 1000),
              })}
              {!test.result.valid && <> {t('models.testReason', { reason: testReasonText(test.result.reason) })}</>}
            </>
          ) : (
            t('models.testReason', { reason: testReasonText(test.result.reason) })
          ))}
      </div>
      {saveError && open && (
        <p role="alert" className="mt-2 text-[13px]" style={{ color: 'var(--fg-2)' }}>
          {t('models.saveError')}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-4" data-testid={`model-picker-${fn}`}>
          <div role="radiogroup" aria-label={fnLabel(fn)}>
            {sameAsSummary && (
              <label className="flex items-center gap-2 py-1.5 text-[13px]" style={{ color: 'var(--fg-1)' }}>
                <input type="radio" name={groupName} checked={state.choice === ''} onChange={() => onChoose(fn, '')} />
                {followsChecklist ? t('models.sameAsChecklist') : t('models.sameAsSummary')}
              </label>
            )}
            <div className="mt-2 text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--fg-2)' }}>
              {t('models.onThisMac')}
            </div>
            {data.installed.length === 0 && (
              <p className="py-1.5 text-[13px]" style={{ color: 'var(--fg-2)' }}>
                {data.server_running ? t('models.noneInstalled') : t('models.serverStopped')}
              </p>
            )}
            {data.installed.map((model) => {
              const entry = catalogFor(data.catalog, model.name);
              const users = model.functions.map(fnLabel).join(', ');
              return (
                <div key={model.name} className="flex items-start gap-2 py-1.5" data-testid={`installed-${model.name}`}>
                  <input
                    id={`${groupName}-${model.name}`}
                    type="radio"
                    name={groupName}
                    className="mt-1"
                    checked={state.choice === model.name}
                    onChange={() => onChoose(fn, model.name)}
                  />
                  <label htmlFor={`${groupName}-${model.name}`} className="min-w-0 flex-1 text-[13px]" style={{ color: 'var(--fg-1)' }}>
                    <span className="font-medium">{entry?.name ?? model.name}</span>
                    <span style={{ color: 'var(--fg-2)' }}>
                      {' '}
                      {model.name} · {formatBytes(model.size_bytes)} · {model.format}
                      {model.quantization ? ` · ${model.quantization}` : ''}
                    </span>
                    {entry && (
                      <span className="mt-1 block">
                        <Badges entry={entry} />
                      </span>
                    )}
                    {users && (
                      <span className="block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                        {t('models.inUseBy', { functions: users })}
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    className="mt-0.5 cursor-pointer rounded border-0 bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ color: 'var(--fg-2)' }}
                    aria-label={t('models.delete', { model: model.name })}
                    title={model.functions.length ? t('models.deleteBlocked', { functions: users }) : t('models.delete', { model: model.name })}
                    disabled={model.functions.length > 0}
                    onClick={() => onDelete(model)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div>
            <div className="text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--fg-2)' }}>
              {t('models.recommended')}
            </div>
            {data.catalog_error && (
              <p className="py-1.5 text-[13px]" style={{ color: 'var(--fg-2)' }}>
                {t('models.catalogError')}
              </p>
            )}
            {recommended.map((entry) => {
              const tag = entry.pull_tag;
              const download = tag ? downloads[tag] : undefined;
              const heavy = entry.device_class === 'mac' && modelMayExceedMemory(entry.pull_size_bytes ? entry.pull_size_bytes / 1e9 : undefined, data.total_ram_gb);
              return (
                <div key={entry.id} className="py-2" data-testid={`catalog-${entry.id}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 text-[13px]" style={{ color: 'var(--fg-1)' }}>
                      <span className="font-medium">{entry.name}</span>
                      <span style={{ color: 'var(--fg-2)' }}>
                        {' '}
                        {formatBytes(entry.pull_size_bytes)} · {t('models.license', { license: entry.license })}
                      </span>
                      <span className="mt-1 block">
                        <Badges entry={entry} />
                      </span>
                      {heavy && (
                        <span className="mt-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                          {t('models.mayExceedMemory')}
                        </span>
                      )}
                      {entry.note && (
                        <span className="mt-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                          {entry.note}
                        </span>
                      )}
                      <span className="block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                        {t('models.source', { source: entry.source_url.replace(/^https:\/\//, '') })}
                      </span>
                    </div>
                    {tag ? (
                      <Button variant="outline" className={COMPACT_BTN} disabled={Boolean(download)} onClick={() => onDownload(entry, fn)}>
                        {t('models.download')}
                      </Button>
                    ) : (
                      <span className="max-w-[200px] text-[12px]" style={{ color: 'var(--fg-2)' }}>
                        {t('models.downloadNotDirect')}
                      </span>
                    )}
                  </div>
                  {download && tag && <DownloadBar tag={tag} download={download} onCancel={() => onCancel(tag)} />}
                  {notice && notice.tag === tag && (
                    <p role="alert" className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
                      {notice.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AddModel({
  downloads,
  notice,
  onDownload,
  onCancel,
}: {
  downloads: Record<string, Download>;
  notice: { tag: string; text: string } | null;
  onDownload: (name: string) => void;
  onCancel: (tag: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const [preview, setPreview] = React.useState<AddPreviewResponse | null>(null);
  const inputId = React.useId();
  const check = async () => {
    setChecking(true);
    setPreview(null);
    try {
      setPreview(await ipc().modelChoice.preview(name));
    } catch {
      setPreview({ success: false, reason: 'failed' });
    } finally {
      setChecking(false);
    }
  };
  const ok = preview && preview.success ? preview : null;
  const download = ok ? downloads[ok.name] : undefined;
  return (
    <div className="py-4" data-testid="model-add">
      <div className="text-[14px]" style={{ color: 'var(--fg-1)', marginBottom: 2 }}>
        {t('models.add.title')}
      </div>
      <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--fg-2)' }}>
        {t('models.add.hint')}
      </p>
      <label htmlFor={inputId} className="mt-2 block text-[13px]" style={{ color: 'var(--fg-1)' }}>
        {t('models.add.label')}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          id={inputId}
          className={`${COMPACT_INPUT} max-w-[420px]`}
          value={name}
          maxLength={200}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder={t('models.add.placeholder')}
          onChange={(event) => {
            setName(event.target.value);
            setPreview(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() && !checking) void check();
          }}
        />
        <Button variant="outline" className={COMPACT_BTN} onClick={() => void check()} disabled={checking || !name.trim()}>
          {checking ? t('models.add.checking') : t('models.add.check')}
        </Button>
      </div>
      <div role="status" aria-live="polite" className="mt-2 space-y-1 text-[13px]" style={{ color: 'var(--fg-2)' }} data-testid="model-add-status">
        {preview && !preview.success && <p>{refusalText(preview.reason)}</p>}
        {ok && (
          <>
            <p>
              {ok.name} · {ok.size_bytes ? t('models.size', { size: formatBytes(ok.size_bytes) }) : t('models.sizeUnknown')}
            </p>
            {ok.installed && <p>{t('models.add.alreadyInstalled')}</p>}
            {!ok.disk.ok && <p>{t('models.add.diskLow')}</p>}
          </>
        )}
      </div>
      {ok && !ok.installed && ok.disk.ok && !download && (
        <Button className={`${COMPACT_BTN} mt-2`} onClick={() => onDownload(ok.name)}>
          {t('models.add.start', { model: ok.name })}
        </Button>
      )}
      {ok && download && <DownloadBar tag={ok.name} download={download} onCancel={() => onCancel(ok.name)} />}
      {ok && notice && notice.tag === ok.name && (
        <p role="alert" className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

export function ModelChoiceSettings() {
  const { load, reload, retry } = useModelChoices();
  // The older model list on the same screen reads react-query; keep both in step without
  // requiring a provider (unit tests and other hosts render this section on its own).
  const queryClient = React.useContext(QueryClientContext);
  const syncingRef = React.useRef(false);
  const notifyShared = React.useCallback(async () => {
    if (!queryClient) return;
    syncingRef.current = true;
    try {
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    } finally {
      syncingRef.current = false;
    }
  }, [queryClient]);
  React.useEffect(() => {
    if (!queryClient) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (syncingRef.current || event.type !== 'updated') return;
      if (event.query.queryKey[0] !== 'models' || event.action.type !== 'success') return;
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 150);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient, reload]);
  const [openFn, setOpenFn] = React.useState<ModelFunction | null>(null);
  const [saveError, setSaveError] = React.useState(false);
  const [deleteCandidate, setDeleteCandidate] = React.useState<InstalledModel | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const choose = React.useCallback(
    async (fn: ModelFunction, name: string) => {
      setSaveError(false);
      try {
        const result = await ipc().modelChoice.set(fn, name);
        if (!result.success) setSaveError(true);
      } catch {
        setSaveError(true);
      }
      await reload();
      await notifyShared();
    },
    [reload, notifyShared],
  );
  const { downloads, notice, start, cancel } = useDownloads(() => void reload(), choose);

  if (load.state === 'loading') {
    return (
      <div className="mt-6 flex items-center gap-2 text-[13px]" style={{ color: 'var(--fg-2)' }} data-testid="model-choice-settings">
        <Loader2 className="size-3.5 animate-spin" />
        {t('models.loading')}
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="mt-6 text-[13px]" style={{ color: 'var(--fg-2)' }} data-testid="model-choice-settings">
        <p role="alert">{t('models.loadError')}</p>
        <Button variant="outline" className={`${COMPACT_BTN} mt-2`} onClick={retry}>
          {t('models.retry')}
        </Button>
      </div>
    );
  }
  const data = load.data;
  return (
    <section className="mt-6" data-testid="model-choice-settings" aria-labelledby="model-choice-title">
      <div id="model-choice-title" className="text-[14px] font-normal" style={{ color: 'var(--fg-1)', marginBottom: 2 }}>
        {t('models.title')}
      </div>
      <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--fg-2)' }}>
        {t('models.intro')}
      </p>
      {data.provider !== 'local' ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-2)' }}>
          {t('models.localOnly')}
        </p>
      ) : (
        <>
          {MODEL_FUNCTIONS.map((fn) => (
            <FunctionRow
              key={fn}
              fn={fn}
              data={data}
              open={openFn === fn}
              onToggle={() => {
                setSaveError(false);
                setOpenFn(openFn === fn ? null : fn);
              }}
              onChoose={(f, name) => void choose(f, name)}
              onDelete={(model) => {
                setDeleteError(null);
                setDeleteCandidate(model);
              }}
              downloads={downloads}
              notice={notice}
              onDownload={(entry, f) => void start(entry.pull_tag, f, entry.choice_name)}
              onCancel={cancel}
              saveError={saveError}
            />
          ))}
          <AddModel downloads={downloads} notice={notice} onDownload={(name) => void start(name, null, '')} onCancel={cancel} />
        </>
      )}
      {deleteError && (
        <p role="alert" className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
          {deleteError}
        </p>
      )}
      {deleteCandidate && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteCandidate(null);
          }}
          title={t('models.deleteTitle')}
          description={t('models.deleteBody', { model: deleteCandidate.name, size: formatBytes(deleteCandidate.size_bytes) })}
          confirmLabel={t('models.deleteConfirm')}
          destructive
          onConfirm={async () => {
            const model = deleteCandidate;
            try {
              const result = await ipc().models.delete(model.name);
              if (!result.success) setDeleteError(t('models.deleteFailed', { reason: refusalText(result.reason) }));
            } catch {
              setDeleteError(t('models.deleteFailed', { reason: refusalText('failed') }));
            } finally {
              setDeleteCandidate(null);
              await reload();
              await notifyShared();
            }
          }}
        />
      )}
    </section>
  );
}
