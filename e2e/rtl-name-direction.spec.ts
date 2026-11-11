import { seedXtream } from './fixtures/xtream';
import type { Locator } from '@playwright/test';
import { test, expect, enterTab, type Page } from './helpers';

// An untrusted name reads in its own direction (docs/rtl-layout.md §3): in
// a right-to-left locale a long Latin name keeps its start in view and
// truncates at its end, a short one still sits at the right, and an Arabic
// name reads right to left.

const LONG_LATIN = 'Alpha Documentaries and Nature Specials from Around the World in Ultra High '
  + 'Definition with Extended Commentary and Bonus Material for Every Season';
const LONG_ARABIC = 'ألفا وثائقيات وبرامج الطبيعة الخاصة من جميع أنحاء العالم بجودة عالية جدا '
  + 'مع تعليق موسع ومواد إضافية لكل موسم من المواسم';
const SHORT_LATIN = 'Bravo';

const CATEGORIES = [LONG_LATIN, LONG_ARABIC, SHORT_LATIN, 'Cat D', 'Cat E', 'Cat F']
  .map((name, i) => ({ category_id: String(i + 1), category_name: name }));
const MOVIES = [LONG_LATIN, SHORT_LATIN, LONG_ARABIC].map((name, i) => ({
  stream_id: 100 + i, name, stream_icon: '', container_extension: 'mp4', category_id: '1',
}));
const CHANNELS = [LONG_LATIN, SHORT_LATIN, LONG_ARABIC].map((name, i) => ({
  num: i + 1, stream_id: i + 1, name, stream_icon: '', epg_channel_id: `ch${String(i + 1)}`,
  category_id: '1', direct_source: `http://host/ch${String(i + 1)}.m3u8`, tv_archive: 0,
}));

async function seedNames(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await seedXtream(page);
  // Registered after seedXtream's route, so it answers first.
  await page.route('**/player_api.php*', (route) => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('get_vod_categories')) return json(CATEGORIES);
    if (url.includes('get_vod_streams')) {
      const category = new URL(url).searchParams.get('category_id');
      return json(category === '1' || !category ? MOVIES : []);
    }
    if (url.includes('get_live_categories')) return json([{ category_id: '1', category_name: 'Group 1' }]);
    if (url.includes('get_live_streams')) return json(CHANNELS);
    return route.fallback();
  });
  await page.addInitScript((value) => localStorage.setItem('iptv_locale', JSON.stringify(value)), locale);
}

interface NameLayout {
  direction: string;
  overflows: boolean;
  // The first character's box lies inside the element's.
  startInside: boolean;
  // Gaps between the text and the element's edges.
  leftGap: number;
  rightGap: number;
}

// A string: the simulation's engine lacks what Playwright needs to return
// an object.
async function nameLayout(name: Locator): Promise<NameLayout> {
  return JSON.parse(await name.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let first: Text | null = null;
    while (!first && walker.nextNode()) {
      if (/\S/.test((walker.currentNode as Text).data)) first = walker.currentNode as Text;
    }
    if (!first) return JSON.stringify(null);
    const offset = first.data.search(/\S/);
    const range = document.createRange();
    range.setStart(first, offset);
    range.setEnd(first, offset + 1);
    const glyph = range.getBoundingClientRect();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return JSON.stringify({
      direction: getComputedStyle(el).direction,
      overflows: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      startInside: glyph.left >= box.left - 1 && glyph.right <= box.right + 1,
      leftGap: Math.round(text.left - box.left),
      rightGap: Math.round(box.right - text.right),
    });
  })) as NameLayout;
}

// A long Latin name: left to right, overflowing its box with its start in view.
async function expectLatinStart(name: Locator): Promise<void> {
  await expect(name).toBeVisible();
  expect(await nameLayout(name)).toEqual(expect.objectContaining({
    direction: 'ltr', overflows: true, startInside: true,
  }));
}

// A long Arabic name: right to left, overflowing with its start in view.
async function expectArabicStart(name: Locator): Promise<void> {
  await expect(name).toBeVisible();
  expect(await nameLayout(name)).toEqual(expect.objectContaining({
    direction: 'rtl', overflows: true, startInside: true,
  }));
}

// A short name sits at the layout's start edge: the right in RTL.
async function expectAtSide(name: Locator, side: 'left' | 'right'): Promise<void> {
  await expect(name).toBeVisible();
  const layout = await nameLayout(name);
  expect(layout.overflows).toBe(false);
  expect(Math.abs(side === 'right' ? layout.rightGap : layout.leftGap)).toBeLessThanOrEqual(1);
  expect(side === 'right' ? layout.leftGap : layout.rightGap).toBeGreaterThan(10);
}

test.describe('in a right-to-left locale', () => {
  test.use({ startOn: 'home' });

  test('a poster tile and a category pill show the start of a long Latin name', async ({ page }) => {
    await seedNames(page, 'ar');
    await page.goto('/');
    await enterTab(page, 'movies');
    const view = page.locator('#view-movies .catalog-layer-browse');
    const tile = (id: number) => view.locator(`.catalog-tile[data-item-id="${String(id)}"] .catalog-tile-name`).first();
    await expectLatinStart(tile(100));
    await expectAtSide(tile(101), 'right');
    await expectArabicStart(tile(102));

    const pill = (id: string) => view.locator(`.catalog-pill[data-category-id="${id}"] .pill-chip-label`);
    await expectLatinStart(pill('1'));
    await expectArabicStart(pill('2'));
  });

  test('a Search channel tile shows the start of a long Latin name, its match marked',
    async ({ page }) => {
      await seedNames(page, 'ar');
      await page.goto('/');
      await enterTab(page, 'search');
      const view = page.locator('#view-search');
      await view.locator('.search-box-input').fill('Documentaries');
      const name = view.locator('.search-channel-card .search-channel-name').first();
      await expect(name.locator('mark.search-match')).toHaveText('Documentaries');
      // Clamped to two lines, the last one ending in the ellipsis.
      expect(await nameLayout(name)).toEqual(expect.objectContaining({
        direction: 'ltr', overflows: true, startInside: true,
      }));
      // A movie's name too, with its match.
      const movie = view.locator('.search-poster-tile[data-stream-id="100"] .catalog-tile-name');
      await expect(movie.locator('mark.search-match')).toHaveText('Documentaries');
      await expectLatinStart(movie);
    });

  test('a Live row shows the start of a long Latin name, and a short one sits at the right',
    async ({ page }) => {
      await seedNames(page, 'ar');
      await page.goto('/');
      await enterTab(page, 'live');
      const rows = page.locator('#view-channels .channel-main .channel-item .channel-name');
      await expect(rows).toHaveCount(3);
      await expectLatinStart(rows.nth(0));
      await expectAtSide(rows.nth(1), 'right');
      await expectArabicStart(rows.nth(2));
    });
});

test.describe('in a left-to-right locale', () => {
  test.use({ startOn: 'home' });

  test('names lay out left to right, as before', async ({ page }) => {
    await seedNames(page, 'en');
    await page.goto('/');
    await enterTab(page, 'movies');
    const view = page.locator('#view-movies .catalog-layer-browse');
    const tile = (id: number) => view.locator(`.catalog-tile[data-item-id="${String(id)}"] .catalog-tile-name`).first();
    await expectLatinStart(tile(100));
    await expectAtSide(tile(101), 'left');
    expect(await tile(100).getAttribute('dir')).toBeFalsy();
  });
});
