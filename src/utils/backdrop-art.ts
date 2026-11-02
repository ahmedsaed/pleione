// The full-screen backdrops and Home's glows are CSS radial gradients, which a
// TV's software rasterizer repaints on every frame something above them
// changes: seconds per key press on a 2020 Samsung. This paints each one once,
// from its computed style, into a quarter-size canvas (soft gradients upscale
// without a visible difference) and hands the CSS the image instead. Probes
// read the gradients, so every theme, Interface size, plane, and direction
// stays exact; a gradient this cannot read keeps its CSS.

export interface GradientStop {
  color: string;
  /** 0..1 along the gradient line or ray; null until normalized. */
  at: number | null;
}

export type Gradient =
  | { kind: 'linear'; angle: number; stops: GradientStop[] }
  | { kind: 'radial'; rx: number; ry: number; x: Length; y: Length; stops: GradientStop[] };

export type Length = { unit: 'px' | '%'; value: number };

const BACKDROPS = ['home', 'live', 'epg', 'movies', 'series', 'search', 'settings'];
const GLOWS = ['live', 'epg', 'movies', 'series', 'search', 'settings'];
const SCALE = 0.25;
const ROOT_CLASS = 'backdrop-art';
const PROBE_CLASS = 'backdrop-art-probe';

/** Split at top-level commas, leaving commas inside parentheses. */
export function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

function parseLength(token: string): Length | null {
  const m = /^(-?\d*\.?\d+)(px|%)$/.exec(token);
  return m ? { unit: m[2] as 'px' | '%', value: Number(m[1]) } : null;
}

const KEYWORD_POSITION: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

function parsePosition(token: string): Length | null {
  if (token in KEYWORD_POSITION) return { unit: '%', value: KEYWORD_POSITION[token] };
  return parseLength(token);
}

function parseStop(text: string, rx: number): GradientStop | null {
  // The color comes first; an optional position follows its closing paren
  // or, for a named or hex color, the first space.
  const close = text.lastIndexOf(')');
  const split = close >= 0 ? close + 1 : text.indexOf(' ');
  const color = (split > 0 ? text.slice(0, split) : text).trim();
  const rest = split > 0 ? text.slice(split).trim() : '';
  if (!color) return null;
  if (!rest) return { color, at: null };
  const length = parseLength(rest);
  if (!length) return null;
  return { color, at: length.unit === '%' ? length.value / 100 : length.value / rx };
}

/** Fill in missing stop positions as CSS does: first 0, last 1, the rest spread evenly. */
export function normalizeStops(stops: GradientStop[]): GradientStop[] {
  const out = stops.map(s => ({ ...s }));
  if (out.length === 0) return out;
  if (out[0].at === null) out[0].at = 0;
  if (out[out.length - 1].at === null) out[out.length - 1].at = 1;
  for (let i = 1; i < out.length; i++) {
    if (out[i].at !== null) continue;
    let j = i;
    while (out[j].at === null) j++;
    const from = out[i - 1].at as number;
    const to = out[j].at as number;
    for (let k = i; k < j; k++) out[k].at = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  let last = 0;
  for (const s of out) {
    // A stop before an earlier one sits on it; canvas wants 0..1.
    last = Math.max(last, s.at as number);
    s.at = Math.min(1, Math.max(0, last));
  }
  return out;
}

/** One computed `linear-gradient(...)` or `radial-gradient(WIDTHpx HEIGHTpx at X Y, ...)` layer. */
export function parseGradient(layer: string): Gradient | null {
  const m = /^(linear|radial)-gradient\((.*)\)$/.exec(layer.trim());
  if (!m) return null;
  const args = splitTopLevel(m[2]);
  if (m[1] === 'linear') {
    let angle = 180;
    const deg = /^(-?\d*\.?\d+)deg$/.exec(args[0]);
    if (deg) {
      angle = Number(deg[1]);
      args.shift();
    }
    const stops = args.map(a => parseStop(a, 1));
    if (stops.length < 2 || stops.some(s => s === null)) return null;
    return { kind: 'linear', angle, stops: normalizeStops(stops as GradientStop[]) };
  }
  const shape = /^(-?\d*\.?\d+)px (-?\d*\.?\d+)px at (\S+) (\S+)$/.exec(args[0]);
  if (!shape) return null;
  const rx = Number(shape[1]);
  const ry = Number(shape[2]);
  const x = parsePosition(shape[3]);
  const y = parsePosition(shape[4]);
  if (!x || !y || rx <= 0 || ry <= 0) return null;
  const stops = args.slice(1).map(a => parseStop(a, rx));
  if (stops.length < 2 || stops.some(s => s === null)) return null;
  return { kind: 'radial', rx, ry, x, y, stops: normalizeStops(stops as GradientStop[]) };
}

/** Every layer of a computed background-image, top first; null if any is not a gradient this reads. */
export function parseBackgroundImage(value: string): Gradient[] | null {
  if (!value || value === 'none') return [];
  // A layer whose value resolved to a color serializes as `none`: nothing to paint.
  const layers = splitTopLevel(value).filter(l => l !== 'none').map(parseGradient);
  return layers.some(l => l === null) ? null : layers as Gradient[];
}

/** Start and end of a CSS linear gradient line over a WxH box (angle 0 points up, clockwise). */
export function linearLine(angle: number, w: number, h: number): [number, number, number, number] {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half];
}

