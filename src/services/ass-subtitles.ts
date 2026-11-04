import type { PlayerMedia } from '../components/player-media';
import type { SidecarSubtitle } from '../types';
import { fetchText } from '../utils/fetch-helper';
import { createLogger } from '../utils/logger';

const log = createLogger('AssSubs');

const OVERLAY_ID = 'ass-overlay';

// A sidecar we render with assjs rather than a native <track>: the .ass/.ssa
// files, matched by URL extension (query string / hash tolerated, case-insensitive).
export function isAssSidecar(url: string): boolean {
  const ext = (url.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  return ext === 'ass' || ext === 'ssa';
}

// The subset of the assjs instance we drive.
interface AssInstance {
  destroy(): unknown;
  hide(): unknown;
  show(): unknown;
  delay?: number;
}

/**
 * Renders `.ass` / `.ssa` sidecar subtitles for VOD with `assjs` — a DOM/CSS ASS
 * renderer, so the browser does font fallback (no bundled fonts) and it degrades
 * gracefully at the compatibility floor. assjs is loaded with a lazy dynamic
 * `import('assjs')`, so a TV that never plays ASS never loads it. One track draws
 * at a time, into an `#ass-overlay` positioned over the video plane.
 */
const CLOCK_EVENTS = ['play', 'pause', 'playing', 'waiting', 'seeking'];

export class AssSubtitles {
  private video: HTMLVideoElement | null = null;
  private media: PlayerMedia | null = null;
  private clock: { element: HTMLElement; release(): void } | null = null;
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private sidecars: SidecarSubtitle[] = [];
  private ass: AssInstance | null = null;
  private gen = 0; // bumped on attach/show/hide/destroy; in-flight shows bail when it changes
  private delay = 0; // per-stream subtitle timing offset (seconds; + = later)

  // Record the video, the DOM host for the overlay, and the ASS sidecars. No
  // assjs instance is created yet — that waits for the first `show`. `media`
  // is what plays, when that is not the element itself (Samsung's AVPlay).
  attach(video: HTMLVideoElement, container: HTMLElement, sidecars: SidecarSubtitle[], media?: PlayerMedia): void {
    this.gen++;
    this.destroyInstance();
    this.video = video;
    this.media = media && media !== video ? media : null;
    this.container = container;
    this.sidecars = sidecars;
    if (sidecars.length) log.info('recorded', sidecars.length, 'ASS sidecar(s)');
  }

  // Show the i-th recorded ASS sidecar: lazily load assjs, fetch the body, and
  // render it into the overlay. Any prior instance is torn down first (one track
  // at a time).
  async show(index: number): Promise<void> {
    this.destroyInstance();
    const sidecar = this.sidecars[index];
    const video = this.video;
    if (!sidecar || !video) return;
    const gen = ++this.gen;
    try {
      const [{ default: ASS }, content] = await Promise.all([
        import('assjs'),
        sidecar.text != null ? Promise.resolve(sidecar.text) : fetchText(sidecar.url),
      ]);
      if (gen !== this.gen) return; // a newer selection/stop landed mid-fetch
      const overlay = this.ensureOverlay();
      if (!overlay) return;
      const clock = this.media ? this.clockFor(this.media, video, overlay) : video;
      this.ass = new ASS(content, clock as HTMLVideoElement, { container: overlay }) as unknown as AssInstance;
      if (this.delay) { try { this.ass.delay = this.delay; } catch { /* older assjs */ } }
      log.info('showing ASS sidecar', sidecar.name || sidecar.lang || sidecar.url);
    } catch (e) {
      log.warn('ASS load failed:', e);
    }
  }

  // Stop drawing (destroys the instance) while keeping the overlay for reuse.
  /** Shift ASS cues by `seconds` via assjs's `delay`. Remembered so a later `show`
   *  re-applies it. Positive = subtitles appear later. */
  setOffset(seconds: number): void {
    this.delay = seconds;
    if (this.ass) { try { this.ass.delay = seconds; } catch { /* older assjs */ } }
  }

  hide(): void {
    this.gen++; // cancel any in-flight show
    this.destroyInstance();
  }

  // Full teardown: destroy the instance, drop the overlay and forget state.
  destroy(): void {
    this.gen++;
    this.destroyInstance();
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this.video = null;
    this.media = null;
    this.container = null;
    this.sidecars = [];
  }

  private destroyInstance(): void {
    this.clock?.release();
    this.clock = null;
    if (!this.ass) return;
    try { this.ass.destroy(); } catch (e) { log.warn('ASS destroy failed:', e); }
    this.ass = null;
  }

  // assjs takes its clock from a <video>: it reads currentTime, paused and the
  // picture's size, listens for play/pause/seek, and watches the element's
  // size. When the platform's own player plays (the element itself stays
  // idle), it gets a hidden element over the video's box that reads from that
  // player and relays its events.
  private clockFor(media: PlayerMedia, video: HTMLVideoElement, host: HTMLElement): HTMLElement {
    const element = document.createElement('div');
    element.className = 'ass-clock';
    const rect = video.getBoundingClientRect();
    element.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;`
      + `width:${rect.width}px;height:${rect.height}px;visibility:hidden;pointer-events:none`;
    Object.defineProperties(element, {
      currentTime: { get: () => media.currentTime },
      paused: { get: () => media.paused },
      videoWidth: { get: () => media.videoWidth },
      videoHeight: { get: () => media.videoHeight },
    });
    const relays = CLOCK_EVENTS.map(type => {
      const relay = (): void => { element.dispatchEvent(new Event(type)); };
      media.addEventListener(type, relay);
      return () => media.removeEventListener(type, relay);
    });
    host.appendChild(element);
    this.clock = {
      element,
      release: () => {
        relays.forEach(stop => stop());
        element.remove();
      },
    };
    return element;
  }

  private ensureOverlay(): HTMLElement | null {
    if (this.overlay) return this.overlay;
    if (!this.container) return null;
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    this.container.appendChild(el);
    this.overlay = el;
    return el;
  }
}
