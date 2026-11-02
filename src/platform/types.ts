// What the app needs from the TV platform it was built for (`__PLATFORM__`).
// Everything else in the app is platform-neutral.
export interface Platform {
  readonly name: 'webos' | 'tizen';
  /** Leave the app, from Back on Home. */
  exit(): void;
  /** Whether Back on Home asks before exiting (Samsung's Return policy) or closes at once (LG's). */
  readonly confirmExitAtHome: boolean;
  /** The parameters the app was cold-launched with (a reminder's channel), or undefined. */
  coldLaunchParams(): unknown;
  /** Calls `cb` with the parameters of each relaunch while the app is open. */
  onRelaunch(cb: (params: unknown) => void): void;
  readonly media: {
    /** Play on the TV's own pipeline instead of an MSE library (false in the desktop preview). */
    nativePipeline(): boolean;
    /** The TV draws in-band captions (CEA-608/708) itself, switched through the platform. */
    nativeCaptionCompositor(): boolean;
  };
}
