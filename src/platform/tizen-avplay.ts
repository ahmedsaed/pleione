import { createLogger } from '../utils/logger';
import type { PlatformPlayback } from './types';

// Samsung's AVPlay plays what the TV's <video> cannot (raw MPEG-TS on
// Tizen 9, docs/tizen.md). It draws on the video plane under the page, so
// while it plays, the player's <video> element stays in place as the
// stand-in: its media state reads from AVPlay and it fires the media events
// Player listens to. Releasing the playback restores the element.

const log = () => createLogger('AVPlay');

interface AvplayTrack {
  index: number;
  type: string;
  extra_info?: string;
}

export interface AvplayApi {
  open(url: string): void;
  close(): void;
  prepareAsync(ok: () => void, fail: (e: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(ms: number, ok?: () => void, fail?: (e: unknown) => void): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): string;
  getTotalTrackInfo(): AvplayTrack[];
  setSelectTrack(type: string, index: number): void;
  suspend?(): void;
  restore?(): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod?(method: string): void;
  setListener(listener: Record<string, (...args: unknown[]) => void>): void;
}

function extra(track: AvplayTrack): Record<string, unknown> {
  try {
    return JSON.parse(track.extra_info || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

// The members of the element that AVPlay backs while it plays.
const BACKED = [
  'currentTime', 'duration', 'paused', 'ended', 'seeking', 'readyState', 'networkState',
  'error', 'videoWidth', 'videoHeight', 'audioTracks', 'currentSrc', 'play', 'pause', 'load',
] as const;

const BUFFERING_GRACE_MS = 1000;
const STALL_MS = 3000;
const HOLE = ['--avplay-left', '--avplay-top', '--avplay-width', '--avplay-height'];

let surface: HTMLObjectElement | null = null;

// AVPlay needs this element in the document to own the video plane.
function ensureSurface(): void {
  if (surface && surface.parentNode) return;
  surface = document.createElement('object');
  surface.type = 'application/avplayer';
  surface.className = 'avplay-surface';
  document.body.insertBefore(surface, document.body.firstChild);
}

/** Play `url` through AVPlay behind `video`, which reports its state until released. */
export function playWithAvplay(av: AvplayApi, video: HTMLVideoElement, url: string): PlatformPlayback {
  // Stop the element's own pipeline before AVPlay takes over its members.
  // Dropping the source is enough; a pause() would tell Player the viewer
  // paused.
  video.removeAttribute('src');
  video.innerHTML = '';
  HTMLMediaElement.prototype.load.call(video);

  let released = false;
  let readyState = 0;
  let networkState = 2;
  let paused = false;
  let ended = false;
  let seeking = false;
  let time = 0;
  let error: { code: number; message: string } | null = null;
  let width = 0;
  let height = 0;
  let audioIndexes: number[] = [];
  let audioSelected = 0;
  let prepared = false;
  // AVPlay reports a buffering blip at every live TS segment; only a pause
  // the viewer can notice is a stall.
  let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
  let waiting = false;
  let progressAt = 0;

  const fire = (type: string) => {
    if (!released) video.dispatchEvent(new Event(type));
  };

  // Player reads the list on loadedmetadata and when the picker opens; its
  // addtrack listener sits on the element's own list, so this one needs none.
  const audioTracks: Record<string, unknown> & { length: number } = { length: 0 };
  const setAudioList = (tracks: AvplayTrack[]) => {
    for (let i = 0; i < audioTracks.length; i++) delete audioTracks[i];
    audioIndexes = tracks.map(t => t.index);
    tracks.forEach((track, i) => {
      const info = extra(track);
      audioTracks[i] = {
        id: String(track.index),
        kind: i === 0 ? 'main' : 'alternative',
        label: '',
        language: typeof info.language === 'string' ? info.language : '',
        get enabled(): boolean { return audioSelected === i; },
        set enabled(on: boolean) {
          if (!on || audioSelected === i || released) return;
          try {
            av.setSelectTrack('AUDIO', audioIndexes[i]);
            audioSelected = i;
          } catch (e) {
            log().warn('Audio track switch failed', 'event=playback.avplay.audio.failed',
              `error=${(e as { name?: string })?.name ?? 'unknown'}`);
          }
        },
      };
    });
    audioTracks.length = tracks.length;
  };

  // The page above the plane is opaque, the views' backdrops included; once a
  // picture plays, the backdrop opens over this rectangle (css/main.css).
  const root = document.documentElement;
  const syncRect = () => {
    if (released) return;
    const r = video.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    HOLE.forEach((name, i) => root.style.setProperty(name, `${rect[i]}px`));
    try {
      av.setDisplayRect(rect[0], rect[1], rect[2], rect[3]);
    } catch { /* AVPlay rejects a rectangle outside its states; the next sync retries */ }
  };
  const observer = typeof MutationObserver === 'function'
    ? new MutationObserver(syncRect) : null;
  observer?.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', syncRect);

  // Player stops live TV when the app is hidden but leaves a movie in place;
  // AVPlay must give the video plane back either way.
  let suspended = false;
  const onVisibility = () => {
    if (released || !prepared) return;
    try {
      if (document.hidden && !suspended) {
        suspended = true;
        av.suspend ? av.suspend() : av.pause();
      } else if (!document.hidden && suspended) {
        suspended = false;
        if (av.restore) av.restore();
        if (!paused) av.play();
        progressAt = Date.now();
      }
    } catch { /* the next visibility change tries again */ }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const fail = (code: number, reason: string) => {
    if (released || error) return;
    error = { code, message: reason };
    networkState = 3;
    root.classList.remove('avplay-playing');
    log().warn('AVPlay playback failed', 'event=playback.avplay.error', `reason=${reason}`);
    fire('error');
  };

  const start = () => {
    if (released || paused || !prepared) return;
    try {
      av.play();
    } catch {
      fail(3, 'play');
      return;
    }
    root.classList.add('avplay-playing');
    progressAt = Date.now();
    fire('play');
    fire('playing');
  };

  const values: Record<(typeof BACKED)[number], PropertyDescriptor> = {
    currentTime: {
      get: () => time,
      set: (seconds: number) => {
        const duration = av.getDuration() / 1000;
        if (!prepared || !(duration > 0) || !Number.isFinite(seconds)) return;
        seeking = true;
        fire('seeking');
        const done = () => {
          seeking = false;
          time = seconds;
          fire('seeked');
          fire('timeupdate');
        };
        try {
          av.seekTo(Math.max(0, Math.round(seconds * 1000)), done, () => { seeking = false; fire('seeked'); });
        } catch {
          seeking = false;
          fire('seeked');
        }
      },
    },
    duration: {
      get: () => {
        if (!prepared) return NaN;
        const ms = av.getDuration();
        return ms > 0 ? ms / 1000 : Infinity;
      },
    },
    paused: { get: () => paused },
    ended: { get: () => ended },
    seeking: { get: () => seeking },
    // AVPlay can stall without a word; a clock that stopped reads as
    // short of data, so the stall watchdog reconnects as it does natively.
    readyState: {
      get: () => (readyState === 4 && !paused && (waiting || Date.now() - progressAt > STALL_MS) ? 2 : readyState),
    },
    networkState: { get: () => networkState },
    error: { get: () => error },
    videoWidth: { get: () => width },
    videoHeight: { get: () => height },
    audioTracks: { get: () => audioTracks },
    currentSrc: { get: () => url },
    play: {
      value: () => {
        if (paused) {
          paused = false;
          start();
        }
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        if (paused) return;
        paused = true;
        if (prepared) {
          try { av.pause(); } catch { /* already paused or stopped */ }
        }
        fire('pause');
      },
    },
    // Player resets an element with load(); that ends this playback.
    load: {
      value: () => {
        release();
        HTMLMediaElement.prototype.load.call(video);
      },
    },
  };
  for (const name of BACKED) {
    Object.defineProperty(video, name, { configurable: true, ...values[name] });
  }

  ensureSurface();
  root.classList.add('avplay-active');

  const release = () => {
    if (released) return;
    released = true;
    if (bufferingTimer !== null) clearTimeout(bufferingTimer);
    observer?.disconnect();
    window.removeEventListener('resize', syncRect);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const name of BACKED) delete (video as unknown as Record<string, unknown>)[name];
    try { av.stop(); } catch { /* not started */ }
    try { av.close(); } catch { /* not open */ }
    root.classList.remove('avplay-active', 'avplay-playing');
    HOLE.forEach(name => root.style.removeProperty(name));
  };

  fire('loadstart');
  try {
    av.open(url);
    av.setListener({
      onbufferingstart: () => {
        if (bufferingTimer !== null || waiting) return;
        bufferingTimer = setTimeout(() => {
          bufferingTimer = null;
          waiting = true;
          fire('waiting');
        }, BUFFERING_GRACE_MS);
      },
      onbufferingcomplete: () => {
        if (bufferingTimer !== null) clearTimeout(bufferingTimer);
        bufferingTimer = null;
        if (!waiting) return;
        waiting = false;
        if (!paused) fire('playing');
      },
      oncurrentplaytime: (ms: unknown) => {
        if (typeof ms !== 'number') return;
        if (ms / 1000 !== time) progressAt = Date.now();
        time = ms / 1000;
        fire('timeupdate');
      },
      onstreamcompleted: () => {
        ended = true;
        paused = true;
        fire('pause');
        fire('ended');
      },
      onerror: (type: unknown) => fail(String(type).indexOf('UNSUPPORTED') >= 0 ? 4 : 2, String(type)),
    });
    av.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX');
    syncRect();
    av.prepareAsync(() => {
      if (released) return;
      prepared = true;
      const tracks = av.getTotalTrackInfo();
      const videoTrack = tracks.filter(t => t.type === 'VIDEO')[0];
      if (videoTrack) {
        const info = extra(videoTrack);
        width = Number(info.Width) || 0;
        height = Number(info.Height) || 0;
      }
      setAudioList(tracks.filter(t => t.type === 'AUDIO'));
      readyState = 1;
      fire('durationchange');
      fire('loadedmetadata');
      readyState = 4;
      networkState = 1;
      fire('loadeddata');
      fire('canplay');
      syncRect();
      start();
    }, () => fail(4, 'prepare'));
  } catch {
    fail(4, 'open');
  }

  return { release };
}
