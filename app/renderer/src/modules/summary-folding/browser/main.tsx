import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../globals.css';
import '../../../veneta-theme.css';
import { TextFoldReader } from '../TextFoldReader';
import { toPaperData } from '../paperData';
import { foldText } from '../foldText';
import type { FoldDocument, FoldLevel } from '../../../lib/summaryFoldingContracts';
import local from './oracle-doc-local.json';
import ai from './oracle-doc-ai.json';

// Synthetic Dutch summary only (673 words); no models, no user data.
const params = new URLSearchParams(location.search);
const docs = { local: local as unknown as FoldDocument, ai: ai as unknown as FoldDocument };
const inner = params.get('inner') === '1';

declare global {
  interface Window {
    __fold: { toPaperData: typeof toPaperData; docs: typeof docs; swapToAi: () => void };
  }
}

function Fixture() {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [doc, setDoc] = useState<FoldDocument>(params.get('doc') === 'ai' ? docs.ai : docs.local);
  const [level, setLevel] = useState<FoldLevel>('full');
  useEffect(() => {
    window.__fold = { toPaperData, docs, swapToAi: () => setDoc(docs.ai) };
  }, []);
  const column = (
    <div style={{ width: 700, maxWidth: '100%', boxSizing: 'border-box', margin: '0 auto', padding: '0 24px' }} data-testid="column">
      <TextFoldReader
        document={doc}
        scroller={inner ? scroller : undefined}
        bar={bar}
        onLevel={setLevel}
        reducedMotion={params.get('reduced') === '1' ? true : undefined}
      />
      <p style={{ color: 'var(--fg-2)', margin: '16px 0 0' }} data-testid="status">
        {`${doc.provenance}:${level}`}
      </p>
      <div style={{ height: 120 }} />
    </div>
  );
  return (
    <div className="tf-root" style={{ background: 'var(--surface)', minHeight: '100vh' }}>
      {inner ? (
        <div ref={setScroller} style={{ position: 'fixed', inset: '48px 0 0 200px', overflow: 'auto' }} data-testid="scroller">
          {scroller ? column : null}
        </div>
      ) : (
        column
      )}
      <div
        className="summary-fold-dock"
        data-testid="summary-fold-dock"
        style={{ position: 'fixed', left: inner ? 200 : 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center', zIndex: 45, pointerEvents: 'none' }}
      >
        <nav ref={setBar} className="zoombar" aria-label={foldText.detail} style={{ pointerEvents: 'auto' }} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
