// Draws the Samsung TV Seller Office images into store/samsung/ from the
// app's logo (assets/icon.svg) and the store captures in store/screenshots/
// (`npm run screenshots:store`). Seller Office wants JPG screenshots and
// background, which the website's PNG renderer cannot make, so headless
// Chromium draws and encodes every file here.
//
//   npm run store:samsung
//
// Sizes and limits: store/samsung/README.md. Dev-only; nothing here ships.

import { chromium } from '@playwright/test';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'store/samsung');

// In listing order. Seller Office takes exactly four, and some TV models skip
// the third, so the third is the one the listing can most afford to lose.
export const SAMSUNG_SHOTS = ['home', 'guide', 'movies', 'player'];

// The logo's navy and its sky, as the website draws them (site/lib/render.tsx).
const SKY = 'radial-gradient(circle at 78% 30%, #1d2a6e 0%, rgba(11,13,46,0) 55%), '
  + 'radial-gradient(circle at 30% 90%, #3a1d6e 0%, rgba(11,13,46,0) 55%), linear-gradient(#0b0d2e, #07081c)';
const STARS = [
  [140, 120, 2], [380, 260, 1.5], [620, 90, 2.5], [860, 210, 1.5], [1010, 70, 2],
  [1340, 140, 1.5], [1720, 90, 2.5], [1830, 320, 1.5], [1600, 860, 2], [1820, 980, 1.5],
  [960, 980, 2], [700, 760, 1.5], [420, 900, 2.5], [180, 640, 1.5], [90, 980, 2],
  [520, 470, 1.5], [800, 520, 2], [260, 380, 1.5], [1500, 540, 1.5], [1180, 900, 2.5],
];
const STAR_COLORS = ['#c06bff', '#7cc4ff', '#ffffff'];

const svg = await readFile(join(ROOT, 'assets/icon.svg'), 'utf8');
// The mark alone, without the icon's navy square, for the transparent logo.
const mark = svg.replace(/<rect width="80" height="80" fill="#0b0d2e"\/>\s*/, '');

const stars = STARS.map(([x, y, r], i) =>
  `<i style="left:${x}px;top:${y}px;width:${r * 2}px;height:${r * 2}px;background:${STAR_COLORS[i % 3]}"></i>`).join('');

const shot = async (name) =>
  `data:image/png;base64,${(await readFile(join(ROOT, 'store/screenshots', `${name}.png`))).toString('base64')}`;

const page = (body, background = 'transparent') => `<!doctype html><html><head><style>
  .shot { position: absolute; border-radius: 22px; border: 2px solid rgba(255,255,255,.14);
    box-shadow: 0 40px 120px rgba(0,0,0,.6); }
  .front { left: 900px; top: 250px; width: 1180px; height: 664px; }
  .back { left: 1180px; top: 110px; width: 900px; height: 506px; opacity: .55; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${background}; }
  .fill { position: absolute; inset: 0; background-image: ${SKY}; }
  i { position: absolute; border-radius: 50%; opacity: .35; }
  svg { position: absolute; }
</style></head><body>${body}</body></html>`;

const sized = (markup, size, style) =>
  markup.replace('width="160" height="160"', `width="${size}" height="${size}" style="${style}"`);

// Each file: its size, how to draw it, and its format and byte limit.
const FILES = [
  {
    // The 1920x1080 icon as a logo over a background; Seller Office composes
    // them and crops the 1:1 icon from the center, so the mark stays inside it.
    name: 'icon-logo-1920x1080.png', width: 1920, height: 1080, limit: 300_000,
    html: page(sized(mark, 640, 'left:640px;top:220px')),
  },
  {
    name: 'icon-background-1920x1080.jpg', width: 1920, height: 1080, limit: 300_000,
    html: page(`<div class="fill"></div>${stars}`),
  },
  {
    name: 'icon-512x423.png', width: 512, height: 423, limit: 300_000, opaque: true,
    html: page(`<div class="fill"></div>${sized(mark, 340, 'left:86px;top:41px')}`, '#0b0d2e'),
  },
  {
    // The store's detail page behind the app's name and description. Seller
    // Office darkens the left 40% under its own text, so the app itself fills
    // the right 60%: Live and Movies, as a TV shows them, running off the
    // edge, with no words of our own.
    name: 'background-1920x1080.jpg', width: 1920, height: 1080, limit: 2_000_000,
    html: page(`<div class="fill"></div>${stars}
      <img class="shot back" src="${await shot('movies')}">
      <img class="shot front" src="${await shot('live')}">`),
  },
];

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

async function draw(width, height, html, path, { jpeg, limit, opaque }) {
  const tab = await browser.newPage({ viewport: { width, height } });
  await tab.setContent(html, { waitUntil: 'load' });
  // Lower the JPEG quality only as far as the byte limit needs.
  for (let quality = 92; ; quality -= 4) {
    await tab.screenshot(jpeg
      ? { path, type: 'jpeg', quality }
      : { path, type: 'png', omitBackground: !opaque });
    const { size } = await stat(path);
    if (size <= limit) break;
    if (!jpeg || quality <= 60) throw new Error(`${path} is ${size} bytes, over ${limit}`);
  }
  await tab.close();
  console.log(`  ${path.slice(ROOT.length + 1)} (${Math.round((await stat(path)).size / 1000)} kB)`);
}

for (const file of FILES) {
  await draw(file.width, file.height, file.html, join(OUT, file.name),
    { jpeg: file.name.endsWith('.jpg'), limit: file.limit, opaque: file.opaque });
}

// A screen that differs in the store package comes from its Samsung capture
// (`npm run screenshots:store -- --samsung`), when there is one.
const capture = async (name) => {
  try {
    return await readFile(join(ROOT, 'store/samsung/captures', `${name}.png`));
  } catch {
    return readFile(join(ROOT, 'store/screenshots', `${name}.png`));
  }
};

for (const [i, shot] of SAMSUNG_SHOTS.entries()) {
  const png = await capture(shot);
  const html = page(`<img src="data:image/png;base64,${png.toString('base64')}" width="1920" height="1080">`);
  await draw(1920, 1080, html, join(OUT, `screenshot-${i + 1}.jpg`), { jpeg: true, limit: 500_000 });
}

await browser.close();
