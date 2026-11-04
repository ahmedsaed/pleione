import { DomTextTracks, type DomTextTrack } from '../components/dom-text-tracks';
import { NO_RANGES } from '../components/player-media';
import { createLogger } from '../utils/logger';
import type { PlatformMedia } from './types';

// Samsung's AVPlay, for what the TV's <video> cannot do: raw MPEG-TS and
// track switching on Tizen 8+ (docs/tizen.md). It draws on the video plane
// under the page; AvplayMedia reports its state and fires the media events
// Player listens to, as the element does. The player's <video> element
// stays in the page only as the rectangle AVPlay draws into.

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
  setSilentSubtitle?(silent: boolean): void;
  getStreamingProperty?(name: string): string;
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

const BUFFERING_GRACE_MS = 1000;
const CUE_TICK_MS = 200;
const STALL_MS = 3000;
const SEEK_RETRIES = 12;
const SEEK_RETRY_MS = 500;
const SEEK_ANSWER_MS = 6000;
const SEEK_WARMUP_MS = 8000;
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

type Listener = (event: Event) => void;

function timeRange(start: number, end: number): TimeRanges {
  return {
    length: 1,
    start: (i: number) => { if (i !== 0) throw new RangeError('No range'); return start; },
    end: (i: number) => { if (i !== 0) throw new RangeError('No range'); return end; },
  };
}

export class AvplayMedia implements PlatformMedia {
  readonly currentSrc: string;
  readonly buffered = NO_RANGES;
  muted = false;
  volume = 1;
  readonly audioTracks: AudioTrackList;
  private readonly text = new DomTextTracks();

  private released = false;
  private prepared = false;
  private state = 0;
  private network = 2;
  private isPaused = false;
  private isEnded = false;
  private isSeeking = false;
  private time = 0;
  private failure: { code: number; message: string } | null = null;
  private width = 0;
  private height = 0;
  private audioIndexes: number[] = [];
  private audioSelected = 0;
  // AVPlay reports a buffering blip at every live TS segment; only a pause
  // the viewer can notice is a stall.
  private bufferingTimer: ReturnType<typeof setTimeout> | null = null;
  private waiting = false;
  private progressAt = 0;
  private suspended = false;
  // The stream's own text tracks, in AVPlay's numbering; the one showing,
  // and a choice waiting for playback (AVPlay refuses one before it plays).
  private textIndexes: number[] = [];
  private streamText: DomTextTrack[] = [];
  private textShowing = -1;
  private textPending = false;
  private audioPending = false;
  private queuedSeek: number | null = null;
  private seekRetry: ReturnType<typeof setTimeout> | null = null;
  private startAfterSeek = false;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private seekReopened = false;
  private playedAt = 0;
  private reopening = false;
  private lastDuration = NaN;
  private startOnShow = false;
  private timeAt = 0;
  private cueTimer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Record<string, Listener[]> = {};
  private readonly observer: MutationObserver | null;
  private readonly root = document.documentElement;
  private readonly syncRect = (): void => this.applyRect();
  private readonly onVisibility = (): void => this.visibilityChanged();

  constructor(private readonly av: AvplayApi, private readonly video: HTMLVideoElement, url: string) {
    this.currentSrc = url;
    this.audioTracks = this.createAudioList();
    // The element's own pipeline stops; dropping its source is enough, as a
    // pause() would read as the viewer pausing.
    video.removeAttribute('src');
    video.innerHTML = '';
    video.load();

    this.observer = typeof MutationObserver === 'function' ? new MutationObserver(this.syncRect) : null;
    this.observer?.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', this.syncRect);
    document.addEventListener('visibilitychange', this.onVisibility);
    ensureSurface();
    this.root.classList.add('avplay-active');
  }

  /** Open the stream; events start once Player listens. */
  start(): void {
    this.fire('loadstart');
    this.open(() => this.onPrepared());
  }

