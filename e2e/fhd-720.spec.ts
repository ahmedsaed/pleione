import {
  test, expect, enterTab, neuterVideo, openGuide, pressKeys, routeLiveManifest, routePlaylist, seedPlaylist,
  type Page,
} from './helpers';
import { seedXtream } from './fixtures/xtream';

// The 1280x720 package for LG's Full HD TVs (issue #62): the 1920x1080
// design scaled by 2/3. Runs only in the `webos-720` project.
test.use({ startOn: 'live' });

const SCALE = 2 / 3;

async function seedInterfaceSize(page: Page, size: string): Promise<void> {
  await page.addInitScript((s) => {
    localStorage.setItem('iptv_interface_size', JSON.stringify(s));
  }, size);
}

// Focus targets the plane's edge cuts off: the part of each target its
// clipping ancestors leave visible must fit the 1280x720 viewport.
async function offscreenTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-focusable]'))) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || !el.offsetParent
        || getComputedStyle(el).visibility === 'hidden') continue;
      let left = rect.left;
      let top = rect.top;
      let right = rect.right;
      let bottom = rect.bottom;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const box = a.getBoundingClientRect();
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        right = Math.min(right, box.right);
        bottom = Math.min(bottom, box.bottom);
      }
      if (right <= left || bottom <= top) continue;
      if (left < -1 || top < -1 || right > W + 1 || bottom > H + 1) {
        const label = el.id || el.dataset.key || el.className.toString().split(' ')[0];
        out.push(`${label} [${Math.round(left)},${Math.round(top)} → ${Math.round(right)},${Math.round(bottom)}]`);
      }
    }
    return out;
  });
}

// The smallest font size of any visible text in `root`.
async function smallestText(page: Page, root: string): Promise<number> {
  return page.locator(root).evaluate((el) => {
    let min = Infinity;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const owner = n.parentElement;
      if (!owner || !(n.textContent ?? '').trim() || !owner.offsetParent) continue;
      const cs = getComputedStyle(owner);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      min = Math.min(min, parseFloat(cs.fontSize));
    }
    return min;
  });
}

test('the app lays its 1920x1080 design out on a 1280x720 plane', async ({ page }) => {
  await seedXtream(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  const plane = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas-width').trim(),
    body: document.body.getBoundingClientRect().width,
  }));
  expect(plane).toEqual({ width: 1280, height: 720, canvas: '1280px', body: 1280 });
  // LG's 20px floor on the 1080 plane is the same size on screen at 13.3px here.
  expect(await smallestText(page, '#view-channels')).toBeGreaterThanOrEqual(20 * SCALE - 0.1);
  await enterTab(page, 'home');
  expect(await smallestText(page, '#view-home')).toBeGreaterThanOrEqual(20 * SCALE - 0.1);
});

for (const size of ['100', '130']) {
  test(`at ${size}% every view keeps its targets on the 1280x720 plane`, async ({ page }) => {
    await seedXtream(page, { catalog: 'large' });
    await seedInterfaceSize(page, size);
    await page.goto('/');
    await expect(page.locator('#view-channels')).toBeVisible();

    expect(await offscreenTargets(page), 'Live').toEqual([]);
    await openGuide(page);
    expect(await offscreenTargets(page), 'Guide').toEqual([]);
    await pressKeys(page, 403);
    await expect(page.locator('#view-channels:not(.live-guide-mode)')).toBeVisible();

    for (const [section, view] of [
      ['home', '#view-home'],
      ['movies', '#view-movies'],
      ['series', '#view-series'],
    ] as const) {
      await enterTab(page, section);
      await expect(page.locator(view)).toBeVisible();
      await page.waitForTimeout(300);
      expect(await offscreenTargets(page), section).toEqual([]);
    }

    await enterTab(page, 'search');
    await expect(page.locator('.search-box-input')).toBeFocused();
    await page.locator('.search-box-input').fill('movie');
    await expect(page.locator('#view-search')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await offscreenTargets(page), 'search').toEqual([]);

    await enterTab(page, 'settings');
    await expect(page.locator('#view-settings')).toBeVisible();
    for (const category of ['general', 'sources', 'guide', 'appearance', 'playback', 'subtitles', 'advanced', 'data']) {
      await page.locator(`[data-settings-target="${category}"]`).click();
      await page.waitForTimeout(150);
      const save = await page.locator('#save-settings').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      expect(save.left, `${category}: Save sits on screen`).toBeGreaterThanOrEqual(-1);
      expect(save.top, `${category}: Save sits on screen`).toBeGreaterThanOrEqual(-1);
      expect(save.bottom, `${category}: Save sits on screen`).toBeLessThanOrEqual(721);
      expect(save.right, `${category}: Save sits on screen`).toBeLessThanOrEqual(1281);
    }
  });
}

