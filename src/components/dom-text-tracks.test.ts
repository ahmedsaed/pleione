// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { DomTextTracks } from './dom-text-tracks';

// jsdom has no VTTCue; the tracks need only its timing and HTML.
function cue(startTime: number, endTime: number, text: string): TextTrackCue {
  return {
    startTime,
    endTime,
    text,
    getCueAsHTML: () => {
      const fragment = document.createDocumentFragment();
      const span = document.createElement('span');
      span.className = 'cyan';
      span.textContent = text;
      fragment.appendChild(span);
      return fragment;
    },
  } as unknown as TextTrackCue;
}

const overlay = () => document.querySelector('.cue-overlay');
const shown = () => [...document.querySelectorAll('.cue-overlay .cue')].map(line => line.textContent);

afterEach(() => { document.body.textContent = ''; });

describe('DomTextTracks', () => {
  it('lists its tracks like a TextTrackList', () => {
    const tracks = new DomTextTracks();
    const first = tracks.add('subtitles', 'Track 1', 'l1', { id: '3' });
    tracks.add('subtitles', 'Track 2', 'l2');

    expect(tracks.list.length).toBe(2);
    expect(tracks.list[0]).toBe(first);
    expect([tracks.list[1].label, tracks.list[1].language]).toEqual(['Track 2', 'l2']);
    expect(tracks.list.getTrackById('3')).toBe(first);
    expect(first.mode).toBe('disabled');
  });

  it('shows the cues of a showing track at the media time, with their HTML', () => {
    const tracks = new DomTextTracks();
    const track = tracks.add('subtitles', '', '');
    track.addCue(cue(1, 4, 'First'));
    track.addCue(cue(6, 9, 'Second'));

    tracks.render(2);
    expect(shown()).toEqual([]);
    track.mode = 'showing';
    expect(shown()).toEqual(['First']);
    expect(overlay()!.querySelector('.cue span.cyan')).not.toBeNull();

    tracks.render(5);
    expect(shown()).toEqual([]);
    tracks.render(7);
    expect(shown()).toEqual(['Second']);
    track.mode = 'disabled';
    expect(shown()).toEqual([]);
  });

  it('lets WebVttCueTrack-style callers shift and remove cues', () => {
    const tracks = new DomTextTracks();
    const track = tracks.add('subtitles', '', '');
    track.mode = 'showing';
    const first = cue(1, 4, 'First');
    track.addCue(first);
    expect(track.cues.length).toBe(1);

    tracks.render(2);
    expect(shown()).toEqual(['First']);
    track.removeCue(first);
    expect(track.cues.length).toBe(0);
    expect(shown()).toEqual([]);
  });

  it('honors a cue\'s own line, position and alignment', () => {
    const tracks = new DomTextTracks();
    const track = tracks.add('subtitles', '', '');
    track.mode = 'showing';
    track.addCue(Object.assign(cue(0, 9, 'Top'), { line: 10, snapToLines: false, position: 30, align: 'left' }));
    track.addCue(Object.assign(cue(0, 9, 'Last line'), { line: -1, snapToLines: true }));
    track.addCue(cue(0, 9, 'Plain'));
    tracks.render(1);
    const [top, last, plain] = [...document.querySelectorAll<HTMLElement>('.cue-overlay .cue')];
    expect([top.style.position, top.style.top, top.style.left, top.style.textAlign])
      .toEqual(['absolute', '10%', '30%', 'left']);
    expect([last.style.bottom, last.style.left]).toEqual(['0em', '50%']);
    expect(plain.style.position).toBe('');
  });

  it('stays gone once destroyed, when subtitle services tidy their cues late', () => {
    const tracks = new DomTextTracks();
    const track = tracks.add('subtitles', '', '');
    track.mode = 'showing';
    const first = cue(0, 9, 'First');
    track.addCue(first);
    tracks.render(1);
    tracks.destroy();
    track.removeCue(first);
    tracks.place({ left: 0, top: 0, width: 10, height: 10 });
    expect(overlay()).toBeNull();
  });

  it('places its overlay over the video and sizes cues as Blink does', () => {
    const tracks = new DomTextTracks();
    tracks.place({ left: 1104, top: 144, width: 736, height: 414 });
    const style = (overlay() as HTMLElement).style;
    expect([style.left, style.top, style.width, style.height]).toEqual(['1104px', '144px', '736px', '414px']);
    expect(style.fontSize).toBe('21px');
    expect(style.padding).toBe('0px 37px 19px');

    tracks.destroy();
    expect(overlay()).toBeNull();
  });
});