  private open(ready: () => void): void {
    const av = this.av;
    try {
      av.open(this.currentSrc);
      av.setListener({
        onbufferingstart: () => this.bufferingStarted(),
        onbufferingcomplete: () => this.bufferingEnded(),
        oncurrentplaytime: (ms: unknown) => {
          // While a seek runs, the position is its target, as on the element.
          if (typeof ms !== 'number' || this.isSeeking) return;
          if (ms / 1000 !== this.time) this.progressAt = Date.now();
          this.time = ms / 1000;
          this.timeAt = Date.now();
          this.renderCues();
          this.fire('timeupdate');
        },
        onstreamcompleted: () => {
          this.isEnded = true;
          this.isPaused = true;
          this.fire('pause');
          this.fire('ended');
        },
        onsubtitlechange: (duration: unknown, text: unknown) => this.inStreamText(Number(duration), String(text)),
        onerror: (type: unknown) => this.fail(String(type).indexOf('UNSUPPORTED') >= 0 ? 4 : 2, String(type)),
      });
      av.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX');
      this.applyRect();
      av.prepareAsync(ready, () => this.fail(4, 'prepare'));
    } catch {
      this.fail(4, 'open');
    }
  }

  get currentTime(): number { return this.time; }
  // AVPlay refuses a seek while one runs, so a newer target waits for the
  // running seek and replaces it; Player hears one seeking/seeked pair. A
  // refused seek reports its target as reached: the real position arrives
  // with the next time report, and Player's pending seek settles instead of
  // retrying a seek AVPlay keeps refusing.
  set currentTime(seconds: number) {
    if (!this.prepared || !Number.isFinite(seconds)) return;
    // As on the element, the position is the target from the assignment on.
    if (this.isSeeking) {
      this.time = seconds;
      this.timeAt = Date.now();
      this.queuedSeek = seconds;
      return;
    }
    if (!Number.isFinite(this.duration)) return;
    this.time = seconds;
    this.timeAt = Date.now();
    this.clearStreamCues();
    this.isSeeking = true;
    this.fire('seeking');
    this.seekNow(seconds);
  }

  private seekNow(seconds: number, attempt = 0): void {
    // A seek in the first seconds of playback freezes AVPlay (it answers
    // InvalidValuesError after 5 s); a seek before play() always lands, so
    // go that way at once (docs/tizen.md).
    if (this.playedAt > 0 && Date.now() - this.playedAt < SEEK_WARMUP_MS) {
      this.reopenAt(seconds);
      return;
    }
    let answered = false;
    const answer = (): boolean => {
      if (answered || this.released) return false;
      answered = true;
      if (this.seekTimer !== null) clearTimeout(this.seekTimer);
      this.seekTimer = null;
      return true;
    };
    const settle = (): void => {
      if (!answer()) return;
      this.seekSettled(seconds);
    };
    // For a few seconds after playback starts, AVPlay refuses a seek
    // (InvalidStateError) that it takes a moment later; retry the newest
    // target until it does, and report the seek only then. Any other refusal
    // (InvalidValuesError, after 5 s) means it froze: no retry helps.
    const refused = (error: unknown): void => {
      if (!answer()) return;
      if ((error as { name?: string } | null)?.name !== 'InvalidStateError') {
        log().warn('AVPlay froze on a seek', 'event=playback.avplay.seek.stuck',
          `targetMs=${Math.round(seconds * 1000)}`);
        this.reopenAt(this.queuedSeek ?? seconds);
        this.queuedSeek = null;
        return;
      }
      if (attempt < SEEK_RETRIES) {
        const next = this.queuedSeek ?? seconds;
        this.queuedSeek = null;
        this.seekRetry = setTimeout(() => {
          this.seekRetry = null;
          if (!this.released) this.seekNow(next, attempt + 1);
        }, SEEK_RETRY_MS);
        return;
      }
      let state = 'unknown';
      try { state = this.av.getState(); } catch { /* closed */ }
      const name = (error as { name?: string } | null)?.name ?? String(error);
      log().warn('AVPlay refused a seek', 'event=playback.avplay.seek.refused',
        `error=${name}`, `state=${state}`, `targetMs=${Math.round(seconds * 1000)}`, `attempts=${attempt + 1}`);
      this.seekSettled(seconds);
    };
    // Now and then AVPlay freezes on a seek; it may never answer at all.
    this.seekTimer = setTimeout(() => {
      if (!answer()) return;
      log().warn('AVPlay froze on a seek', 'event=playback.avplay.seek.stuck',
        `targetMs=${Math.round(seconds * 1000)}`);
      this.reopenAt(seconds);
    }, SEEK_ANSWER_MS);
    try {
      this.av.seekTo(Math.max(0, Math.round(seconds * 1000)), settle, refused);
    } catch (e) {
      refused(e);
    }
  }

