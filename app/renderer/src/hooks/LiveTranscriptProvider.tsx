import { createContext, useContext, type ReactNode } from 'react';
import { useLiveTranscript as useTranscriptSource, type UseLiveTranscriptResult } from './useLiveTranscript';
import { useRecording } from './useRecording';
const EMPTY: UseLiveTranscriptResult = { status: 'idle', segments: [], finals: [], partials: [], priorSegments: [], error: null, slow: false };
const TranscriptContext = createContext<UseLiveTranscriptResult>(EMPTY);
/** Exactly one owner, above the recording route and dock/portal lifetimes. */
export function LiveTranscriptProvider({ children }: { children: ReactNode }) {
  const recording = useRecording();
  const source = useTranscriptSource(recording.sessionName);
  return <TranscriptContext.Provider value={source}>{children}</TranscriptContext.Provider>;
}
export function useLiveTranscript() { return useContext(TranscriptContext); }
