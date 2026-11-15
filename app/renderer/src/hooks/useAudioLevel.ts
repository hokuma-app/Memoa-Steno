import * as React from 'react';
import { useMicrophoneSetting } from './useSettings';

interface UseAudioLevelOptions {
  /** When false, the hook tears down the audio graph and returns zeros. */
  enabled: boolean;
  /** Number of bars to produce. */
  bars: number;
  /** Smoothing 0..1 (higher = more inertia). Default 0.55. */
  smoothing?: number;
  /** Min visible amplitude (0..1) so silent bars don't fully collapse. */
  floor?: number;
}

type MeterListener = (data: Uint8Array) => void;

/** One renderer-level microphone reader shared by every AudioWave. */
class SharedMicrophoneMeter {
  private listeners = new Set<MeterListener>();
  private pinnedDeviceId: string | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;
  private lastUpdate = 0;
  private generation = 0;
  private opening = false;
  private listeningForVisibility = false;

  subscribe(pinnedDeviceId: string | null, listener: MeterListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      // Freeze the pin for this meter session, matching capture's start-time
      // device selection even if Settings changes during recording.
      this.pinnedDeviceId = pinnedDeviceId;
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.listeningForVisibility = true;
      this.resume();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        if (this.listeningForVisibility) {
          document.removeEventListener('visibilitychange', this.onVisibilityChange);
          this.listeningForVisibility = false;
        }
        this.stop();
        this.pinnedDeviceId = null;
      }
    };
  }

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.stop();
    else this.resume();
  };

  private isWanted() {
    return this.listeners.size > 0 && !document.hidden;
  }

  private resume() {
    if (!this.isWanted() || this.stream || this.context || this.opening) return;
    const generation = ++this.generation;
    const pinnedDeviceId = this.pinnedDeviceId;
    this.opening = true;
    void this.open(generation, pinnedDeviceId).finally(() => {
      if (generation === this.generation) this.opening = false;
    });
  }

  private async open(generation: number, pinnedDeviceId: string | null) {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: pinnedDeviceId ? { deviceId: { exact: pinnedDeviceId } } : true,
        });
      } catch (err) {
        const isMissingDeviceError =
          err instanceof DOMException &&
          (err.name === 'OverconstrainedError' || err.name === 'NotFoundError');
        if (!pinnedDeviceId || !isMissingDeviceError) throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (generation !== this.generation || !this.isWanted()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      if (generation !== this.generation || !this.isWanted()) {
        analyser.disconnect();
        void context.close().catch(() => {});
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      this.context = context;
      this.analyser = analyser;
      this.lastUpdate = 0;
      this.raf = requestAnimationFrame(this.tick);
    } catch {
      // Permission denied / no device — listeners retain their floor values.
      if (context) void context.close().catch(() => {});
      if (stream) stream.getTracks().forEach((track) => track.stop());
    }
  }

  private readonly tick = (now: number) => {
    const analyser = this.analyser;
    if (!analyser || !this.isWanted()) return;
    if (now - this.lastUpdate >= 50) {
      this.lastUpdate = now;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      this.listeners.forEach((listener) => listener(data));
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private stop() {
    ++this.generation;
    this.opening = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.analyser) this.analyser.disconnect();
    this.analyser = null;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.lastUpdate = 0;
  }
}

const sharedMicrophoneMeter = new SharedMicrophoneMeter();

/**
 * Reads the shared renderer microphone meter and returns N normalized frequency
 * levels (0..1) sampled at ~20 Hz. It shares one getUserMedia stream and one
 * AudioContext between simultaneous consumers while each consumer preserves its
 * own bar count, smoothing, and floor.
 */
export function useAudioLevel({
  enabled,
  bars,
  smoothing = 0.55,
  floor = 0.05,
}: UseAudioLevelOptions): number[] {
  const [levels, setLevels] = React.useState<number[]>(() => new Array(bars).fill(floor));
  const microphone = useMicrophoneSetting();
  const pinnedDeviceIdRef = React.useRef<string | null>(null);
  const optionsRef = React.useRef({ bars, smoothing, floor });
  const smoothedRef = React.useRef<number[]>(new Array(bars).fill(floor));
  optionsRef.current = { bars, smoothing, floor };

  React.useEffect(() => {
    pinnedDeviceIdRef.current = microphone.data?.device_id ?? null;
  }, [microphone.data?.device_id]);

  React.useEffect(() => {
    smoothedRef.current = new Array(bars).fill(floor);
    setLevels(new Array(bars).fill(floor));
  }, [bars, floor]);

  React.useEffect(() => {
    if (enabled) return;
    smoothedRef.current = new Array(bars).fill(floor);
    setLevels(new Array(bars).fill(floor));
  }, [enabled, bars, floor]);

  React.useEffect(() => {
    if (!enabled) return;
    return sharedMicrophoneMeter.subscribe(pinnedDeviceIdRef.current, (data) => {
      const { bars: barCount, smoothing: smoothingAmount, floor: floorValue } = optionsRef.current;
      const smoothed = smoothedRef.current;
      if (smoothed.length !== barCount) smoothedRef.current = new Array(barCount).fill(floorValue);
      const current = smoothedRef.current;
      const usable = Math.floor(data.length * 0.7);
      const next = new Array(barCount);
      for (let index = 0; index < barCount; index++) {
        const dataIndex = Math.floor((index * usable) / barCount);
        const value = data[dataIndex] / 255;
        const blended = current[index] * smoothingAmount + value * (1 - smoothingAmount);
        current[index] = blended;
        next[index] = Math.max(floorValue, blended);
      }
      setLevels(next);
    });
  }, [enabled]);

  return levels;
}