  // Reopening the stream and seeking before it plays lands reliably; the
  // viewer sees a short buffering pause.
  private reopenAt(seconds: number): void {
    if (this.seekReopened) {
      this.isSeeking = false;
      this.reopening = false;
      this.fail(2, 'seek');
      return;
    }
    this.seekReopened = true;
    // AVPlay knows no duration until it is prepared again.
    if (!this.reopening) this.lastDuration = this.duration;
    this.reopening = true;
    try { this.av.stop(); } catch { /* already stopped */ }
    try { this.av.close(); } catch { /* already closed */ }
    this.open(() => {
      if (this.released) return;
      const resumed = (): void => {
        if (this.seekTimer !== null) clearTimeout(this.seekTimer);
        this.seekTimer = null;
        if (this.released) return;
        this.reopening = false;
        this.audioPending = this.audioSelected !== 0;
        this.textPending = this.textShowing >= 0;
        this.playedAt = 0;
        this.seekReopened = false;
        if (this.isPaused) {
          this.seekSettled(seconds);
        } else {
          this.startAfterSeek = true;
          this.seekSettled(seconds);
        }
      };
      this.seekTimer = setTimeout(() => this.reopenAt(seconds), SEEK_ANSWER_MS);
      try {
        this.av.seekTo(Math.max(0, Math.round(seconds * 1000)), resumed, resumed);
      } catch {
        resumed();
      }
    });
  }

  private seekSettled(seconds: number): void {
    if (this.released) return;
    const next = this.queuedSeek;
    this.queuedSeek = null;
    if (next !== null && next !== seconds) {
      this.seekNow(next);
      return;
    }
    this.seekReopened = false;
    this.isSeeking = false;
    this.time = seconds;
    this.timeAt = Date.now();
    this.progressAt = Date.now();
    this.fire('seeked');
    this.fire('timeupdate');
    if (this.startAfterSeek) {
      this.startAfterSeek = false;
      this.begin();
    }
  }

  // A live HLS window reads as Tizen's own <video> reports one: seekable
  // over the window, with a finite duration at its end, so the subtitle
  // service can anchor cues while live rewind stays off (docs/tizen.md).
  get duration(): number {
    if (!this.prepared) return NaN;
    if (this.reopening) return this.lastDuration;
    const live = this.liveWindow();
    const ms = this.av.getDuration();
    this.lastDuration = live ? live[1] : ms > 0 ? ms / 1000 : Infinity;
    return this.lastDuration;
  }

  get seekable(): TimeRanges {
    if (!this.prepared) return NO_RANGES;
    if (this.reopening) {
      return Number.isFinite(this.lastDuration) ? timeRange(0, this.lastDuration) : NO_RANGES;
    }
    const live = this.liveWindow();
    if (live) return timeRange(live[0], live[1]);
    const ms = this.av.getDuration();
    return ms > 0 ? timeRange(0, ms / 1000) : NO_RANGES;
  }

