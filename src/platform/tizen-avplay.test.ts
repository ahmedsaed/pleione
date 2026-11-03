// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { playWithAvplay, type AvplayApi } from './tizen-avplay';

function fakeAvplay(durationMs = 0) {
  let listener: Record<string, (...args: unknown[]) => void> = {};
  let prepared: (() => void) | null = null;
  let prepareFailed: ((e: unknown) => void) | null = null;
  const av = {
    open: vi.fn(),
    close: vi.fn(),
    prepareAsync: vi.fn((ok: () => void, fail: (e: unknown) => void) => { prepared = ok; prepareFailed = fail; }),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seekTo: vi.fn((_ms: number, ok?: () => void) => ok?.()),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => durationMs),
    getState: vi.fn(() => 'READY'),
    getTotalTrackInfo: vi.fn(() => [
      { index: 0, type: 'VIDEO', extra_info: '{"Width":"640","Height":"360"}' },
      { index: 1, type: 'AUDIO', extra_info: '{"language":"l1"}' },
      { index: 2, type: 'AUDIO', extra_info: '{"language":"l2"}' },
    ]),
    setSelectTrack: vi.fn(),
    suspend: vi.fn(),
    restore: vi.fn(),
    setDisplayRect: vi.fn(),
    setDisplayMethod: vi.fn(),
    setListener: vi.fn((l: Record<string, (...args: unknown[]) => void>) => { listener = l; }),
  } satisfies AvplayApi;
  return {
    av,
    prepare: () => prepared?.(),
    failPrepare: () => prepareFailed?.('PLAYER_ERROR_NOT_SUPPORTED_FORMAT'),
    emit: (name: string, ...args: unknown[]) => listener[name]?.(...args),
  };
}

function video(): { el: HTMLVideoElement; events: string[] } {
  const el = document.createElement('video');
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) });
  const events: string[] = [];
  for (const type of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing',
    'pause', 'waiting', 'timeupdate', 'seeking', 'seeked', 'ended', 'error']) {
    el.addEventListener(type, () => events.push(type));
  }
  return { el, events };
}

