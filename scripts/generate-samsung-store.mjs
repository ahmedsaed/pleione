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

const page = (body, background = 'transparent') => `<!doctype html><html><head><style>
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
    // Seller Office darkens the left 40% under its own text, so the mark sits
    // in the right 60%, as on the LG launcher background.
    name: 'background-1920x1080.jpg', width: 1920, height: 1080, limit: 2_000_000,
    html: page(`<div class="fill"></div>${stars}${sized(svg, 420, 'left:1110px;top:330px;border-radius:96px')}`),
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

for (const [i, shot] of SAMSUNG_SHOTS.entries()) {
  const png = await readFile(join(ROOT, 'store/screenshots', `${shot}.png`));
  const html = page(`<img src="data:image/png;base64,${png.toString('base64')}" width="1920" height="1080">`);
  await draw(1920, 1080, html, join(OUT, `screenshot-${i + 1}.jpg`), { jpeg: true, limit: 500_000 });
}

await browser.close();
