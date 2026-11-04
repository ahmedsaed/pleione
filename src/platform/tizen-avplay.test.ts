// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dvrWindow } from '../utils/dvr';
import { AvplayMedia, createAvplayMedia, type AvplayApi } from './tizen-avplay';

function fakeAvplay(durationMs = 0, text = false, liveWindow = '') {
  let state = 'IDLE';
  let listener: Record<string, (...args: unknown[]) => void> = {};
  let prepared: (() => void) | null = null;
  let prepareFailed: ((e: unknown) => void) | null = null;
  const av = {
    open: vi.fn(),
    close: vi.fn(),
    prepareAsync: vi.fn((ok: () => void, fail: (e: unknown) => void) => { prepared = ok; prepareFailed = fail; }),
    play: vi.fn(() => { state = 'PLAYING'; }),
    pause: vi.fn(() => { state = 'PAUSED'; }),
    stop: vi.fn(),
    seekTo: vi.fn((_ms: number, ok?: () => void) => ok?.()),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => durationMs),
    getState: vi.fn(() => state),
    getTotalTrackInfo: vi.fn(() => [
      { index: 0, type: 'VIDEO', extra_info: '{"Width":"640","Height":"360"}' },
      { index: 1, type: 'AUDIO', extra_info: '{"language":"l1"}' },
      { index: 2, type: 'AUDIO', extra_info: '{"language":"l2"}' },
      ...(text ? [{ index: 3, type: 'TEXT', extra_info: '{"track_lang":"l1","fourCC":"text/plain"}' }] : []),
    ]),
    setSilentSubtitle: vi.fn(),
    getStreamingProperty: vi.fn((name: string) => (name === 'GET_LIVE_DURATION' ? liveWindow : '')),
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

const EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing',
  'pause', 'waiting', 'timeupdate', 'seeking', 'seeked', 'ended', 'error'];

// The player's <video> element, the rectangle AVPlay draws into, and the
// media playing there, with the events Player would hear.
function play(av: AvplayApi, url: string): { el: HTMLVideoElement; media: AvplayMedia; events: string[] } {
  const el = document.createElement('video');
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) });
  const media = createAvplayMedia(av, el, url);
  const events: string[] = [];
  for (const type of EVENTS) media.addEventListener(type, () => events.push(type));
  media.start();
  return { el, media, events };
}

const root = document.documentElement;

// Past the first seconds of playback, when a seek goes through a reopen.
function warmUp(): void {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now + 9000);
}