  get paused(): boolean { return this.isPaused; }
  get ended(): boolean { return this.isEnded; }
  get seeking(): boolean { return this.isSeeking; }
  get networkState(): number { return this.network; }
  get error(): { code: number; message: string } | null { return this.failure; }
  get videoWidth(): number { return this.width; }
  get videoHeight(): number { return this.height; }

  // AVPlay can stall without a word; a clock that stopped reads as short of
  // data, so the stall watchdog reconnects as it does natively.
  get readyState(): number {
    const stalled = this.waiting || Date.now() - this.progressAt > STALL_MS;
    return this.state === 4 && !this.isPaused && stalled ? 2 : this.state;
  }

  play(): Promise<void> {
    if (this.isPaused) {
      this.isPaused = false;
      this.begin();
    }
    return Promise.resolve();
  }

  pause(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    if (this.prepared) {
      try { this.av.pause(); } catch { /* already paused or stopped */ }
    }
    this.fire('pause');
  }

  get textTracks(): TextTrackList { return this.text.list; }

  /** The app's own cues (WebVTT segments, sidecar subtitles), drawn over the picture. */
  addTextTrack(kind: TextTrackKind, label = '', language = ''): TextTrack {
    return this.text.add(kind, label, language) as unknown as TextTrack;
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners[type];
    if (list) this.listeners[type] = list.filter(l => l !== listener);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    if (this.bufferingTimer !== null) clearTimeout(this.bufferingTimer);
    if (this.cueTimer !== null) clearInterval(this.cueTimer);
    if (this.seekRetry !== null) clearTimeout(this.seekRetry);
    if (this.seekTimer !== null) clearTimeout(this.seekTimer);
    this.text.destroy();
    this.observer?.disconnect();
    window.removeEventListener('resize', this.syncRect);
    document.removeEventListener('visibilitychange', this.onVisibility);
    try { this.av.stop(); } catch { /* not started */ }
    try { this.av.close(); } catch { /* not open */ }
    this.root.classList.remove('avplay-active', 'avplay-playing');
    HOLE.forEach(name => this.root.style.removeProperty(name));
  }

  private fire(type: string): void {
    if (this.released) return;
    const event = new Event(type);
    for (const listener of (this.listeners[type] ?? []).slice()) listener(event);
  }

  private onPrepared(): void {
    if (this.released) return;
    this.prepared = true;
    const tracks = this.av.getTotalTrackInfo();
    const videoTrack = tracks.filter(t => t.type === 'VIDEO')[0];
    if (videoTrack) {
      const info = extra(videoTrack);
      this.width = Number(info.Width) || 0;
      this.height = Number(info.Height) || 0;
    }
    this.setAudioList(tracks.filter(t => t.type === 'AUDIO'));
    this.setTextList(tracks.filter(t => t.type === 'TEXT'));
    this.state = 1;
    this.fire('durationchange');
    this.fire('loadedmetadata');
    this.state = 4;
    this.network = 1;
    this.fire('loadeddata');
    this.fire('canplay');
    this.applyRect();
    this.begin();
  }

  private begin(): void {
    if (this.released || this.isPaused || !this.prepared) return;
    if (document.hidden) {
      this.startOnShow = true;
      return;
    }
    // A seek made before playback (a resume position, on loadedmetadata)
    // completes first: AVPlay wedges if play() lands while it runs.
    if (this.isSeeking) {
      this.startAfterSeek = true;
      return;
    }
    try {
      this.av.play();
    } catch {
      this.fail(3, 'play');
      return;
    }
    this.root.classList.add('avplay-playing');
    this.playedAt = Date.now();
    this.progressAt = Date.now();
    this.timeAt = Date.now();
    if (this.audioPending) this.applyAudio();
    if (this.textPending) this.applyText();
    this.cueTimer ??= setInterval(() => this.renderCues(), CUE_TICK_MS);
    this.fire('play');
    this.fire('playing');
  }