const resolve = (len: Length, size: number): number => (len.unit === '%' ? (len.value / 100) * size : len.value);

function draw(ctx: CanvasRenderingContext2D, layers: Gradient[], color: string, w: number, h: number): void {
  if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
  // CSS paints its first layer on top.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    ctx.save();
    let g: CanvasGradient;
    if (layer.kind === 'linear') {
      const [x0, y0, x1, y1] = linearLine(layer.angle, w, h);
      g = ctx.createLinearGradient(x0, y0, x1, y1);
    } else {
      ctx.translate(resolve(layer.x, w), resolve(layer.y, h));
      ctx.scale(1, layer.ry / layer.rx);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, layer.rx);
    }
    for (const stop of layer.stops) g.addColorStop(stop.at as number, stop.color);
    ctx.fillStyle = g;
    if (layer.kind === 'linear') ctx.fillRect(0, 0, w, h);
    else ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
    ctx.restore();
  }
}

const cache = new Map<string, string>();
let probes: HTMLElement | null = null;
let scheduled = false;

function probeRoot(): HTMLElement {
  if (probes && probes.isConnected) return probes;
  probes = document.createElement('div');
  probes.className = 'backdrop-art-probes';
  probes.setAttribute('aria-hidden', 'true');
  for (const name of BACKDROPS) {
    const el = document.createElement('div');
    el.className = PROBE_CLASS;
    el.setAttribute('data-backdrop', name);
    probes.appendChild(el);
  }
  for (const name of GLOWS) {
    const el = document.createElement('div');
    el.className = `${PROBE_CLASS} home-glow home-glow-${name}`;
    probes.appendChild(el);
  }
  document.body.appendChild(probes);
  return probes;
}

function imageFor(el: HTMLElement): string | null {
  const cs = getComputedStyle(el);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return null;
  const key = `${w}x${h}|${cs.backgroundColor}|${cs.backgroundImage}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const layers = parseBackgroundImage(cs.backgroundImage);
  if (!layers || layers.length === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * SCALE));
  canvas.height = Math.max(1, Math.round(h * SCALE));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);
  draw(ctx, layers, cs.backgroundColor, w, h);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

function paint(): void {
  const root = document.documentElement;
  const container = probeRoot();
  let painted = 0;
  for (const el of Array.from(container.children) as HTMLElement[]) {
    const name = el.getAttribute('data-backdrop');
    const glow = /home-glow-(\w+)/.exec(el.className)?.[1];
    const prop = name ? `--backdrop-art-${name}` : `--backdrop-art-glow-${glow}`;
    const url = imageFor(el);
    const value = url ? `url("${url}")` : '';
    // applyTheme() runs on every view change; an unchanged value costs no recalc.
    if (root.style.getPropertyValue(prop) !== value) {
      if (value) root.style.setProperty(prop, value);
      else root.style.removeProperty(prop);
    }
    if (url) painted++;
  }
  // All or nothing: a partial set would leave a view without its backdrop.
  root.classList.toggle(ROOT_CLASS, painted === container.children.length);
}

/** Repaint the backdrop images once the current task's style changes settle. */
export function scheduleBackdropArt(): void {
  if (scheduled || typeof document === 'undefined' || !document.body) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    paint();
  }, 0);
}

/** Paint now, and again whenever a stylesheet (an Interface size or direction swap) loads. */
export function installBackdropArt(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('load', (e) => {
    if ((e.target as HTMLElement | null)?.tagName === 'LINK') scheduleBackdropArt();
  }, true);
  scheduleBackdropArt();
}
