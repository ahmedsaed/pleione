// @vitest-environment jsdom
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { html, raw } from './dom';
import { morph } from './morph';
import { ART_FADE_MS, paintArt, washCanvas } from './art-layer';

type Draw = { canvas: HTMLCanvasElement; args: unknown[] };

class FakeImage {
  static all: FakeImage[] = [];
  naturalWidth = 300;
  naturalHeight = 450;
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeImage.all.push(this); }
}

let draws: Draw[];
let host: HTMLElement;

beforeEach(() => {
  draws = [];
  FakeImage.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return { drawImage: (...args: unknown[]) => draws.push({ canvas, args }) } as unknown as CanvasRenderingContext2D;
  } as never);
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function render(url: string, soft: boolean): HTMLElement {
  morph(host, html`<div class="detail-art${soft ? ' detail-art-soft' : ''}" data-art="${url}"
                        ${raw(soft ? 'data-art-soft' : '')} data-morph-preserve></div>`);
  paintArt(host);
  return host.querySelector<HTMLElement>('.detail-art')!;
}

const last = () => FakeImage.all[FakeImage.all.length - 1];
const layers = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.art-layer'));
const shown = (el: HTMLElement) => layers(el).filter(l => l.classList.contains('art-layer-in'))
  .map(l => l.getAttribute('data-art-shown'));

describe('washCanvas', () => {
  it('crops a portrait poster like cover at 25%, averages it down to 16x9, and smooths it up', () => {
    const out = washCanvas(new FakeImage() as unknown as HTMLImageElement)!;
    expect([out.width, out.height]).toEqual([128, 72]);
    // Each step at most halves, so every pixel averages the ones it covers.
    expect(draws.map(d => d.canvas.width)).toEqual([150, 75, 37, 18, 16, 32, 64, 128]);
    expect(draws.map(d => d.canvas.height)).toEqual([84, 42, 21, 10, 9, 18, 36, 72]);
    // 300x450 poster: the full width, a 16:9 band a quarter of the way down.
    const [, sx, sy, sw, sh] = draws[0].args as number[];
    expect([sx, sw, sh]).toEqual([0, 300, 168.75]);
    expect(sy).toBeCloseTo((450 - 168.75) * 0.25);
  });

  it('bounds the first scratch canvas of a large poster', () => {
    washCanvas(Object.assign(new FakeImage(), { naturalWidth: 2000, naturalHeight: 3000 }) as unknown as HTMLImageElement);
    expect(draws.map(d => d.canvas.width)).toEqual([512, 256, 128, 64, 32, 16, 32, 64, 128]);
  });

  it('crops a wide image at its horizontal center', () => {
    washCanvas(Object.assign(new FakeImage(), { naturalWidth: 1000, naturalHeight: 300 }) as unknown as HTMLImageElement);
    const [, sx, sy, sw, sh] = draws[0].args as number[];
    expect(sw).toBeCloseTo(300 * 16 / 9);
    expect(sh).toBe(300);
    expect(sx).toBeCloseTo((1000 - sw) / 2);
    expect(sy).toBe(0);
  });

  it('stretches an SVG without an intrinsic size whole', () => {
    const out = washCanvas(Object.assign(new FakeImage(), { naturalWidth: 0, naturalHeight: 0 }) as unknown as HTMLImageElement);
    expect(out?.width).toBe(128);
    expect(draws[0].args).toEqual([expect.anything(), 0, 0, 64, 36]);
  });

  it('draws nothing without a 2D context', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(washCanvas(new FakeImage() as unknown as HTMLImageElement)).toBeNull();
  });
});

describe('paintArt', () => {
  it('shows nothing until the art loads, then fades it in', () => {
    const art = render('http://host/p1.jpg', true);
    expect(last().src).toBe('http://host/p1.jpg');
    expect(layers(art)).toHaveLength(0);
    last().onload!();
    expect(art.querySelector('canvas.art-layer.art-layer-in')).not.toBeNull();
    expect(shown(art)).toEqual(['soft http://host/p1.jpg']);
  });

  it('draws a backdrop sharp, its URL kept inside the CSS string', () => {
    const art = render("http://host/b.jpg') ; background: url('http://host/evil", false);
    last().onload!();
    const layer = art.querySelector<HTMLElement>('div.art-layer')!;
    expect(layer.getAttribute('style')).toBe(
      "background-image: url(\"http://host/b.jpg%27%29%20;%20background:%20url%28%27http://host/evil\");",
    );
  });

  it('keeps the art through a re-render without loading it again', () => {
    const art = render('http://host/p1.jpg', true);
    last().onload!();
    render('http://host/p1.jpg', true);
    expect(FakeImage.all).toHaveLength(1);
    expect(shown(art)).toEqual(['soft http://host/p1.jpg']);
  });

  it('fades the previous title out at once, not when the next one loads', () => {
    const art = render('http://host/p1.jpg', true);
    last().onload!();
    render('http://host/b2.jpg', false);
    // Title 2's text is up; title 1's art must not stay under it.
    expect(shown(art)).toEqual([]);
    vi.advanceTimersByTime(ART_FADE_MS);
    expect(layers(art)).toHaveLength(0);
    last().onload!();
    expect(shown(art)).toEqual(['sharp http://host/b2.jpg']);
  });

  it('cancels the load of a title focus moved past', () => {
    render('http://host/p1.jpg', true);
    const first = last();
    const art = render('http://host/p2.jpg', true);
    expect(first.src).toBe('');
    expect(first.onload).toBeNull();
    expect(FakeImage.all).toHaveLength(2);
    last().onload!();
    expect(shown(art)).toEqual(['soft http://host/p2.jpg']);
  });

  it('loads a title once while it is still loading', () => {
    render('http://host/p1.jpg', true);
    render('http://host/p1.jpg', true);
    expect(FakeImage.all).toHaveLength(1);
  });

  it('shows nothing when the art fails to load', () => {
    const art = render('http://host/p1.jpg', true);
    last().onerror!();
    expect(layers(art)).toHaveLength(0);
  });

  it('paints nothing into art that left the page while it loaded', () => {
    const art = render('http://host/p1.jpg', true);
    morph(host, html``);
    last().onload!();
    expect(layers(art)).toHaveLength(0);
  });
});

describe('art stylesheet', () => {
  const rules = (): string[] => readFileSync(resolve(__dirname, '../../css/catalog-view.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\{[^{}]*\}/g) ?? [];

  // A CSS blur on the full-screen soft art cost webOS 4 about 80 MB of
  // compositor memory per page and got the app killed.
  it('gives the soft art no filter', () => {
    const soft = rules().filter(rule => /-art-soft|art-layer/.test(rule.slice(0, rule.indexOf('{'))));
    expect(soft.length).toBeGreaterThan(0);
    for (const rule of soft) expect(rule).not.toMatch(/(^|[;{\s])(-webkit-)?filter\s*:/);
  });

  it('crops the already-cropped wash from its center, not again at 25%', () => {
    const layer = rules().find(rule => /^\s*\.art-layer\s*\{/.test(rule))!;
    expect(layer).toMatch(/object-position:\s*center\s*;/);
  });

  it('fades the art over ART_FADE_MS', () => {
    const layer = rules().find(rule => /^\s*\.art-layer\s*\{/.test(rule))!;
    expect(layer).toMatch(new RegExp(`transition:\\s*opacity ${ART_FADE_MS}ms`));
  });
});
