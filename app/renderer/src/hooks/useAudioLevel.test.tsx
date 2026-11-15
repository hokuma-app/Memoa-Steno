import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useSettings', () => ({
  useMicrophoneSetting: () => ({ data: { device_id: microphoneDeviceId } }),
}));

import { useAudioLevel } from './useAudioLevel';

const getUserMedia = vi.fn();
let microphoneDeviceId = 'pinned-mic';
let hidden = false;

function createStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource() {
    return { connect: vi.fn() };
  }

  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      disconnect: vi.fn(),
      getByteFrequencyData: vi.fn((data: Uint8Array) => data.fill(128)),
    };
  }

  close = vi.fn(() => Promise.resolve());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  microphoneDeviceId = 'pinned-mic';
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  FakeAudioContext.instances = [];
  getUserMedia.mockReset();
  getUserMedia.mockImplementation(async () => createStream().stream);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

describe('useAudioLevel', () => {
  it('shares one microphone request across simultaneous meter consumers', async () => {
    const first = renderHook(() => useAudioLevel({ enabled: true, bars: 7 }));
    const second = renderHook(() => useAudioLevel({ enabled: true, bars: 12 }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(first.result.current).toHaveLength(7);
    expect(second.result.current).toHaveLength(12);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'pinned-mic' } },
    });
  });

  it('does not duplicate a pending shared microphone request on a visibility event', async () => {
    const request = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(request.promise);
    renderHook(() => useAudioLevel({ enabled: true, bars: 7 }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

    document.dispatchEvent(new Event('visibilitychange'));
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('stops the shared meter while hidden and opens it again when visible', async () => {
    const first = createStream();
    const second = createStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    renderHook(() => useAudioLevel({ enabled: true, bars: 7 }));
    await waitFor(() => expect(FakeAudioContext.instances).toHaveLength(1));

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: 'pinned-mic' } },
    });
  });

  it('clears a paused meter instead of leaving the last live bars visible', async () => {
    const view = renderHook(({ enabled }) => useAudioLevel({ enabled, bars: 5 }), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(FakeAudioContext.instances).toHaveLength(1));
    const callback = vi.mocked(requestAnimationFrame).mock.calls[0][0];
    act(() => callback(100));
    await waitFor(() => expect(view.result.current.some((level) => level > 0.05)).toBe(true));
    view.rerender({ enabled: false });
    expect(view.result.current).toEqual(new Array(5).fill(0.05));
  });

  it('stops a late permission result after its consumer unmounts', async () => {
    const request = deferred<MediaStream>();
    const late = createStream();
    getUserMedia.mockReturnValueOnce(request.promise);
    const view = renderHook(() => useAudioLevel({ enabled: true, bars: 7 }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

    view.unmount();
    request.resolve(late.stream as unknown as MediaStream);

    await waitFor(() => expect(late.track.stop).toHaveBeenCalledOnce());
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('keeps the session-start microphone pin across a hidden resume', async () => {
    const first = createStream();
    const second = createStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const view = renderHook(() => useAudioLevel({ enabled: true, bars: 7 }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    microphoneDeviceId = 'new-mic';
    view.rerender();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: 'pinned-mic' } },
    });
  });
});
