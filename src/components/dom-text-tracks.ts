// Text tracks drawn in the page, for media whose picture is not the
// <video> element's own (Samsung's AVPlay draws on the video plane under
// the page, where Blink cannot show a TextTrack). The tracks behave like
// TextTrack and the list like TextTrackList, so the subtitle code that
// feeds the element's tracks (WebVttCueTrack, PlayerTracks) feeds these
// unchanged; an overlay over the video's rectangle shows the active cues,
// styled like ::cue (css/player.css).

type Cue = TextTrackCue & {
  getCueAsHTML?: () => DocumentFragment;
  text?: string;
  line?: number | string;
  snapToLines?: boolean;
  position?: number | string;
  align?: string;
};

// A cue's own placement (WebVTT settings; SRT positions arrive as these too).
// Without any, it stacks at the bottom center. Line heights match .cue-overlay.
function placeCue(line: HTMLElement, cue: Cue): void {
  const align = cue.align;
  if (align === 'start' || align === 'left') line.style.textAlign = 'left';
  else if (align === 'end' || align === 'right') line.style.textAlign = 'right';
  const hasLine = typeof cue.line === 'number';
  const hasPosition = typeof cue.position === 'number';
  if (!hasLine && !hasPosition) return;
  line.style.position = 'absolute';
  if (hasLine) {
    const value = cue.line as number;
    if (cue.snapToLines === false) line.style.top = `${value}%`;
    else if (value >= 0) line.style.top = `${value * 1.25}em`;
    else line.style.bottom = `${(-value - 1) * 1.25}em`;
  } else {
    line.style.bottom = '4.5%';
  }
  line.style.left = `${hasPosition ? cue.position as number : 50}%`;
  line.style.transform = 'translateX(-50%)';
}

export class DomTextTrack {
  readonly id: string;
  readonly inBandMetadataTrackDispatchType = '';
  /** Subtitle Sync's offset (s), for a track whose cues arrive as they fall due. */
  cueOffset = 0;
  private current: TextTrackMode = 'disabled';
  private readonly list: Cue[] = [];

  constructor(
    readonly kind: TextTrackKind,
    readonly label: string,
    readonly language: string,
    private readonly changed: () => void,
    private readonly modeSet?: (mode: TextTrackMode) => void,
    id = '',
  ) {
    this.id = id;
  }

  get mode(): TextTrackMode { return this.current; }
  set mode(mode: TextTrackMode) {
    if (mode === this.current) return;
    this.current = mode;
    this.modeSet?.(mode);
    this.changed();
  }

  get cues(): TextTrackCueList {
    return this.list as unknown as TextTrackCueList;
  }

  addCue(cue: TextTrackCue): void {
    this.list.push(cue as Cue);
    this.list.sort((a, b) => a.startTime - b.startTime);
    this.changed();
  }

  removeCue(cue: TextTrackCue): void {
    const i = this.list.indexOf(cue as Cue);
    if (i >= 0) this.list.splice(i, 1);
    this.changed();
  }

  /** The cues on screen at `time`. */
  activeAt(time: number): Cue[] {
    if (this.current !== 'showing') return [];
    return this.list.filter(cue => cue.startTime <= time && time < cue.endTime);
  }
}

export class DomTextTracks {
  private readonly tracks: DomTextTrack[] = [];
  readonly list: TextTrackList;
  private overlay: HTMLElement | null = null;
  private time = 0;
  private shown: Cue[] = [];
  // Subtitle services still tidy their cues after the media has gone.
  private destroyed = false;

  constructor() {
    const tracks = this.tracks;
    const noop = (): void => {};
    this.list = {
      get length(): number { return tracks.length; },
      getTrackById: (id: string) => (tracks.filter(t => t.id === id)[0] ?? null) as unknown as TextTrack | null,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => true,
    } as unknown as TextTrackList;
  }

  /** A new track, listed and drawn with the others. */
  add(
    kind: TextTrackKind,
    label: string,
    language: string,
    options: { id?: string; modeSet?: (mode: TextTrackMode) => void } = {},
  ): DomTextTrack {
    const track = new DomTextTrack(kind, label, language, () => this.render(this.time), options.modeSet, options.id);
    (this.list as unknown as Record<number, DomTextTrack>)[this.tracks.length] = track;
    this.tracks.push(track);
    return track;
  }

  /** Draw the cues on screen at `time` (seconds on the media clock). */
  render(time: number): void {
    if (this.destroyed) return;
    this.time = time;
    const active: Cue[] = [];
    for (const track of this.tracks) active.push(...track.activeAt(time));
    if (active.length === this.shown.length && active.every((cue, i) => cue === this.shown[i])) return;
    this.shown = active;
    const overlay = this.ensureOverlay();
    overlay.textContent = '';
    for (const cue of active) {
      const line = document.createElement('div');
      line.className = 'cue';
      if (cue.getCueAsHTML) line.appendChild(cue.getCueAsHTML());
      else line.textContent = cue.text ?? '';
      placeCue(line, cue);
      overlay.appendChild(line);
    }
  }

  /** Place the overlay over the video's rectangle. */
  place(rect: { left: number; top: number; width: number; height: number }): void {
    if (this.destroyed) return;
    const style = this.ensureOverlay().style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    // Blink sizes cues at 5% of the video's height. Percent padding would
    // resolve against the screen, not this box.
    style.fontSize = `${Math.max(12, Math.round(rect.height * 0.05))}px`;
    style.padding = `0 ${Math.round(rect.width * 0.05)}px ${Math.round(rect.height * 0.045)}px`;
  }

  destroy(): void {
    this.destroyed = true;
    this.overlay?.remove();
    this.overlay = null;
    this.shown = [];
  }

  private ensureOverlay(): HTMLElement {
    if (this.overlay?.parentNode) return this.overlay;
    const overlay = document.createElement('div');
    overlay.className = 'cue-overlay';
    document.body.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }
}
