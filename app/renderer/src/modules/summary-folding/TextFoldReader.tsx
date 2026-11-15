import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FoldDocument, FoldLevel } from '../../lib/summaryFoldingContracts';
import { foldLevels, foldText } from './foldText';
import { toPaperData } from './paperData';
import { mountTextFold, type TextFoldApi } from './textfold/reader';
import './textfold/reader.css';
import './textfold/theme.css';

/** TextFold's level numbers: 4 Volledig, 3 Beknopt, 2 Kern, 1 Kernzin, 0 Onderwerpen. */
export const levelNumber = (level: FoldLevel) => 4 - foldLevels.indexOf(level);
export const levelName = (n: number): FoldLevel => foldLevels[4 - n] ?? 'full';
const LABELS = foldLevels.map((level) => foldText.levels[level]).reverse();

export interface TextFoldReaderProps {
  document: FoldDocument;
  /** The element that scrolls the page; defaults to the closest scrolling ancestor. */
  scroller?: HTMLElement | null;
  /** Called by the zoom bar, the wheel, a pinch, the keys 1 to 5 and the slider. */
  onLevel?: (level: FoldLevel) => void;
  /** Where the zoom bar is drawn (the host's dock); the reader fills it. */
  bar: HTMLElement | null;
  initialLevel?: FoldLevel;
  reducedMotion?: boolean;
  onReady?: (api: TextFoldApi) => void;
}

function scrollParent(node: HTMLElement | null): HTMLElement {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (/(auto|scroll)/.test(overflow)) return el;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/**
 * Mounts TextFold's reader (derived from chenxiachan/textfold, Apache-2.0) over a fold document. A document with the
 * same source and the same units but other ladders (the AI levels over the local ones) is handed to the running
 * reader, which morphs to it; a new source remounts it.
 */
export function TextFoldReader({ document: doc, scroller, onLevel, bar, initialLevel = 'full', reducedMotion, onReady }: TextFoldReaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const api = useRef<TextFoldApi | null>(null);
  const shown = useRef<FoldDocument | null>(null);
  const callbacks = useRef({ onLevel, onReady });
  useEffect(() => {
    callbacks.current = { onLevel, onReady };
  });
  const paper = useMemo(() => toPaperData(doc), [doc]);
  const sourceHash = doc.sourceHash;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const main = docRef.current;
    const ghosts = ghostRef.current;
    if (!root || !main || !ghosts || !bar) return;
    // The bar belongs to the host's dock but is styled by the reader's scope.
    const instance = mountTextFold(root, toPaperData(shown.current ?? doc), {
      scroller: scroller ?? scrollParent(root),
      doc: main,
      ghosts,
      bar,
      labels: LABELS,
      level: levelNumber(initialLevel),
      reduced: reducedMotion,
      onLevel: (n: number) => callbacks.current.onLevel?.(levelName(n)),
    });
    api.current = instance;
    callbacks.current.onReady?.(instance);
    return () => {
      instance.destroy();
      api.current = null;
      bar.replaceChildren();
      main.replaceChildren();
      ghosts.replaceChildren();
    };
    // A new source (hash) or bar remounts; ladders for the same source go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceHash, bar, scroller, reducedMotion]);

  useEffect(() => {
    if (shown.current === null) {
      shown.current = doc;
      return;
    }
    if (shown.current === doc) return;
    shown.current = doc;
    api.current?.setData(paper);
  }, [doc, paper]);

  return (
    <div ref={rootRef} className="tf-root" data-testid="textfold-reader" data-provenance={doc.provenance}>
      <main ref={docRef} className="doc" aria-label={foldText.reader} />
      <div ref={ghostRef} className="tf-ghosts" aria-hidden="true" />
    </div>
  );
}