test('the virtualized channel list keeps rows, D-pad, and pointer aligned at 2/3', async ({ page }) => {
  const m3u = ['#EXTM3U', ...Array.from({ length: 80 }, (_, i) => (
    `#EXTINF:-1 group-title="Group 1",Channel ${String(i + 1)}\nhttp://host/${String(i + 1)}.m3u8`))].join('\n');
  await routePlaylist(page, m3u);
  await seedPlaylist(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  // The virtualizer's stride (uiPx) matches the scaled CSS row height.
  const tops = await page.locator('#view-channels .channel-item').evaluateAll((rows) =>
    rows.slice(0, 3).map((row) => row.getBoundingClientRect().top));
  expect(tops[1] - tops[0]).toBeCloseTo(122 * SCALE, 0);
  expect(tops[2] - tops[1]).toBeCloseTo(122 * SCALE, 0);

  const focusedName = () => page.locator('#view-channels .channel-item.focused .channel-name').innerText();
  const start = Number((await focusedName()).replace(/\D+/g, ''));
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  expect(await focusedName()).toBe(`Channel ${String(start + 30)}`);
  const inside = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('#view-channels .channel-item.focused');
    const list = row?.closest<HTMLElement>('.channel-list-scroll, [data-nav-container]');
    if (!row || !list) return null;
    const r = row.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
  });
  expect(inside).toBe(true);

  // A pointer over a visible row's center targets that row, not a neighbor.
  const key = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('#view-channels .channel-item'));
    const list = rows[0]?.closest<HTMLElement>('[data-nav-container]');
    const l = list?.getBoundingClientRect();
    const visible = rows.filter((row) => {
      const r = row.getBoundingClientRect();
      return l && !row.classList.contains('focused') && r.top >= l.top && r.bottom <= l.bottom;
    });
    return visible[Math.floor(visible.length / 2)]?.dataset.key ?? null;
  });
  if (!key) throw new Error('no fully visible row');
  const target = page.locator(`#view-channels .channel-item[data-key="${key}"]`);
  const box = await target.boundingBox();
  if (!box) throw new Error('row has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(target).toHaveClass(/focused/);
});

test('the player controls fit the plane', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  await neuterVideo(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterTab(page, 'movies');
  await page.locator('#view-movies .catalog-layer-browse .catalog-tile').first()
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .catalog-layer-detail .detail-title')).toBeVisible();
  await page.locator('#view-movies [data-action="play"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#player-osd .osd-channel-name')).toBeVisible();
  expect(await offscreenTargets(page), 'player').toEqual([]);
});

test('the mirrored layout keeps its targets on the plane', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
  await seedXtream(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await offscreenTargets(page), 'Live').toEqual([]);
  await enterTab(page, 'home');
  await page.waitForTimeout(300);
  expect(await offscreenTargets(page), 'Home').toEqual([]);
  await enterTab(page, 'movies');
  await page.waitForTimeout(300);
  expect(await offscreenTargets(page), 'Movies').toEqual([]);
});