describe('AvplayMedia', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('plays a stream into the element\'s rectangle and reports its state and media events', () => {
    const { av, prepare, emit } = fakeAvplay();
    const { media, events } = play(av, 'http://host/live/1.ts');

    expect(av.open).toHaveBeenCalledWith('http://host/live/1.ts');
    expect(av.setDisplayRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(media.currentSrc).toBe('http://host/live/1.ts');
    expect(media.readyState).toBe(0);
    expect(root.classList.contains('avplay-active')).toBe(true);
    expect(document.querySelector('object[type="application/avplayer"]')).not.toBeNull();
    // Until a picture plays, the backdrop stays closed over its message.
    expect(root.classList.contains('avplay-playing')).toBe(false);

    prepare();
    expect(root.classList.contains('avplay-playing')).toBe(true);
    expect(root.style.getPropertyValue('--avplay-width')).toBe('1920px');
    expect(av.play).toHaveBeenCalled();
    expect(media.readyState).toBe(4);
    expect(media.paused).toBe(false);
    expect(media.duration).toBe(Infinity);
    expect([media.videoWidth, media.videoHeight]).toEqual([640, 360]);
    expect(events).toEqual(['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing']);

    emit('oncurrentplaytime', 5400);
    expect(media.currentTime).toBe(5.4);
    expect(events.slice(-1)).toEqual(['timeupdate']);
  });

  it('leaves the element itself alone', () => {
    const { av, prepare } = fakeAvplay();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const { el } = play(av, 'http://host/live/1.ts');
    prepare();
    // A pause() on takeover would read as the viewer pausing.
    expect(pause).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyNames(el).filter(name => name !== 'getBoundingClientRect')).toEqual([]);
    pause.mockRestore();
  });

  it('reports a buffering pause as waiting only when it lasts', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare, emit } = fakeAvplay();
      const { events } = play(av, 'http://host/live/1.ts');
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
    const { media } = play(av, 'http://host/live/1.ts');
    prepare();

    const tracks = media.audioTracks;
    expect(tracks.length).toBe(2);
    expect([tracks[0].language, tracks[1].language]).toEqual(['l1', 'l2']);
    expect(tracks[0].enabled).toBe(true);
    expect(tracks.getTrackById('2')).toBe(tracks[1]);

    for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === 1;
    expect(av.setSelectTrack).toHaveBeenCalledTimes(1);
    expect(av.setSelectTrack).toHaveBeenCalledWith('AUDIO', 2);
    expect(tracks[1].enabled).toBe(true);
  });

  it('holds a remembered audio choice made before playback until AVPlay plays', () => {
    const { av, prepare } = fakeAvplay();
    const { media } = play(av, 'http://host/live/1.m3u8');
    av.setSelectTrack.mockImplementation(() => {
      if (av.getState() !== 'PLAYING') throw new Error('InvalidStateError');
    });
    media.addEventListener('loadedmetadata', () => {
      for (let i = 0; i < media.audioTracks.length; i++) media.audioTracks[i].enabled = i === 1;
    });
    prepare();
    expect(av.setSelectTrack).toHaveBeenLastCalledWith('AUDIO', 2);
    expect(av.setSelectTrack).toHaveBeenCalledTimes(1);
    expect(media.audioTracks[1].enabled).toBe(true);
  });

  it('pauses, resumes and seeks a stream with a duration', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { media, events } = play(av, 'http://host/vod/1.ts');
    prepare();
    warmUp();

    media.pause();
    expect(av.pause).toHaveBeenCalled();
    expect(media.paused).toBe(true);
    void media.play();
    expect(av.play).toHaveBeenCalledTimes(2);
    expect(media.duration).toBe(60);

    warmUp();
    media.currentTime = 30;
    expect(av.seekTo).toHaveBeenCalledWith(30000, expect.any(Function), expect.any(Function));
    expect(media.currentTime).toBe(30);
    expect(events).toContain('seeked');
  });

  it('reports a live window as Tizen\'s <video> does, so subtitles anchor and live rewind stays off', () => {
    const { av, prepare } = fakeAvplay(0, false, '8000|308000');
    const { media } = play(av, 'http://host/live/1.m3u8');
    prepare();
    expect(media.duration).toBe(308);
    expect([media.seekable.length, media.seekable.start(0), media.seekable.end(0)]).toEqual([1, 8, 308]);
    expect(dvrWindow(media.seekable, media.duration, 10)).toBeNull();
  });

  it('reports a movie seekable over its length, and a live TS stream with no window as live', () => {
    const movie = fakeAvplay(60000);
    const { media: vod } = play(movie.av, 'http://host/vod/1.mkv');
    movie.prepare();
    expect([vod.seekable.start(0), vod.seekable.end(0), vod.duration]).toEqual([0, 60, 60]);

    const ts = fakeAvplay(0, false, '0|0');
    const { media: live } = play(ts.av, 'http://host/live/1.ts');
    ts.prepare();
    expect(live.duration).toBe(Infinity);
    expect(live.seekable.length).toBe(0);
  });

  it('ends a seek AVPlay refuses, so Player stops waiting for it', () => {
    vi.useFakeTimers();
    const { av, prepare } = fakeAvplay(60000);
    av.seekTo.mockImplementation(() => { throw Object.assign(new Error('refused'), { name: 'InvalidStateError' }); });
    const { media, events } = play(av, 'http://host/vod/1.ts');
    prepare();
    warmUp();
    media.currentTime = 30;
    vi.advanceTimersByTime(30000);
    vi.useRealTimers();
    expect(events.filter(e => e === 'seeking' || e === 'seeked')).toEqual(['seeking', 'seeked']);
    expect(media.seeking).toBe(false);
  });

  it('starts playback only after a resume seek made before it has landed', () => {
    const { av, prepare } = fakeAvplay(60000);
    const pending: Array<() => void> = [];
    av.seekTo.mockImplementation((_ms: number, ok?: () => void) => { if (ok) pending.push(ok); });
    const { media, events } = play(av, 'http://host/vod/1.ts');
    media.addEventListener('loadedmetadata', () => { media.currentTime = 75; });
    prepare();
    expect(av.play).not.toHaveBeenCalled();
    pending.shift()!();
    expect(av.play).toHaveBeenCalledTimes(1);
    expect(media.currentTime).toBe(75);
    expect(events.indexOf('seeked')).toBeLessThan(events.indexOf('playing'));
  });

  it('runs one seek at a time, moving on to the newest target', () => {
    const { av, prepare } = fakeAvplay(60000);
    const pending: Array<() => void> = [];
    av.seekTo.mockImplementation((_ms: number, ok?: () => void) => { if (ok) pending.push(ok); });
    const { media, events } = play(av, 'http://host/vod/1.ts');
    prepare();
    warmUp();

    media.currentTime = 30;
    expect(media.currentTime).toBe(30);
    media.currentTime = 40;
    media.currentTime = 50;
    // A step from the position builds on the last target, not the old time.
    expect(media.currentTime).toBe(50);
    expect(av.seekTo).toHaveBeenCalledTimes(1);
    pending.shift()!();
    expect(av.seekTo).toHaveBeenLastCalledWith(50000, expect.any(Function), expect.any(Function));
    pending.shift()!();
    expect(media.currentTime).toBe(50);
    expect(events.filter(e => e === 'seeking' || e === 'seeked')).toEqual(['seeking', 'seeked']);
  });

  it('retries a seek AVPlay refuses just after starting, and reports it once taken', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare } = fakeAvplay(60000);
      let refusals = 2;
      av.seekTo.mockImplementation((_ms: number, ok?: () => void, fail?: (e: unknown) => void) => {
        if (refusals-- > 0) fail?.({ name: 'InvalidStateError' }); else ok?.();
      });
      const { media, events } = play(av, 'http://host/vod/1.ts');
      prepare();
      warmUp();
      media.currentTime = 40;
      expect(media.seeking).toBe(true);
      media.currentTime = 45;
      vi.advanceTimersByTime(1000);
      expect(av.seekTo).toHaveBeenCalledTimes(3);
      expect(av.seekTo).toHaveBeenLastCalledWith(45000, expect.any(Function), expect.any(Function));
      expect(media.seeking).toBe(false);
      expect(media.currentTime).toBe(45);
      expect(events.filter(e => e === 'seeking' || e === 'seeked')).toEqual(['seeking', 'seeked']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles a seek AVPlay keeps refusing, so a retry on seeked cannot loop', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare } = fakeAvplay(60000);
      av.seekTo.mockImplementation((_ms: number, _ok?: () => void, fail?: (e: unknown) => void) => fail?.({ name: 'InvalidStateError' }));
      const { media } = play(av, 'http://host/vod/1.ts');
      prepare();
      warmUp();
      // Player re-submits its target on seeked while the position is off it.
      const target = 30;
      media.addEventListener('seeked', () => {
        if (Math.abs(media.currentTime - target) > 1) media.currentTime = target;
      });
      media.currentTime = target;
      vi.advanceTimersByTime(30000);
      expect(av.seekTo).toHaveBeenCalledTimes(13);
      expect(media.seeking).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lands a seek in the first seconds of playback by reopening, as AVPlay freezes on it', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { media, events } = play(av, 'http://host/vod/1.m3u8');
    prepare();
    media.audioTracks[1].enabled = true;
    av.play.mockClear();
    av.setSelectTrack.mockClear();

    media.currentTime = 30;
    expect(av.seekTo).not.toHaveBeenCalled();
    expect(av.close).toHaveBeenCalledTimes(1);
    prepare();
    expect(av.seekTo).toHaveBeenCalledTimes(1);
    expect(av.play).toHaveBeenCalledTimes(1);
    expect(av.seekTo.mock.invocationCallOrder[0]).toBeLessThan(av.play.mock.invocationCallOrder[0]);
    expect(av.setSelectTrack).toHaveBeenCalledWith('AUDIO', 2);
    expect(media.currentTime).toBe(30);
    expect(events.filter(e => e === 'seeking' || e === 'seeked')).toEqual(['seeking', 'seeked']);
  });

  it('keeps a paused stream paused when a seek reopens it, and plays on resume', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { media } = play(av, 'http://host/vod/1.m3u8');
    prepare();
    media.pause();
    av.play.mockClear();
    media.currentTime = 30;
    prepare();
    expect(av.play).not.toHaveBeenCalled();
    expect(media.paused).toBe(true);
    void media.play();
    expect(av.play).toHaveBeenCalledTimes(1);
  });

  it('reopens the stream at the target when AVPlay never answers a seek', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare } = fakeAvplay(60000);
      const { media, events } = play(av, 'http://host/vod/1.m3u8');
      prepare();
      warmUp();
      media.audioTracks[1].enabled = true;
      av.seekTo.mockImplementationOnce(() => {});
      av.play.mockClear();
      av.setSelectTrack.mockClear();

      media.currentTime = 30;
      vi.advanceTimersByTime(6000);
      expect(av.close).toHaveBeenCalledTimes(1);
      expect(av.open).toHaveBeenCalledTimes(2);
      expect(media.seeking).toBe(true);

      prepare();
      expect(av.seekTo).toHaveBeenLastCalledWith(30000, expect.any(Function), expect.any(Function));
      expect(av.play).toHaveBeenCalledTimes(1);
      expect(av.setSelectTrack).toHaveBeenCalledWith('AUDIO', 2);
      expect(media.seeking).toBe(false);
      expect(media.currentTime).toBe(30);
      expect(events.filter(e => e === 'seeking' || e === 'seeked')).toEqual(['seeking', 'seeked']);
      expect(events).not.toContain('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens at once on the refusal of a frozen AVPlay, without retrying', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { media } = play(av, 'http://host/vod/1.m3u8');
    prepare();
    warmUp();
    av.seekTo.mockImplementationOnce((_ms: number, _ok?: () => void, fail?: (e: unknown) => void) =>
      fail?.({ name: 'InvalidValuesError' }));
    media.currentTime = 30;
    expect(av.close).toHaveBeenCalledTimes(1);
    expect(av.open).toHaveBeenCalledTimes(2);
    prepare();
    expect(media.seeking).toBe(false);
    expect(media.currentTime).toBe(30);
  });

  it('reports a playback error when a reopened stream still does not answer', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare } = fakeAvplay(60000);
      const { media, events } = play(av, 'http://host/vod/1.m3u8');
      prepare();
      warmUp();
      av.seekTo.mockImplementation(() => {});
      media.currentTime = 30;
      vi.advanceTimersByTime(6000);
      prepare();
      vi.advanceTimersByTime(6000);
      expect(events).toContain('error');
      expect(media.error?.code).toBe(2);
      expect(media.seeking).toBe(false);
      expect(av.open).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps its duration through a reopen, so presses in that time queue up', () => {
    const { av, prepare } = fakeAvplay(60000);
    const { media } = play(av, 'http://host/vod/1.m3u8');
    prepare();
    // AVPlay knows no duration between close() and prepared.
    av.close.mockImplementation(() => { av.getDuration.mockReturnValue(0); });
    media.currentTime = 30;
    expect(media.duration).toBe(60);
    expect(media.seekable.end(0)).toBe(60);
    media.currentTime = 40;
    av.getDuration.mockReturnValue(60000);
    prepare();
    expect(av.seekTo).toHaveBeenLastCalledWith(40000, expect.any(Function), expect.any(Function));
    expect(media.currentTime).toBe(40);
    expect(media.seeking).toBe(false);
  });

  it('seeks a stream with a live window, whose AVPlay duration reads 0', () => {
    const { av, prepare } = fakeAvplay(0, false, '0|300000');
    const { media, events } = play(av, 'http://host/catchup/1.m3u8');
    prepare();
    warmUp();
    media.currentTime = 30;
    expect(av.seekTo).toHaveBeenCalledWith(30000, expect.any(Function), expect.any(Function));
    expect(events).toContain('seeked');
  });

  it('holds playback for a stream prepared while the app is hidden', () => {
    const { av, prepare } = fakeAvplay(60000);
    play(av, 'http://host/vod/1.mkv');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    prepare();
    expect(av.play).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(av.play).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });

  it('coming back during a seek leaves play() to the seek, as AVPlay wedges otherwise', () => {
    const { av, prepare } = fakeAvplay(60000);
    const pending: Array<() => void> = [];
    const { media } = play(av, 'http://host/vod/1.mkv');
    prepare();
    warmUp();
    av.seekTo.mockImplementation((_ms: number, ok?: () => void) => { if (ok) pending.push(ok); });
    media.currentTime = 30;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    hidden.mockReturnValue(false);
    av.play.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(av.play).not.toHaveBeenCalled();
    pending.shift()!();
    expect(av.play).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });

  it('reports a stream AVPlay cannot open as an unsupported source', () => {
    const { av, failPrepare } = fakeAvplay();
    const { media, events } = play(av, 'http://host/live/1.ts');
    failPrepare();

    expect(events).toContain('error');
    expect(media.error?.code).toBe(4);
    expect(root.classList.contains('avplay-playing')).toBe(false);
  });

  it('reads as short of data once AVPlay\'s clock stops, so the stall watchdog can reconnect', () => {
    vi.useFakeTimers();
    try {
      const { av, prepare, emit } = fakeAvplay();
      const { media } = play(av, 'http://host/live/1.ts');
      prepare();
      emit('oncurrentplaytime', 1000);
      vi.advanceTimersByTime(2000);
      emit('oncurrentplaytime', 3000);
      expect(media.readyState).toBe(4);

      vi.advanceTimersByTime(3500);
      expect(media.readyState).toBe(2);
      emit('oncurrentplaytime', 3500);
      expect(media.readyState).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the video plane back while the app is hidden, and resumes after', () => {
    const { av, prepare } = fakeAvplay(60000);
    play(av, 'http://host/vod/1.ts');
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

  it('stops AVPlay and the page\'s opening when released, and goes quiet', () => {
    const { av, prepare, emit } = fakeAvplay();
    const { media, events } = play(av, 'http://host/live/1.ts');
    prepare();

    media.release();
    expect(av.stop).toHaveBeenCalled();
    expect(av.close).toHaveBeenCalled();
    expect(root.classList.contains('avplay-active')).toBe(false);
    expect(root.classList.contains('avplay-playing')).toBe(false);
    expect(root.style.getPropertyValue('--avplay-left')).toBe('');
    const count = events.length;
    emit('oncurrentplaytime', 9000);
    expect(events.length).toBe(count);
  });
});

// jsdom has no VTTCue.
class FakeCue {
  constructor(public startTime: number, public endTime: number, public text: string) {}
}

describe('AvplayMedia text tracks', () => {
  beforeEach(() => { vi.stubGlobal('VTTCue', FakeCue); });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.textContent = '';
  });

  const shown = () => [...document.querySelectorAll('.cue-overlay .cue')].map(line => line.textContent);

  it('lists the stream\'s own text track and shows its text once selected', () => {
    const { av, prepare, emit } = fakeAvplay(0, true);
    const { media } = play(av, 'http://host/vod/1.mkv');
    prepare();

    expect(media.textTracks.length).toBe(1);
    const track = media.textTracks[0];
    expect([track.kind, track.language, track.mode]).toEqual(['subtitles', 'l1', 'disabled']);

    track.mode = 'showing';
    expect(av.setSelectTrack).toHaveBeenCalledWith('TEXT', 3);
    expect(av.setSilentSubtitle).toHaveBeenLastCalledWith(false);

    emit('oncurrentplaytime', 6000);
    emit('onsubtitlechange', '3000', 'Line 1\r\u0000', '0', []);
    expect(shown()).toEqual(['Line 1']);
    emit('oncurrentplaytime', 9500);
    expect(shown()).toEqual([]);

    track.mode = 'disabled';
    expect(av.setSilentSubtitle).toHaveBeenLastCalledWith(true);
  });

  it('shows the stream\'s own text on its track when a sidecar track came first', () => {
    const { av, prepare, emit } = fakeAvplay(0, true);
    const { media } = play(av, 'http://host/vod/1.mkv');
    // A saved online subtitle attaches before AVPlay is prepared.
    const sidecar = media.addTextTrack('subtitles', 'Sidecar', 'l2');
    prepare();
    const own = media.textTracks[1];
    expect(own.language).toBe('l1');
    own.mode = 'showing';
    emit('oncurrentplaytime', 6000);
    emit('onsubtitlechange', '3000', 'Line 1', '0', []);
    expect(shown()).toEqual(['Line 1']);
    expect(sidecar.cues?.length).toBe(0);
  });

  it('drops the stream\'s own cues on a seek, as AVPlay delivers them again', () => {
    const { av, prepare, emit } = fakeAvplay(60000, true);
    const { media } = play(av, 'http://host/vod/1.mkv');
    prepare();
    media.textTracks[0].mode = 'showing';
    emit('oncurrentplaytime', 20000);
    emit('onsubtitlechange', '3000', 'Line 1', '0', []);
    expect(media.textTracks[0].cues?.length).toBe(1);
    warmUp();
    media.currentTime = 19;
    expect(media.textTracks[0].cues?.length).toBe(0);
  });

  it('delays the stream\'s own text by Subtitle Sync\'s offset', () => {
    const { av, prepare, emit } = fakeAvplay(0, true);
    const { media } = play(av, 'http://host/vod/1.mkv');
    prepare();
    const track = media.textTracks[0] as unknown as TextTrack & { cueOffset: number };
    track.mode = 'showing';
    track.cueOffset = 2;
    emit('oncurrentplaytime', 6000);
    emit('onsubtitlechange', '3000', 'Line 1', '0', []);
    expect(shown()).toEqual([]);
    emit('oncurrentplaytime', 8500);
    expect(shown()).toEqual(['Line 1']);
  });

  it('holds a choice made before playback until AVPlay plays, as it refuses one earlier', () => {
    const { av, prepare } = fakeAvplay(0, true);
    const { media } = play(av, 'http://host/vod/1.mkv');
    media.addEventListener('loadedmetadata', () => { media.textTracks[0].mode = 'showing'; });
    av.setSelectTrack.mockImplementation(() => {
      if (av.getState() !== 'PLAYING') throw new Error('InvalidStateError');
    });
    prepare();
    expect(av.setSelectTrack).toHaveBeenCalledWith('TEXT', 3);
    expect(av.setSilentSubtitle).toHaveBeenLastCalledWith(false);
  });

  it('offers no text track for MP4, whose mov_text AVPlay never delivers', () => {
    const { av, prepare } = fakeAvplay(0, true);
    const { media } = play(av, 'http://host/vod/1.mp4');
    prepare();
    expect(media.textTracks.length).toBe(0);
  });

  it('draws the app\'s own cues over the picture, on the media clock', () => {
    const { av, prepare, emit } = fakeAvplay();
    const { media } = play(av, 'http://host/live/1.m3u8');
    prepare();
    const track = media.addTextTrack('subtitles', 'Track 3', 'l1');
    track.mode = 'showing';
    track.addCue(new VTTCue(10, 12, 'Segment cue'));

    emit('oncurrentplaytime', 9000);
    expect(shown()).toEqual([]);
    emit('oncurrentplaytime', 10500);
    expect(shown()).toEqual(['Segment cue']);
    const overlay = document.querySelector('.cue-overlay') as HTMLElement;
    expect([overlay.style.width, overlay.style.height]).toEqual(['1920px', '1080px']);

    media.release();
    expect(document.querySelector('.cue-overlay')).toBeNull();
  });
});
