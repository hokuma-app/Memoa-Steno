import * as React from 'react';
import { createPortal } from 'react-dom';
import { IS_VENETA_MEMOAI } from '@/lib/productBrand';
import { useRoute } from '@/lib/router';
import { cn } from '@/lib/utils';
import { AskBar, TranscriptToggle } from '@/components/AskBar';
import { LiveDock } from '@/components/LiveDock';
import { LiveTranscriptBar } from '@/components/LiveTranscriptBar';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { useRecording } from '@/hooks/useRecording';
import { useLiveTranscriptAvailable, useTranscriptionEngine } from '@/hooks/useModels';

/** Per-session presentation default. Wait for the actual engine, not the live-toggle hydration fallback. */
export function useSessionTranscriptDefault(recording: { sessionName: string | null | undefined; status: string }) {
  const engine = useTranscriptionEngine();
  const setOpen = useLiveTranscriptOpen((s) => s.setOpen);
  const lastSession = React.useRef<string | null>(null);
  React.useEffect(() => {
    const session = recording.sessionName ?? null;
    if (session === lastSession.current) return;
    if (IS_VENETA_MEMOAI && session && (engine.data === undefined ||
      (recording.status !== 'recording' && recording.status !== 'paused'))) {
      setOpen(false);
      return;
    }
    lastSession.current = session;
    setOpen(IS_VENETA_MEMOAI && !!session && engine.data === 'parakeet' &&
      (recording.status === 'recording' || recording.status === 'paused'));
  }, [recording.sessionName, recording.status, engine.data, setOpen]);
}

/** Recording controls and chat share the dock without sharing a lifetime. */
export function PrimaryDock({ showAskBar }: { showAskBar: boolean }) {
  const recording = useRecording();
  const open = useLiveTranscriptOpen((s) => s.open);
  // Whisper has no live transcript. Belt-and-braces vs the LiveDock toggle
  // being hidden: the store could already be open from a prior Parakeet
  // session, and zustand survives across recordings. Force the pill for
  // whisper regardless of stored state.
  const liveAvailable = useLiveTranscriptAvailable();
  const recordingActive =
    recording.status === 'recording' || recording.status === 'paused';

  // Continue-recording ("Resume") now lives in the transcript panel footer
  // (TranscriptBar), Granola-style — open the transcript on a note to resume
  // recording into it. No standalone dock control here.

  const transcriptExpanded = recordingActive && open && liveAvailable;
  const route = useRoute();
  const inRecordingLayout = IS_VENETA_MEMOAI && route === '/recording';
  const [column, setColumn] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (!inRecordingLayout || !transcriptExpanded) return;
    // Route subscribers can commit before Recording mounts its slot. Observe
    // its lifetime as well as its arrival, without polling or a second panel.
    const syncColumn = () => {
      const slot = document.getElementById('veneta-live-transcript-slot');
      setColumn((current) => current === slot ? current : slot);
    };
    const observer = new MutationObserver(syncColumn);
    observer.observe(document.body, { childList: true, subtree: true });
    syncColumn();
    return () => observer.disconnect();
  }, [inRecordingLayout, transcriptExpanded]);

  return (
    <>
    {transcriptExpanded && (inRecordingLayout
      ? column && createPortal(<LiveTranscriptBar />, column)
      : <LiveTranscriptBar />)}
    <div
      data-testid="primary-dock-row"
      style={{ display: transcriptExpanded || (!recordingActive && !showAskBar) ? 'none' : undefined }}
      // items-end, not items-center: the AskBar column grows upward in-flow
      // (chat panel maxHeight 360, suggestion chips), so centering against it
      // would float the left control mid-column when a chat is expanded. The
      // left controls instead carry a small mb-* that optically centers them
      // against the 50px composer row only.
      className={cn('flex items-end gap-3', !showAskBar && 'justify-center')}
    >
      {recordingActive ? (
        // mb-1 only beside the composer - standalone (justify-center) the
        // pill has nothing to align with.
        <div className={cn('shrink-0', showAskBar && 'mb-1')}>
          {!(IS_VENETA_MEMOAI && transcriptExpanded) && <LiveDock />}
        </div>
      ) : (
        // Idle: the standalone transcript toggle sits left of the Ask bar
        // (Granola-style). While recording, the pill owns the left slot.
        <TranscriptToggle />
      )}
      <div className="min-w-0 flex-1" style={{ display: showAskBar ? undefined : 'none' }}>
        <AskBar visible={showAskBar && !transcriptExpanded} />
      </div>
    </div>
    </>
  );
}