  private fail(code: number, reason: string): void {
    if (this.released || this.failure) return;
    this.failure = { code, message: reason };
    this.network = 3;
    this.root.classList.remove('avplay-playing');
    log().warn('AVPlay playback failed', 'event=playback.avplay.error', `reason=${reason}`);
    this.fire('error');
  }

  private bufferingStarted(): void {
    if (this.bufferingTimer !== null || this.waiting) return;
    this.bufferingTimer = setTimeout(() => {
      this.bufferingTimer = null;
      this.waiting = true;
      this.fire('waiting');
    }, BUFFERING_GRACE_MS);
  }

  private bufferingEnded(): void {
    if (this.bufferingTimer !== null) clearTimeout(this.bufferingTimer);
    this.bufferingTimer = null;
    if (!this.waiting) return;
    this.waiting = false;
    if (!this.isPaused) this.fire('playing');
  }

  // The page above the plane is opaque, the views' backdrops included; once a
  // picture plays, the backdrop opens over this rectangle (css/main.css).
  private applyRect(): void {
    if (this.released) return;
    const r = this.video.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    HOLE.forEach((name, i) => this.root.style.setProperty(name, `${rect[i]}px`));
    this.text.place({ left: rect[0], top: rect[1], width: rect[2], height: rect[3] });
    try {
      this.av.setDisplayRect(rect[0], rect[1], rect[2], rect[3]);
    } catch { /* AVPlay rejects a rectangle outside its states; the next sync retries */ }
  }

  // Player stops live TV when the app is hidden but leaves a movie in place;
  // AVPlay must give the video plane back either way.
  private visibilityChanged(): void {
    if (this.released) return;
    if (!document.hidden && this.startOnShow) {
      this.startOnShow = false;
      this.begin();
      return;
    }
    if (!this.prepared) return;
    try {
      if (document.hidden && !this.suspended) {
        this.suspended = true;
        if (this.av.suspend) this.av.suspend(); else this.av.pause();
      } else if (!document.hidden && this.suspended) {
        this.suspended = false;
        if (this.av.restore) this.av.restore();
        // play() during a seek wedges AVPlay; the seek starts playback itself.
        if (this.isSeeking) this.startAfterSeek = true;
        else if (!this.isPaused) this.av.play();
        this.progressAt = Date.now();
      }
    } catch { /* the next visibility change tries again */ }
  }

  /** A live stream's window ("start|end" in ms), in seconds; null for a stream without one. */
  private liveWindow(): [number, number] | null {
    try {
      const match = /^(\d+)\|(\d+)$/.exec(this.av.getStreamingProperty?.('GET_LIVE_DURATION') ?? '');
      if (!match) return null;
      const start = Number(match[1]) / 1000;
      const end = Number(match[2]) / 1000;
      return end > start ? [start, end] : null;
    } catch {
      return null;
    }
  }

  // The media clock between AVPlay's time reports, for cue timing.
  private renderCues(): void {
    const running = !this.isPaused && !this.isSeeking && !this.waiting && this.state === 4;
    const elapsed = running ? Math.min(1, (Date.now() - this.timeAt) / 1000) : 0;
    this.text.render(this.time + elapsed);
  }

  // A stream's own text track: listed when AVPlay delivers its text, which
  // it does not for MP4's mov_text (docs/tizen.md).
  private setTextList(tracks: AvplayTrack[]): void {
    if (/\.(mp4|m4v|mov)(\?|$)/i.test(this.currentSrc)) return;
    tracks.forEach((track, i) => {
      const info = extra(track);
      const lang = typeof info.track_lang === 'string' ? info.track_lang : '';
      this.textIndexes.push(track.index);
      this.streamText.push(this.text.add('subtitles', '', lang, {
        id: String(track.index),
        modeSet: mode => this.textModeSet(i, mode),
      }));
    });
  }

  private textModeSet(i: number, mode: TextTrackMode): void {
    if (mode === 'showing') this.textShowing = i;
    else if (this.textShowing === i) this.textShowing = -1;
    this.textPending = true;
    if (this.prepared && this.av.getState() === 'PLAYING') this.applyText();
  }