describe('playWithAvplay', () => {
  it('plays a stream behind the element, which reports its state and media events', () => {
    const { av, prepare, emit } = fakeAvplay();
    const { el, events } = video();

    playWithAvplay(av, el, 'http://host/live/1.ts');
    expect(av.open).toHaveBeenCalledWith('http://host/live/1.ts');
    expect(av.setDisplayRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(el.currentSrc).toBe('http://host/live/1.ts');
    expect(el.readyState).toBe(0);
    expect(document.documentElement.classList.contains('avplay-active')).toBe(true);
    expect(document.querySelector('object[type="application/avplayer"]')).not.toBeNull();
    // Until a picture plays, the backdrop stays closed over its message.
    expect(document.documentElement.classList.contains('avplay-playing')).toBe(false);

    prepare();
    expect(document.documentElement.classList.contains('avplay-playing')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--avplay-width')).toBe('1920px');
    expect(av.play).toHaveBeenCalled();
    expect(el.readyState).toBe(4);
    expect(el.paused).toBe(false);
    expect(el.duration).toBe(Infinity);
    expect([el.videoWidth, el.videoHeight]).toEqual([640, 360]);
    expect(events).toEqual(['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing']);

    emit('oncurrentplaytime', 5400);
    expect(el.currentTime).toBe(5.4);
    expect(events.slice(-1)).toEqual(['timeupdate']);
  });

  it('reports a buffering pause as waiting only when it lasts', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare, emit } = fakeAvplay();
      const { el, events } = video();
      playWithAvplay(av, el, 'http://host/live/1.ts');
      prepare();
      const count = events.length;

      // The blip AVPlay reports at each live TS segment.
      emit('onbufferingstart');
      vi.advanceTimersByTime(200);
      emit('onbufferingcomplete');
      vi.advanceTimersByTime(2000);
      expect(events.length).toBe(count);

      emit('onbufferingstart');
      vi.advanceTimersByTime(1500);
      emit('onbufferingcomplete');
      expect(events.slice(count)).toEqual(['waiting', 'playing']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists the stream\'s audio tracks and switches them through AVPlay', () => {
    const { av, prepare } = fakeAvplay();
    const { el } = video();
    playWithAvplay(av, el, 'http://host/live/1.ts');
    prepare();

    const tracks = el.audioTracks as unknown as { length: number; [i: number]: { language: string; enabled: boolean } };
    expect(tracks.length).toBe(2);
    expect([tracks[0].language, tracks[1].language]).toEqual(['l1', 'l2']);
    expect(tracks[0].enabled).toBe(true);

    for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === 1;
    expect(av.setSelectTrack).toHaveBeenCalledTimes(1);
    expect(av.setSelectTrack).toHaveBeenCalledWith('AUDIO', 2);
    expect(tracks[1].enabled).toBe(true);
  });

  it('pauses, resumes and seeks a stream with a duration', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { el, events } = video();
    playWithAvplay(av, el, 'http://host/vod/1.ts');
    prepare();

    el.pause();
    expect(av.pause).toHaveBeenCalled();
    expect(el.paused).toBe(true);
    void el.play();
    expect(av.play).toHaveBeenCalledTimes(2);
    expect(el.duration).toBe(60);

    el.currentTime = 30;
    expect(av.seekTo).toHaveBeenCalledWith(30000, expect.any(Function), expect.any(Function));
    expect(el.currentTime).toBe(30);
    expect(events).toContain('seeked');
  });

  it('reports a stream AVPlay cannot open as an unsupported source', () => {
    const { av, failPrepare } = fakeAvplay();
    const { el, events } = video();
    playWithAvplay(av, el, 'http://host/live/1.ts');
    failPrepare();

    expect(events).toContain('error');
    expect(el.error?.code).toBe(4);
    expect(document.documentElement.classList.contains('avplay-playing')).toBe(false);
  });

  it('gives the element back when released, and on the reset load() Player does', () => {
    const { av, prepare, emit } = fakeAvplay();
    const { el, events } = video();
    const playback = playWithAvplay(av, el, 'http://host/live/1.ts');
    prepare();

    playback.release();
    expect(av.stop).toHaveBeenCalled();
    expect(av.close).toHaveBeenCalled();
    expect(Object.prototype.hasOwnProperty.call(el, 'currentTime')).toBe(false);
    expect(el.readyState).toBe(0);
    expect(document.documentElement.classList.contains('avplay-active')).toBe(false);
    expect(document.documentElement.classList.contains('avplay-playing')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--avplay-left')).toBe('');
    const count = events.length;
    emit('oncurrentplaytime', 9000);
    expect(events.length).toBe(count);

    const second = fakeAvplay();
    playWithAvplay(second.av, el, 'http://host/live/2.ts');
    el.load();
    expect(second.av.close).toHaveBeenCalled();
    expect(Object.prototype.hasOwnProperty.call(el, 'load')).toBe(false);
  });

  it('reads as short of data once AVPlay\'s clock stops, so the stall watchdog can reconnect', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare, emit } = fakeAvplay();
      const { el } = video();
      playWithAvplay(av, el, 'http://host/live/1.ts');
      prepare();
      emit('oncurrentplaytime', 1000);
      vi.advanceTimersByTime(2000);
      emit('oncurrentplaytime', 3000);
      expect(el.readyState).toBe(4);

      vi.advanceTimersByTime(3500);
      expect(el.readyState).toBe(2);
      emit('oncurrentplaytime', 3500);
      expect(el.readyState).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the element over without reporting a pause', () => {
    const { av } = fakeAvplay();
    const { el, events } = video();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    playWithAvplay(av, el, 'http://host/live/1.ts');
    expect(pause).not.toHaveBeenCalled();
    expect(events).not.toContain('pause');
    pause.mockRestore();
  });

  it('gives the video plane back while the app is hidden, and resumes after', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { el } = video();
    playWithAvplay(av, el, 'http://host/vod/1.ts');
    prepare();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(av.suspend).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(av.restore).toHaveBeenCalledTimes(1);
    expect(av.play).toHaveBeenCalledTimes(2);
    hidden.mockRestore();
  });

  it('ends a seek AVPlay refuses, so Player stops waiting for it', () => {
    const { av, prepare } = fakeAvplay(60000);
    av.seekTo.mockImplementation(() => { throw new Error('InvalidStateError'); });
    const { el, events } = video();
    playWithAvplay(av, el, 'http://host/vod/1.ts');
    prepare();
    el.currentTime = 30;
    expect(events.slice(-2)).toEqual(['seeking', 'seeked']);
    expect(el.seeking).toBe(false);
  });
});
