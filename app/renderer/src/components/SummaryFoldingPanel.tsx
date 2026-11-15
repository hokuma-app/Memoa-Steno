import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { ipc } from '@/lib/ipc';
import type { FoldDocument, FoldFailureReason, FoldLevel, FoldProgress } from '@/lib/summaryFoldingContracts';
import { applySpeakerNamesToDocument, speakerNamesKey, type SpeakerLabelNames } from '@/lib/speakerNames';
import { useSidebarCollapsed, useSidebarWidth } from '@/components/Sidebar';
import { TextFoldReader } from '@/modules/summary-folding/TextFoldReader';
import { foldText } from '@/modules/summary-folding/foldText';
import { summaryFoldingFailure, summaryFoldingProgress, summaryFoldingText as t } from './summaryFoldingCopy';

/** What the reader shows right now: the document as displayed (speaker names applied) and the chosen level. */
export interface FoldView {
  document: FoldDocument;
  level: FoldLevel;
}

export interface SummaryFoldingPanelProps {
  summaryFile: string;
  sourceRevision: string;
  reportId?: string;
  /** Speaker labels that are now names; applied when shown, the stored levels are not touched. */
  speakerNames?: SpeakerLabelNames | null;
  /** Kept up to date with what the reader shows, so Copy can copy exactly that. Null while the note is not folded. */
  viewRef?: MutableRefObject<FoldView | null>;
  /** The canonical note, shown until the levels are there and whenever they cannot be made. */
  children: ReactNode;
}

export function SummaryFoldingPanel({ summaryFile, sourceRevision, reportId, speakerNames, viewRef, children }: SummaryFoldingPanelProps) {
  // A source change creates a fresh session (and cancels the previous run) before effects run.
  return (
    <FoldingSession key={JSON.stringify([summaryFile, reportId, sourceRevision])} summaryFile={summaryFile} reportId={reportId} speakerNames={speakerNames} viewRef={viewRef}>
      {children}
    </FoldingSession>
  );
}

const BUSY_RETRY_MS = 15_000;
const BUSY_RETRIES = 6;

type Failure = { kind: 'load' } | { kind: 'generate'; reason: FoldFailureReason | undefined };

/**
 * 0.9.2, as TextFold does it: every level is usable at once from the author's own words (the local levels, no model),
 * and the AI levels are made in the background with the configured provider, once per source, and morphed to when
 * ready. Nothing here needs a button; a failed run leaves the local levels in place and shows its content-free reason.
 */
function FoldingSession({ summaryFile, reportId, speakerNames, viewRef, children }: { summaryFile: string; reportId?: string; speakerNames?: SpeakerLabelNames | null; viewRef?: MutableRefObject<FoldView | null>; children: ReactNode }) {
  const [document, setDocument] = useState<FoldDocument | null>(null);
  const [progress, setProgress] = useState<FoldProgress | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const { sidebarCollapsed } = useSidebarCollapsed();
  const { width: sidebarWidth } = useSidebarWidth();
  const started = useRef(false);
  const [explicit, setExplicit] = useState(false);
  const makeLevels = useRef<(() => void) | null>(null);
  const [level, setLevel] = useState<FoldLevel>('full');
  const namesKey = speakerNamesKey(speakerNames);
  // The stored levels keep the label; the reader gets the names. Another mapping is another view (key below).
  const shown = useMemo(
    () => (document ? applySpeakerNamesToDocument(document, namesKey ? speakerNames : null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, namesKey],
  );
  useEffect(() => {
    if (!viewRef) return undefined;
    viewRef.current = shown ? { document: shown, level } : null;
    return () => {
      viewRef.current = null;
    };
  }, [viewRef, shown, level]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bridge = ipc().summaryFolding;
    const args = (reportId ? [summaryFile, reportId] : [summaryFile]) as [string, string?];
    // One model run for the AI levels; a busy host (recording or other processing) is retried later, bounded.
    const generate = async (attempt: number): Promise<void> => {
      if (!active) return;
      started.current = true;
      setFailure(null);
      setPreparing(true);
      const unsubscribe = bridge.onProgress?.((value) => {
        if (active) setProgress(value);
      });
      let again = false;
      try {
        const made = await bridge.generate(...args);
        if (!active) return;
        if (made.success && made.document) setDocument(made.document);
        else if (!made.success && made.reason === 'busy') again = attempt < BUSY_RETRIES;
        else if (!made.success) setFailure({ kind: 'generate', reason: made.reason });
      } catch {
        if (active) setFailure({ kind: 'generate', reason: undefined });
      } finally {
        unsubscribe?.();
        if (active) {
          setPreparing(false);
          setProgress(null);
        }
      }
      if (again && active) timer = setTimeout(() => void generate(attempt + 1), BUSY_RETRY_MS);
    };
    makeLevels.current = () => void generate(0);
    void (async () => {
      try {
        const stored = await bridge.load(...args);
        if (!active) return;
        if (!stored.success) {
          setFailure({ kind: 'load' });
          return;
        }
        if (stored.document) {
          setDocument(stored.document);
          return;
        }
        // No AI levels yet: all five levels from the author's words first, no model needed.
        const local = await bridge.local(...args);
        if (!active) return;
        if (!local.success) {
          setFailure({ kind: 'load' });
          return;
        }
        setDocument(local.document);
        if (started.current) return;
        // The AI levels start by themselves only with a local provider; any other provider (remote, cloud,
        // unknown) gets the local levels and an explicit button, because the summary would leave this machine.
        let automatic = false;
        try {
          const provider = await ipc().ai.getProvider();
          automatic = provider.success && provider.ai_provider === 'local';
        } catch {
          automatic = false;
        }
        if (!active) return;
        if (automatic) await generate(0);
        else setExplicit(true);
      } catch {
        if (active) setFailure({ kind: 'load' });
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      makeLevels.current = null;
      // Only a run this session started may be stopped; the host ignores a cancel when nothing runs.
      if (started.current) void bridge.cancel?.();
    };
  }, [summaryFile, reportId]);

  const local = document?.provenance === 'local';
  const status =
    failure?.kind === 'generate' ? (
      <p role="alert" className="summary-fold-status">
        {summaryFoldingFailure(failure.reason)}
      </p>
    ) : failure?.kind === 'load' ? (
      <p role="alert" className="summary-fold-status">
        {t('loadError')}
      </p>
    ) : preparing && progress ? (
      <p role="status" className="summary-fold-status">
        {summaryFoldingProgress(progress.done, progress.total)}
      </p>
    ) : null;

  return (
    <div data-testid="summary-folding-panel" data-provenance={document?.provenance ?? 'none'}>
      {shown ? <TextFoldReader key={`reader:${namesKey}`} document={shown} bar={bar} initialLevel={level} onLevel={setLevel} /> : children}
      {document ? <div className="summary-fold-spacer" aria-hidden /> : null}
      {document || failure ? (
        <div
          className="tf-root summary-fold-dock"
          data-testid="summary-fold-dock"
          // Same horizontal frame as the bottom dock: centred on the notes column.
          style={{ left: sidebarCollapsed ? 0 : sidebarWidth, right: 10 }}
        >
          {status}
          {document ? (
            <>
              {explicit && document.provenance === 'local' && !preparing ? (
                <p className="summary-fold-hint">
                  {t('explanation')}{' '}
                  <button type="button" className="summary-fold-make" onClick={() => makeLevels.current?.()}>{t('makeLevels')}</button>
                </p>
              ) : null}
              <nav ref={setBar} className="zoombar" aria-label={foldText.detail} />
              <p className="summary-fold-hint">{local ? foldText.provisional : foldText.hint}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