  private applyText(): void {
    this.textPending = false;
    try {
      if (this.textShowing >= 0) {
        this.av.setSelectTrack('TEXT', this.textIndexes[this.textShowing]);
        this.av.setSilentSubtitle?.(false);
      } else {
        this.av.setSilentSubtitle?.(true);
      }
    } catch (e) {
      log().warn('Subtitle track switch failed', 'event=playback.avplay.text.failed',
        `error=${(e as { name?: string })?.name ?? 'unknown'}`);
    }
  }

  // AVPlay hands over each subtitle as text with its duration (ms), at the
  // time it is due.
  private inStreamText(durationMs: number, raw: string): void {
    if (this.textShowing < 0) return;
    const text = raw.replace(/\u0000/g, '').replace(/\r/g, '').trim();
    if (!text || !(durationMs > 0) || typeof VTTCue !== 'function') return;
    const track = this.streamText[this.textShowing];
    // Text arrives when it is due, so Subtitle Sync can delay it, not advance it.
    const start = this.time + Math.max(0, track.cueOffset);
    track.addCue(new VTTCue(start, start + durationMs / 1000, text));
    // Keep only the recent ones: a live stream never ends.
    const cues = track.cues;
    for (let i = cues.length - 1; i >= 0; i--) if (cues[i].endTime < start - 30) track.removeCue(cues[i]);
  }

  // AVPlay delivers a stream's text again after a seek.
  private clearStreamCues(): void {
    for (const track of this.streamText) {
      const cues = track.cues;
      for (let i = cues.length - 1; i >= 0; i--) track.removeCue(cues[i]);
    }
  }

  private createAudioList(): AudioTrackList {
    const list = { length: 0 } as unknown as AudioTrackList & Record<number, AudioTrack>;
    (list as unknown as { getTrackById: (id: string) => AudioTrack | null }).getTrackById = (id: string) => {
      const i = this.audioIndexes.indexOf(Number(id));
      return i >= 0 ? list[i] : null;
    };
    const noop = (): void => {};
    Object.assign(list, { addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true });
    return list;
  }

  private setAudioList(tracks: AvplayTrack[]): void {
    const list = this.audioTracks as unknown as Record<number, AudioTrack> & { length: number };
    for (let i = 0; i < list.length; i++) delete list[i];
    this.audioIndexes = tracks.map(t => t.index);
    tracks.forEach((track, i) => {
      const info = extra(track);
      const entry = {
        id: String(track.index),
        kind: i === 0 ? 'main' : 'alternative',
        label: '',
        language: typeof info.language === 'string' ? info.language : '',
      } as AudioTrack;
      Object.defineProperty(entry, 'enabled', {
        enumerable: true,
        get: () => this.audioSelected === i,
        set: (on: boolean) => this.selectAudio(i, on),
      });
      list[i] = entry;
    });
    (list as { length: number }).length = tracks.length;
  }

  // AVPlay switches tracks only while it plays; a choice made before (a
  // remembered one, applied on loadedmetadata) waits for playback.
  private selectAudio(i: number, on: boolean): void {
    if (!on || this.audioSelected === i || this.released) return;
    this.audioSelected = i;
    this.audioPending = true;
    if (this.prepared && this.av.getState() === 'PLAYING') this.applyAudio();
  }

  private applyAudio(): void {
    this.audioPending = false;
    try {
      this.av.setSelectTrack('AUDIO', this.audioIndexes[this.audioSelected]);
    } catch (e) {
      log().warn('Audio track switch failed', 'event=playback.avplay.audio.failed',
        `error=${(e as { name?: string })?.name ?? 'unknown'}`);
    }
  }
}

/** Play `url` through AVPlay into `video`'s rectangle. */
export function createAvplayMedia(av: AvplayApi, video: HTMLVideoElement, url: string): AvplayMedia {
  return new AvplayMedia(av, video, url);
}
