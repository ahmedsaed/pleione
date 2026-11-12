// Movies and Series art: a backdrop drawn sharp, or a poster standing in for
// a missing one as a soft wash of its colors. Each loads before it shows and
// then fades in over a black background, so a slow image never holds the page
// and never pops in; the art of the previous title fades out at once, so it
// never stays up under the next one's title.
//
// The wash is a tiny canvas the GPU stretches over the art. A CSS blur(40px)
// over the full-screen layer cost webOS 4 about 80 MB of compositor memory per
// page, enough to get the app killed; the canvas is one 128x72 texture. A
// cross-origin poster taints the canvas, which only blocks reading pixels
// back, and nothing here does.

import { cssUrl } from './dom';

const BASE_WIDTH = 16;
const STEP_WIDTHS = [32, 64, 128];
// Bounds the first, largest scratch canvas a big poster needs.
const MAX_FIRST_WIDTH = 512;
// An SVG without an intrinsic size reports none; it is stretched whole.
const UNSIZED_WIDTH = 128;
const ASPECT = 9 / 16;
// Matches the sharp art's `background-position: center 25%`.
const FOCUS_Y = 0.25;
// The `.art-layer` opacity transition in css/catalog-view.css.
export const ART_FADE_MS = 260;
const SHOWN_ATTR = 'data-art-shown';
const LAYER = 'art-layer';
const IN = 'art-layer-in';

interface PendingArt { key: string; img: HTMLImageElement }
const pending = new WeakMap<HTMLElement, PendingArt>();

function canvas(doc: Document, width: number): HTMLCanvasElement {
  const el = doc.createElement('canvas');
  el.width = width;
  el.height = Math.round(width * ASPECT);
  return el;
}

/** The poster cropped like `background-size: cover`, averaged down to 16x9 and smoothed up. */
export function washCanvas(img: HTMLImageElement, doc: Document = document): HTMLCanvasElement | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // Halve down to the base, so each pixel averages the ones it covers: one
  // big shrink samples only a few, and a bright speck tints a whole region.
  const down: number[] = [];
  let width = Math.min(MAX_FIRST_WIDTH, Math.floor((w && h ? w : UNSIZED_WIDTH) / 2));
  for (; width > BASE_WIDTH; width = Math.floor(width / 2)) down.push(width);
  down.push(BASE_WIDTH);
  let current = canvas(doc, down[0]);
  const ctx = current.getContext('2d');
  if (!ctx) return null;
  if (w && h) {
    const sw = Math.min(w, h / ASPECT);
    const sh = sw * ASPECT;
    ctx.drawImage(img, (w - sw) / 2, (h - sh) * FOCUS_Y, sw, sh, 0, 0, current.width, current.height);
  } else {
    ctx.drawImage(img, 0, 0, current.width, current.height);
  }
  // Doubling steps back up keep the stretched wash free of a blocky grid.
  for (const next of down.slice(1).concat(STEP_WIDTHS)) {
    const el = canvas(doc, next);
    const nextCtx = el.getContext('2d');
    if (!nextCtx) return null;
    nextCtx.drawImage(current, 0, 0, el.width, el.height);
    current = el;
  }
  return current;
}

function keyOf(el: HTMLElement): string {
  const url = el.getAttribute('data-art') ?? '';
  return url ? `${el.hasAttribute('data-art-soft') ? 'soft' : 'sharp'} ${url}` : '';
}

/** The layer showing now: the newest one not already fading out. */
function liveLayer(el: HTMLElement): HTMLElement | null {
  for (let node = el.lastElementChild; node; node = node.previousElementSibling) {
    if (node.classList.contains(IN)) return node as HTMLElement;
  }
  return null;
}

function fadeOut(layer: HTMLElement): void {
  layer.classList.remove(IN);
  setTimeout(() => {
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  }, ART_FADE_MS);
}

function cancel(el: HTMLElement): void {
  const job = pending.get(el);
  if (!job) return;
  pending.delete(el);
  job.img.onload = null;
  job.img.onerror = null;
  // Drops the request when it is still in flight.
  job.img.src = '';
}

function show(el: HTMLElement, layer: HTMLElement, key: string): void {
  layer.classList.add(LAYER);
  layer.setAttribute(SHOWN_ATTR, key);
  el.appendChild(layer);
  const live = liveLayer(el);
  if (live) fadeOut(live);
  // Apply the transparent start before the class that fades it in.
  void layer.offsetWidth;
  layer.classList.add(IN);
}

function load(el: HTMLElement, key: string): void {
  const url = el.getAttribute('data-art') ?? '';
  const soft = el.hasAttribute('data-art-soft');
  const img = new Image();
  pending.set(el, { key, img });
  img.onload = () => {
    pending.delete(el);
    const doc = el.ownerDocument;
    // The art changed, or left the page, while this loaded.
    if (keyOf(el) !== key || !doc.documentElement.contains(el)) return;
    let layer: HTMLElement | null;
    if (soft) {
      layer = washCanvas(img, doc);
    } else {
      layer = doc.createElement('div');
      layer.style.backgroundImage = `url('${cssUrl(url)}')`;
    }
    if (layer) show(el, layer, key);
  };
  img.onerror = () => { pending.delete(el); };
  img.src = url;
}

/**
 * Bring every `[data-art]` element under root to its current art. Call it
 * after each morph that can render one; the element carries
 * `data-morph-preserve` so a re-render keeps its layers.
 */
export function paintArt(root: ParentNode): void {
  const els = root.querySelectorAll<HTMLElement>('[data-art]');
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const key = keyOf(el);
    const live = liveLayer(el);
    if (live && live.getAttribute(SHOWN_ATTR) === key) {
      cancel(el);
      continue;
    }
    if (live) fadeOut(live);
    if (pending.get(el)?.key === key) continue;
    cancel(el);
    if (key) load(el, key);
  }
}
