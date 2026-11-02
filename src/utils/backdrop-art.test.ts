import { describe, expect, it } from 'vitest';
import { linearLine, normalizeStops, parseBackgroundImage, parseGradient, splitTopLevel } from './backdrop-art';

describe('splitTopLevel', () => {
  it('splits layers and arguments at commas outside parentheses', () => {
    expect(splitTopLevel('radial-gradient(a, rgba(1, 2, 3, 0.5)), linear-gradient(b, c)'))
      .toEqual(['radial-gradient(a, rgba(1, 2, 3, 0.5))', 'linear-gradient(b, c)']);
  });
});

describe('parseGradient', () => {
  it('reads a computed elliptical radial gradient with a sized ellipse and position', () => {
    expect(parseGradient('radial-gradient(1000px 650px at 90% 95%, rgba(194, 24, 91, 0.28), rgba(0, 0, 0, 0) 60%)')).toEqual({
      kind: 'radial', rx: 1000, ry: 650, x: { unit: '%', value: 90 }, y: { unit: '%', value: 95 },
      stops: [{ color: 'rgba(194, 24, 91, 0.28)', at: 0 }, { color: 'rgba(0, 0, 0, 0)', at: 0.6 }],
    });
  });

  it('reads a computed linear gradient with an angle and three stops', () => {
    expect(parseGradient('linear-gradient(160deg, rgb(11, 13, 46) 0%, rgb(7, 8, 28) 55%, rgb(13, 7, 24) 100%)')).toEqual({
      kind: 'linear', angle: 160,
      stops: [{ color: 'rgb(11, 13, 46)', at: 0 }, { color: 'rgb(7, 8, 28)', at: 0.55 }, { color: 'rgb(13, 7, 24)', at: 1 }],
    });
  });

  it('turns a px stop on a radial gradient into a fraction of its ray', () => {
    const g = parseGradient('radial-gradient(200px 100px at 50% 50%, red, transparent 100px)');
    expect(g?.stops.map(s => s.at)).toEqual([0, 0.5]);
  });

  it('gives up on shapes it does not paint, so the CSS keeps the gradient', () => {
    expect(parseGradient('radial-gradient(circle at center, red, blue)')).toBeNull();
    expect(parseGradient('conic-gradient(red, blue)')).toBeNull();
    expect(parseGradient('linear-gradient(to right, red 2em, blue)')).toBeNull();
  });
});

describe('parseBackgroundImage', () => {
  it('reads every layer top first, and none for no image', () => {
    const layers = parseBackgroundImage(
      'radial-gradient(1000px 650px at 90% 95%, red, transparent 60%), linear-gradient(160deg, blue 0%, green 100%)');
    expect(layers?.map(l => l.kind)).toEqual(['radial', 'linear']);
    expect(parseBackgroundImage('none')).toEqual([]);
    // A base layer that resolved to a color (`var(--bg-primary)`) is `none`.
    expect(parseBackgroundImage('radial-gradient(10px 10px at 50% 50%, red, blue), none')?.length).toBe(1);
  });

  it('is null when any layer is unreadable or an image', () => {
    expect(parseBackgroundImage('url("a.png"), linear-gradient(red, blue)')).toBeNull();
  });
});

describe('normalizeStops', () => {
  it('spreads stops without a position evenly and keeps the order monotonic', () => {
    expect(normalizeStops([{ color: 'a', at: null }, { color: 'b', at: null }, { color: 'c', at: null }])
      .map(s => s.at)).toEqual([0, 0.5, 1]);
    expect(normalizeStops([{ color: 'a', at: 0.6 }, { color: 'b', at: 0.2 }]).map(s => s.at)).toEqual([0.6, 0.6]);
  });
});

describe('linearLine', () => {
  it('runs a 180deg gradient straight down the box', () => {
    const [x0, y0, x1, y1] = linearLine(180, 1920, 1080);
    expect([x0, y0, x1, y1].map(v => Math.round(v) + 0)).toEqual([960, 0, 960, 1080]);
  });

  it('runs 90deg from the left edge to the right', () => {
    const [x0, y0, x1, y1] = linearLine(90, 1920, 1080);
    expect([x0, y0, x1, y1].map(v => Math.round(v) + 0)).toEqual([0, 540, 1920, 540]);
  });
});
