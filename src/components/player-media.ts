// The media Player plays through: the <video> element itself, or a
// platform player behind it (Samsung's AVPlay, src/platform/tizen-avplay.ts)
// that reports the same state and fires the same media events. DOM work
// (position, classes, the Live preview's rectangle) stays on the element.
export interface PlayerMedia {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly networkState: number;
  readonly error: { readonly code: number; readonly message: string } | null;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly seekable: TimeRanges;
  readonly buffered: TimeRanges;
  readonly currentSrc: string;
  readonly audioTracks?: AudioTrackList;
  readonly textTracks: TextTrackList;
  addTextTrack(kind: TextTrackKind, label?: string, language?: string): TextTrack;
  muted: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** An empty TimeRanges, for media without a seekable or buffered range. */
export const NO_RANGES: TimeRanges = {
  length: 0,
  start(): number { throw new RangeError('No range'); },
  end(): number { throw new RangeError('No range'); },
};

// The element satisfies PlayerMedia as it is; this fails to compile if the
// interface ever asks for something the element does not have.
export function elementMedia(video: HTMLVideoElement): PlayerMedia {
  return video;
}
