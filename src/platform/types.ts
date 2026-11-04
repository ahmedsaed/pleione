import type { PlayerMedia } from '../components/player-media';
import type { Action } from '../types';

export interface LanServiceStart {
  port: number;
  /** The app key that unlocks the service's app-only HTTP routes. */
  key: string | null;
}

/** The app's line to the LAN setup service where it is not Luna (webOS). */
export interface LanTransport {
  /** Start (or reach) the service; null when it cannot. */
  start(): Promise<LanServiceStart | null>;
  stop(): void;
  /** The service's change events (`{event}`); returns the unsubscribe. */
  subscribe(onEvent: (event: unknown) => void): () => void;
}

/** A stream the platform's own player plays into the <video> element's rectangle. */
export interface PlatformMedia extends PlayerMedia {
  /** Open the stream; call once its events are listened to. */
  start(): void;
  release(): void;
}

// What the app needs from the TV platform it was built for (`__PLATFORM__`).
// Everything else in the app is platform-neutral.
export interface Platform {
  readonly name: 'webos' | 'tizen';
  /** Boot hook, before the key handler starts (Tizen registers its remote keys). */
  start(): void;
  readonly keys: {
    /** The remote's Back key code. */
    readonly back: number;
    /** Key codes this platform adds to the shared map in CONFIG.KEYS. */
    readonly actions: Readonly<Record<number, Action>>;
  };
  /** Leave the app, from Back on Home. */
  exit(): void;
  /** The bundled LAN service is there: phone setup and playlist uploads. */
  readonly lanSetup: boolean;
  /** How the app reaches that service; null where it is Luna (webOS). */
  lanTransport(): LanTransport | null;
  /** Whether Back on Home asks before exiting (Samsung's Return policy) or closes at once (LG's). */
  readonly confirmExitAtHome: boolean;
  /** Whether adding a first source asks for privacy consent (Samsung's privacy guide). */
  readonly privacyConsent: boolean;
  /** The parameters the app was cold-launched with (a reminder's channel), or undefined. */
  coldLaunchParams(): unknown;
  /** Calls `cb` with the parameters of each relaunch while the app is open. */
  onRelaunch(cb: (params: unknown) => void): void;
  readonly media: {
    /** Play on the TV's own pipeline instead of an MSE library (false in the desktop preview). */
    nativePipeline(): boolean;
    /** The TV draws in-band captions (CEA-608/708) itself, switched through the platform. */
    nativeCaptionCompositor(): boolean;
    /** PlayReady goes through the platform's own DRM service (webOS Luna), not EME. */
    nativePlayReady(): boolean;
    /** Hold off the TV's screensaver while a video plays (Samsung's is the app's to switch). */
    keepAwake(on: boolean): void;
    /**
     * The platform's own player (Samsung's AVPlay) for `url`, drawing into
     * `video`'s rectangle. Absent where there is none; null when it cannot
     * be created.
     */
    createPlatformMedia?(video: HTMLVideoElement, url: string): PlatformMedia | null;
    /**
     * Play HLS, raw TS and single-file streams through `createPlatformMedia`
     * rather than the element, which lacks their tracks here (Tizen 8+).
     */
    prefersPlatformMedia?(): boolean;
  };
}
