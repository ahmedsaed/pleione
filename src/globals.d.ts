declare const __APP_ID__: string;
declare const __APP_VERSION__: string;
declare const __SERVICE_ID__: string;
declare const __ENABLE_PSEUDO_LOCALE__: boolean;
// 1, or 2/3 in the 1280x720 package for LG's Full HD TVs.
declare const __UI_BASE_SCALE__: number;

// TypeScript's DOM lib dropped the multi-track interfaces (they're disabled by
// default in most browsers), but LG's webOS WebView populates them from the
// native media pipeline — so declare the subset we use. See
// docs/audio-track-selection.md.
interface AudioTrack {
  enabled: boolean;
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly language: string;
}

interface AudioTrackList extends EventTarget {
  readonly length: number;
  getTrackById(id: string): AudioTrack | null;
  [index: number]: AudioTrack;
}

interface HTMLMediaElement {
  readonly audioTracks?: AudioTrackList;
}
