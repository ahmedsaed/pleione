import { test, expect, enterTab, isChromium53, pressBack, walkRailToEnd, type Page } from './helpers';

// Opened from Home's Live card after every load (see `startOn`).
test.use({ startOn: 'live' });

type Section = 'movies' | 'series';

// Eight categories of 25 titles: rails end in See all, and a pill for each
// category leads the six preloaded rails.
const categoryList = (count: number) => Array.from({ length: count }, (_, i) => ({
  category_id: String(i + 1), category_name: `Category ${i + 1}`,
}));
const CATEGORIES = categoryList(8);
// Long enough to fill every plot line the hero allows.
const LONG = ' More words follow here.'.repeat(30);
const titles = (categoryId: string) => Array.from({ length: 25 }, (_, i) => {
  const id = Number(categoryId) * 100 + i;
  return {
    stream_id: id, series_id: id, name: `Title ${categoryId}-${i}`,
    stream_icon: `http://host/p${id}.png`, cover: `http://host/p${id}.png`,
    container_extension: 'mp4', category_id: categoryId, year: String(2000 + i),
    // Only the series list carries these; get_vod_info supplies them for movies.
    genre: `Genre ${i}`, plot: `Plot of title ${categoryId}-${i}.${i % 3 === 2 ? LONG : ''}`,
    backdrop_path: [`http://host/b${id}.png`],
  };
});

async function seedCatalog(page: Page, vodInfoRequests: string[], categories = CATEGORIES): Promise<void> {
  await page.route('**/get.php*', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/xmltv.php*', route => route.fulfill({ contentType: 'application/xml', body: '<tv></tv>' }));
  await page.route('http://host/*.png', route => route.fulfill({ contentType: 'image/png', body: '' }));
  await page.route('**/player_api.php*', route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    const category = url.searchParams.get('category_id') ?? '1';
    let body: unknown = {};
    if (action === 'get_vod_categories' || action === 'get_series_categories') body = categories;
    else if (action === 'get_live_categories') body = [];
    else if (action === 'get_live_streams') body = [{ stream_id: 1, name: 'ch1', category_id: '1' }];
    else if (action === 'get_vod_streams') {
      body = titles(category).map(({ genre: _g, plot: _p, backdrop_path: _b, ...movie }) => movie);
    } else if (action === 'get_series') body = titles(category);
    else if (action === 'get_vod_info') {
      const id = url.searchParams.get('vod_id') ?? '';
      vodInfoRequests.push(id);
      const plot = `Info plot ${id}.${Number(id) % 100 === 4 ? LONG : ''}`;
      body = { info: { genre: `Info genre ${id}`, plot, releasedate: '2010-01-01' } };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{
      id: 'x1', name: 'Account 1', url: 'http://host', source: 'xtream',
      xtream: { username: 'u', password: 'p' },
    }]));
  });
}

const browse = (page: Page, section: Section) => page.locator(`#view-${section} .catalog-layer-browse`);

interface Geometry {
  railsTop: number;
  heroTop: number;
  heroBottom: number;
  focusedRailTop: number;
  focusedRailBottom: number;
  railsBottom: number;
  // Elements of the rails above the focused one that still show on screen.
  visibleAbove: number;
  heroTitle: string;
  focusedName: string;
  // How much of the next rail's first poster shows below the focused rail.
  nextPeek: number;
}

async function geometry(page: Page, section: Section): Promise<Geometry> {
  return browse(page, section).evaluate((layer) => {
    const rails = layer.querySelector<HTMLElement>('.catalog-rails')!;
    const hero = layer.querySelector<HTMLElement>('.catalog-hero')!;
    const focused = layer.querySelector<HTMLElement>('.catalog-rails .focused')!;
    const rail = focused.closest<HTMLElement>('.catalog-rail')!;
    const all = Array.from(rails.querySelectorAll<HTMLElement>('.catalog-rail'));
    const box = rails.getBoundingClientRect();
    let visibleAbove = 0;
    all.slice(0, all.indexOf(rail)).forEach(above => {
      Array.from(above.querySelectorAll<HTMLElement>('*')).concat(above).forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        // On screen only where the rail area does not clip it.
        if (Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 0.5) visibleAbove++;
      });
    });
    const heroBox = hero.getBoundingClientRect();
    const nextPoster = all[all.indexOf(rail) + 1]?.querySelector('.catalog-poster-wrap');
    return {
      nextPeek: nextPoster ? box.bottom - nextPoster.getBoundingClientRect().top : 0,
      railsTop: box.top,
      railsBottom: box.bottom,
      heroTop: heroBox.top,
      heroBottom: heroBox.bottom,
      focusedRailTop: rail.getBoundingClientRect().top,
      focusedRailBottom: rail.getBoundingClientRect().bottom,
      visibleAbove,
      heroTitle: hero.querySelector('.catalog-hero-title')?.textContent ?? '',
      focusedName: focused.querySelector('.catalog-tile-name')?.textContent ?? '',
    };
  });
}

// Waits for any smooth snap to land before measuring.
async function settled(page: Page, section: Section): Promise<Geometry> {
  let last = await geometry(page, section);
  await expect.poll(async () => {
    const next = await geometry(page, section);
    const same = Math.abs(next.focusedRailTop - last.focusedRailTop) < 0.5;
    last = next;
    return same;
  }).toBe(true);
  return last;
}

async function heroText(page: Page, section: Section) {
  return browse(page, section).evaluate((layer) => {
    const top = (selector: string) => layer.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    return {
      titleTop: top('.catalog-hero-title'),
      metaTop: top('.catalog-hero-meta'),
      plotBottom: layer.querySelector('.catalog-hero-plot')?.getBoundingClientRect().bottom ?? -1,
      heroBottom: layer.querySelector('.catalog-hero')!.getBoundingClientRect().bottom,
    };
  });
}

async function enterRails(page: Page, section: Section): Promise<void> {
  await enterTab(page, section);
  await expect(browse(page, section).locator('[data-rail-key="cat:1"] .catalog-tile').first()).toBeVisible();
  // The first key after a pointer tab click only shows the ring.
  await page.keyboard.press('ArrowDown');
  await expect(browse(page, section).locator('.catalog-rails .focused')).toHaveCount(1);
}

for (const section of ['movies', 'series'] as const) {
  test(`${section}: the hero follows focus over rails that snap one at a time`, async ({ page }) => {
    const requests: string[] = [];
    await seedCatalog(page, requests);
    await page.goto('/');
    await enterTab(page, section);
    const layer = browse(page, section);
    await expect(layer.locator('[data-rail-key="cat:1"] .catalog-tile').first()).toBeVisible();
    // No section label above the title, and no sort row on browse.
    await expect(layer.locator('.catalog-hero-kicker')).toHaveCount(0);
    await expect(layer.locator('.catalog-sort')).toHaveCount(0);
    // Nothing in the rails is focused yet: the hero shows the first title.
    await expect(layer.locator('.catalog-hero-title')).toHaveText('Title 1-0');
    // The list year, or (movies, after a rest) the details' year.
    await expect(layer.locator('.catalog-hero-meta')).toContainText(/\b(2000|2010)$/);

    await page.keyboard.press('ArrowDown');
    await expect(layer.locator('.catalog-rails .focused')).toHaveCount(1);
    const start = await settled(page, section);
    // The hero is the top half and never scrolls; the rails fill the rest.
    const viewBox = await page.locator(`#view-${section}`).boundingBox();
    expect(start.heroTop).toBeCloseTo(viewBox!.y, 0);
    expect(start.railsTop).toBeCloseTo(start.heroBottom, 0);
    expect(start.railsTop - viewBox!.y).toBeCloseTo(viewBox!.height / 2, 0);
    expect(start.railsBottom).toBeCloseTo(viewBox!.y + viewBox!.height, 0);

    await page.keyboard.press('ArrowRight');
    await expect(layer.locator('.catalog-hero-title')).toHaveText('Title 1-1');
    if (section === 'series') {
      await expect(layer.locator('.catalog-hero-meta')).toHaveText('Genre 1  ·  2001');
      await expect(layer.locator('.catalog-hero-plot')).toHaveText('Plot of title 1-1.');
      const short = await heroText(page, section);
      await page.keyboard.press('ArrowRight');
      await expect(layer.locator('.catalog-hero-plot')).toContainText('Plot of title 1-2. More words');
      const long = await heroText(page, section);
      expect(long.titleTop).toBe(short.titleTop);
      expect(long.metaTop).toBe(short.metaTop);
      expect(long.plotBottom).toBeGreaterThan(short.plotBottom);
      expect(long.plotBottom).toBeLessThanOrEqual(long.heroBottom);
      await page.keyboard.press('ArrowLeft');
      await expect(layer.locator('.catalog-hero-art')).toHaveAttribute('data-art', /b101\.png/);
    }

    for (let n = 1; n <= 3; n++) {
      await page.keyboard.press('ArrowDown');
      await expect(layer.locator(`[data-rail-key="cat:${n + 1}"] .focused`)).toHaveCount(1);
      const g = await settled(page, section);
      expect(g.focusedRailTop).toBeCloseTo(g.railsTop, 0);
      expect(g.visibleAbove).toBe(0);
      expect(g.focusedRailBottom).toBeLessThanOrEqual(g.railsBottom + 0.5);
      // The next rail's posters peek in, so the rails read as scrollable.
      expect(g.nextPeek).toBeGreaterThan(80);
      expect(g.heroTitle).toBe(g.focusedName);
      expect(g.heroTop).toBeCloseTo(start.heroTop, 0);
      expect(g.heroBottom).toBeCloseTo(start.heroBottom, 0);
    }
    // Left and Right still walk the rail out to See all.
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
    await expect(layer.locator('[data-rail-key="cat:4"] .catalog-see-all.focused')).toHaveCount(1);
    // Ten titles, then See all as the eleventh tile.
    const railTiles = layer.locator('[data-rail-key="cat:4"] .catalog-rail-track > .catalog-tile');
    await expect(railTiles).toHaveCount(11);
    await expect(railTiles.nth(10)).toHaveClass(/catalog-see-all/);
    await expect(railTiles.nth(10)).toContainText('25');
    await page.keyboard.press('ArrowUp');
    await expect(layer.locator('[data-rail-key="cat:3"] .focused')).toHaveCount(1);
    const up = await settled(page, section);
    expect(up.focusedRailTop).toBeCloseTo(up.railsTop, 0);
    expect(up.visibleAbove).toBe(0);

    // Up reaches the category pills above the first rail, and stops there.
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
    await expect(layer.locator('[data-rail-key="cat:1"] .focused')).toHaveCount(1);
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
    await expect(layer.locator('[data-rail-key="categories"] .catalog-pill.focused')).toHaveCount(1);
    const top = await settled(page, section);
    expect(top.focusedRailTop).toBeCloseTo(top.railsTop, 0);
    expect(top.nextPeek).toBeGreaterThan(80);
    await expect(layer.locator('.catalog-hero-title')).not.toHaveText('');

    // The category page keeps its sort row.
    await layer.locator('.catalog-see-all[data-category-id="1"]').dispatchEvent('nav:hover');
    await page.keyboard.press('Enter');
    await expect(page.locator(`#view-${section} .catalog-layer-grid .catalog-sort .dropdown-trigger`)).toBeVisible();
    // The category page still lists every title.
    await expect(page.locator(`#view-${section} .catalog-layer-grid .catalog-grid-track .catalog-tile`)).toHaveCount(25);
    if (section === 'series') expect(requests).toEqual([]);
  });

  test(`${section}: a key on a half-shown rail snaps it into place`, async ({ page }) => {
    await seedCatalog(page, []);
    await page.goto('/');
    await enterTab(page, section);
    const layer = browse(page, section);
    const tile = layer.locator('[data-rail-key="cat:2"] .catalog-tile').first();
    await expect(tile).toBeAttached();
    // Leave the second rail hanging off the bottom of the rail area.
    await layer.evaluate((el) => {
      const rails = el.querySelector<HTMLElement>('.catalog-rails')!;
      const rail = rails.querySelector<HTMLElement>('[data-rail-key="cat:2"]')!;
      rails.style.scrollBehavior = 'auto';
      rails.scrollTop = rail.getBoundingClientRect().top - rails.getBoundingClientRect().top
        + rails.scrollTop - rails.clientHeight / 2;
      rails.style.scrollBehavior = '';
    });
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await expect(tile).toHaveClass(/\bfocused\b/);
    // The pointer only lights it where it is.
    expect((await settled(page, section)).focusedRailTop).toBeGreaterThan((await geometry(page, section)).railsTop + 50);
    await page.keyboard.press('ArrowRight');
    await expect(layer.locator('[data-rail-key="cat:2"] .focused')).toHaveCount(1);
    const g = await settled(page, section);
    expect(g.focusedRailTop).toBeCloseTo(g.railsTop, 0);
    expect(g.visibleAbove).toBe(0);
  });

  // From the top, where the pills and the first rail show together.
  test(`${section}: the wheel steps the rails one at a time`, async ({ page }) => {
    await seedCatalog(page, []);
    await page.goto('/');
    await enterRails(page, section);
    const layer = browse(page, section);
    const box = (await layer.locator('.catalog-rails').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    for (const [delta, rail] of [[120, 'cat:1'], [120, 'cat:2'], [-120, 'cat:1']] as const) {
      await page.mouse.wheel(0, delta);
      await expect.poll(() => layer.evaluate((el, key) => {
        const rails = el.querySelector<HTMLElement>('.catalog-rails')!;
        const target = Array.from(rails.querySelectorAll<HTMLElement>('.catalog-rail'))
          .find(r => r.dataset.railKey === key)!;
        return Math.abs(Math.round(target.getBoundingClientRect().top - rails.getBoundingClientRect().top));
      }, rail)).toBe(0);
      // Past one burst's window, the next notch moves on.
      await page.waitForTimeout(300);
    }
    await expect(page.locator('#view-channels')).toBeHidden();
  });
}

test('movies: details wait for focus to rest a second and never fire while moving', async ({ page }) => {
  const requests: string[] = [];
  await seedCatalog(page, requests);
  await page.goto('/');
  await enterTab(page, 'movies');
  const layer = browse(page, 'movies');
  await expect(layer.locator('[data-rail-key="cat:1"] .catalog-tile').first()).toBeVisible();
  // The opening hero rests on the first title, so it is asked for once.
  await expect.poll(() => requests.length, { timeout: 3000 }).toBe(1);
  expect(requests).toEqual(['100']);
  await expect(layer.locator('.catalog-hero-meta')).toHaveText('Info genre 100  ·  2010');
  await expect(layer.locator('.catalog-hero-plot')).toHaveText('Info plot 100.');
  const opening = await heroText(page, 'movies');

  await page.keyboard.press('ArrowDown');
  await expect(layer.locator('.catalog-rails .focused')).toHaveCount(1);
  // Fast moves across rails and along them: no request, only list data shown.
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
  await expect(layer.locator('.catalog-hero-title')).toHaveText('Title 3-4');
  await expect(layer.locator('.catalog-hero-meta')).toHaveText('2004');
  await expect(layer.locator('.catalog-hero-plot')).toHaveCount(0);
  const waiting = await heroText(page, 'movies');
  await page.waitForTimeout(600);
  expect(requests).toEqual(['100']);
  await expect.poll(() => requests.length, { timeout: 3000 }).toBe(2);
  expect(requests[1]).toBe('304');
  await expect(layer.locator('.catalog-hero-plot')).toContainText('Info plot 304. More words');
  // Neither the details landing nor a longer plot moves the title or meta;
  // the plot grows down and stops short of the rails.
  const landed = await heroText(page, 'movies');
  expect(landed.titleTop).toBe(waiting.titleTop);
  expect(landed.metaTop).toBe(waiting.metaTop);
  expect(landed.titleTop).toBe(opening.titleTop);
  expect(landed.plotBottom).toBeGreaterThan(opening.plotBottom);
  expect(landed.plotBottom).toBeLessThanOrEqual(landed.heroBottom);
  // Back to a title already shown: nothing more is asked.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
  expect(requests).toEqual(['100', '304']);
});

test('fits one whole rail under the hero at Interface size 130 and text size 150', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iptv_interface_size', JSON.stringify('130'));
    localStorage.setItem('iptv_text_size', JSON.stringify('150'));
  });
  await seedCatalog(page, []);
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = browse(page, 'movies');
  // The pills and the first rail no longer fit together: that rail snaps
  // to the top on its own, whole.
  await expect(layer.locator('[data-rail-key="cat:1"] .focused')).toHaveCount(1);
  const opening = await settled(page, 'movies');
  expect(opening.focusedRailTop).toBeCloseTo(opening.railsTop, 0);
  expect(opening.focusedRailBottom).toBeLessThanOrEqual(opening.railsBottom + 0.5);
  for (let n = 1; n <= 3; n++) {
    await page.keyboard.press('ArrowDown');
    await expect(layer.locator(`[data-rail-key="cat:${n + 1}"] .focused`)).toHaveCount(1);
    const g = await settled(page, 'movies');
    expect(g.focusedRailTop).toBeCloseTo(g.railsTop, 0);
    expect(g.visibleAbove).toBe(0);
    expect(g.focusedRailBottom).toBeLessThanOrEqual(g.railsBottom + 0.5);
    expect(g.heroBottom - g.heroTop).toBeGreaterThan(0);
  }
  // Title, meta, and whatever plot lines fit stay whole inside the hero text
  // box: the plot drops lines rather than run into the rails.
  const clipped = await layer.evaluate((el) => {
    const body = el.querySelector('.catalog-hero-body')!.getBoundingClientRect();
    return Array.from(el.querySelectorAll('.catalog-hero-body > *'))
      .filter(child => getComputedStyle(child).display !== 'none')
      .map(child => child.getBoundingClientRect())
      .some(r => r.top < body.top - 0.5 || r.bottom > body.bottom + 0.5);
  });
  expect(clipped).toBe(false);
});

test('an All categories chip holds a two-line name at text size 150', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iptv_text_size', JSON.stringify('150'));
  });
  await seedCatalog(page, [], categoryList(30));
  await page.goto('/');
  await enterRails(page, 'movies');
  await openAllCategories(page);
  const chips = page.locator('#view-movies .catalog-layer-categories .catalog-cat');
  // A counted chip (a preloaded rail) and a name-only one.
  for (const id of ['1', '7']) {
    const box = await chips.and(page.locator(`[data-category-id="${id}"]`)).evaluate((el) => {
      const name = el.querySelector<HTMLElement>('.catalog-cat-name')!;
      // A name long enough to wrap to two lines at this size.
      name.textContent = 'Action & Adventure Classics';
      const own = el.getBoundingClientRect();
      const text = Array.from(el.children).map(child => child.getBoundingClientRect());
      return { lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
        textTop: Math.min(...text.map(r => r.top)), textBottom: Math.max(...text.map(r => r.bottom)),
        top: own.top, bottom: own.bottom };
    });
    // Two lines for the name alone; one beside a count.
    expect(box.lines).toBe(id === '1' ? 1 : 2);
    expect(box.textTop).toBeGreaterThanOrEqual(box.top);
    expect(box.textBottom).toBeLessThanOrEqual(box.bottom);
  }
});

// Focused posters and chips ring and glow with no drop shadow: unseen on dark
// themes, a smudge on light ones, and a chip's rail would clip it. The
// detail page's own poster keeps its shadow.
test('focused posters and category chips have no drop shadow; the detail poster keeps its own', async ({ page }) => {
  await seedCatalog(page, []);
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = browse(page, 'movies');
  // The y offset of each of an element's shadows.
  const offsets = (el: Element) => getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/)
    .map((shadow) => parseFloat((shadow.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) ?? [])[1] ?? '0'));

  const chip = layer.locator('.catalog-pill.focused');
  for (let i = 0; i < 8 && await chip.count() === 0; i++) await page.keyboard.press('ArrowUp');
  await expect(chip).toHaveCount(1);
  expect(await chip.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  expect(await chip.evaluate(offsets)).toEqual([0, 0]);
  // Every shadow ends inside the rail, which would clip it.
  const room = await chip.evaluate((el) => {
    const track = el.closest('.catalog-pill-track')!;
    const below = getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/).map((shadow) => {
      const [, y = 0, blur = 0, spread = 0] = (shadow.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) ?? [])
        .map(parseFloat);
      return y + blur + spread;
    });
    return track.getBoundingClientRect().bottom - (el.getBoundingClientRect().bottom + Math.max(...below));
  });
  expect(room).toBeGreaterThanOrEqual(0);

  await page.keyboard.press('ArrowDown');
  const poster = layer.locator('.catalog-tile.focused .catalog-poster-wrap');
  await expect(poster).toHaveCount(1);
  expect(await poster.evaluate(offsets)).toEqual([0, 0]);

  await page.keyboard.press('Enter');
  const detailPoster = page.locator('#view-movies .detail-poster-wrap');
  await expect(detailPoster).toBeVisible();
  expect(await detailPoster.evaluate(offsets)).toEqual([30]);
});

test('snaps smoothly to the same place under full animation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iptv_animation_mode', JSON.stringify('full'));
  });
  await seedCatalog(page, []);
  await page.goto('/');
  await enterRails(page, 'series');
  const layer = browse(page, 'series');
  await expect(layer.locator('.catalog-rails')).toHaveCSS('scroll-behavior', 'smooth');
  for (let n = 1; n <= 3; n++) {
    await page.keyboard.press('ArrowDown');
    await expect(layer.locator(`[data-rail-key="cat:${n + 1}"] .focused`)).toHaveCount(1);
    const g = await settled(page, 'series');
    expect(g.focusedRailTop).toBeCloseTo(g.railsTop, 0);
    expect(g.visibleAbove).toBe(0);
  }
});

// The focused poster lifts like a Home card, and its ring stays whole inside
// the rail, which clips overflow.
async function liftedAndUnclipped(page: Page, scope: string): Promise<void> {
  const tile = page.locator(`${scope} .catalog-tile.focused`);
  await expect(tile).toHaveCount(1);
  await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(1\.05, 0, 0, 1\.05/);
  const fit = await tile.evaluate((el) => {
    const ring = el.querySelector('.catalog-poster-wrap')!.getBoundingClientRect();
    const pad = 5; // outline 3px + offset 2px
    let clip = { top: -Infinity, bottom: Infinity };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
      const r = a.getBoundingClientRect();
      clip = { top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom) };
    }
    return { top: ring.top - pad - clip.top, bottom: clip.bottom - (ring.bottom + pad) };
  });
  expect(fit.top).toBeGreaterThanOrEqual(-0.5);
  expect(fit.bottom).toBeGreaterThanOrEqual(-0.5);
}

for (const section of ['movies', 'series'] as const) {
  test(`${section}: the focused poster lifts and keeps its whole ring in rails and the grid`, async ({ page }) => {
    await seedCatalog(page, []);
    await page.goto('/');
    await enterTab(page, section);
    const layer = browse(page, section);
    await expect(layer.locator('[data-rail-key="cat:1"] .catalog-tile').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await liftedAndUnclipped(page, `#view-${section} .catalog-layer-browse`);
    await page.keyboard.press('ArrowDown');
    await liftedAndUnclipped(page, `#view-${section} .catalog-layer-browse`);
    const unfocused = layer.locator('.catalog-tile:not(.focused)').first();
    expect(await unfocused.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

    // The category page's grid lifts its focused tile the same way.
    await layer.locator('[data-collection-see-all], .catalog-see-all-card').first().click();
    const grid = page.locator(`#view-${section} .catalog-layer-grid`);
    await expect(grid).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await liftedAndUnclipped(page, `#view-${section} .catalog-layer-grid`);
  });
}

test('Right at the end of a See all row moves to the next row, Left moves back', async ({ page }) => {
  await seedCatalog(page, []);
  await page.goto('/');
  await enterTab(page, 'movies');
  const layer = browse(page, 'movies');
  await expect(layer.locator('[data-rail-key="cat:1"] .catalog-tile').first()).toBeVisible();
  await layer.locator('[data-collection-see-all], .catalog-see-all-card').first().click();
  const grid = page.locator('#view-movies .catalog-layer-grid');
  await expect(grid).toBeVisible();
  const focused = grid.locator('.catalog-grid-cell:has(.catalog-tile.focused)');
  await expect(focused).toHaveCount(1);
  // Count the first row's columns by their shared top edge.
  const columns = await grid.locator('.catalog-grid-cell').evaluateAll((cells) => {
    const top = cells.find((c) => c.getAttribute('data-grid-index') === '0')!.getBoundingClientRect().top;
    return cells.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 1).length;
  });
  const start = Number(await focused.getAttribute('data-grid-index'));
  const rowEnd = start - (start % columns) + columns - 1;
  for (let i = start; i < rowEnd; i++) await page.keyboard.press('ArrowRight');
  await expect(focused).toHaveAttribute('data-grid-index', String(rowEnd));
  await page.keyboard.press('ArrowRight');
  await expect(focused).toHaveAttribute('data-grid-index', String(rowEnd + 1));
  await page.keyboard.press('ArrowLeft');
  await expect(focused).toHaveAttribute('data-grid-index', String(rowEnd));
});

test('the See all grid is centered: equal space left and right of its columns', async ({ page }) => {
  await seedCatalog(page, []);
  await page.goto('/');
  await enterTab(page, 'movies');
  const layer = browse(page, 'movies');
  await expect(layer.locator('[data-rail-key="cat:1"] .catalog-tile').first()).toBeVisible();
  await layer.locator('[data-collection-see-all], .catalog-see-all-card').first().click();
  const grid = page.locator('#view-movies .catalog-layer-grid');
  await expect(grid.locator('.catalog-grid-cell').first()).toBeVisible();
  const gaps = await grid.evaluate((layerEl) => {
    const track = layerEl.querySelector('.catalog-grid-track')!.getBoundingClientRect();
    // Cells, not posters: the focused poster is scaled up.
    const posters = Array.from(layerEl.querySelectorAll('.catalog-grid-cell'))
      .map((p) => p.getBoundingClientRect());
    const left = Math.min(...posters.map((r) => r.left)) - track.left;
    const right = track.right - Math.max(...posters.map((r) => r.right));
    return { left, right };
  });
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(2);
});

// Rails start on the 80px keyline; the focused item keeps the same room
// before the end edge, and the last one ends on that keyline.
test('a rail walked to its end keeps the 80px keyline after its last item', async ({ page }) => {
  await seedCatalog(page, [], categoryList(300));
  await page.goto('/');
  await enterTab(page, 'movies');
  const layer = '#view-movies .catalog-layer-browse';
  await expect(page.locator(`${layer} [data-rail-key="cat:1"] .catalog-tile`).first()).toBeVisible();
  // The first key after a pointer tab click only shows the ring.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`${layer} .catalog-rails .focused`)).toHaveCount(1);
  const chip = page.locator(`${layer} .catalog-pill-track .focused`);
  for (let i = 0; i < 3 && !(await chip.count()); i++) await page.keyboard.press('ArrowUp');
  await expect(chip).toHaveCount(1);

  // The category pills, out to All categories.
  const pills = await walkRailToEnd(page, `${layer} .catalog-pill-track`);
  expect(pills.steps).toBe(10);
  expect(pills.closest).toBeGreaterThanOrEqual(80 - 1);
  expect(Math.abs(pills.last - 80)).toBeLessThanOrEqual(2);
  if (!isChromium53()) expect(pills.atEnd).toBe(true);

  // A poster rail, from its first tile.
  await page.keyboard.press('ArrowDown');
  const track = `${layer} [data-rail-key="cat:1"] .catalog-rail-track`;
  await expect(page.locator(`${track} .focused`)).toHaveCount(1);
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator(`${track} > *`).first()).toHaveClass(/\bfocused\b/);
  const posters = await walkRailToEnd(page, track);
  expect(posters.steps).toBe(10);
  expect(posters.closest).toBeGreaterThanOrEqual(80 - 1);
  expect(Math.abs(posters.last - 80)).toBeLessThanOrEqual(2);
  // The simulation's engine counts the end padding beside the old engines'
  // spacer, so only there does a flex rail scroll on past its keyline.
  if (!isChromium53()) expect(posters.atEnd).toBe(true);
});

// Opens All categories from the pill row, from anywhere in browse.
async function openAllCategories(page: Page): Promise<void> {
  const layer = browse(page, 'movies');
  const all = layer.locator('.catalog-pill[data-action="all-categories"]');
  for (let i = 0; i < 4 && !(await layer.locator('.catalog-pill.focused').count()); i++) {
    await page.keyboard.press('ArrowUp');
  }
  for (let i = 0; i < 12 && !(await all.evaluate(el => el.classList.contains('focused'))); i++) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(all).toHaveClass(/\bfocused\b/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .catalog-layer-categories .catalog-cat').first()).toBeVisible();
}

test('the first rail keeps the category pills above it in view', async ({ page }) => {
  await seedCatalog(page, []);
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = browse(page, 'movies');
  const pills = layer.locator('[data-rail-key="categories"]');
  const pillsShown = async () => {
    const g = await settled(page, 'movies');
    const box = await pills.evaluate(el => el.getBoundingClientRect().toJSON() as DOMRect);
    return box.top >= g.railsTop - 0.5 && g.focusedRailBottom <= g.railsBottom + 0.5;
  };
  // The first key lands on the first title, and the pills stay above it.
  await expect(layer.locator('[data-rail-key="cat:1"] .focused')).toHaveCount(1);
  expect(await pillsShown()).toBe(true);
  await page.keyboard.press('ArrowUp');
  await expect(layer.locator('.catalog-pill.focused')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(layer.locator('[data-rail-key="cat:1"] .focused')).toHaveCount(1);
  expect(await pillsShown()).toBe(true);
  // Further rails snap to the top on their own, as before.
  await page.keyboard.press('ArrowDown');
  await expect(layer.locator('[data-rail-key="cat:2"] .focused')).toHaveCount(1);
  const g = await settled(page, 'movies');
  expect(g.focusedRailTop).toBeCloseTo(g.railsTop, 0);
  expect(g.visibleAbove).toBe(0);
});

test('a focused category pill keeps its fill and takes the detail buttons\' ring', async ({ page }) => {
  await seedCatalog(page, []);
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = browse(page, 'movies');
  await expect(layer.locator('[data-rail-key="cat:1"] .focused')).toHaveCount(1);
  const rest = await layer.locator('.catalog-pill').nth(1)
    .evaluate(el => getComputedStyle(el).backgroundColor);
  await page.keyboard.press('ArrowUp');
  const pill = layer.locator('.catalog-pill.focused');
  await expect(pill).toHaveCount(1);
  // Buttons ease box-shadow in, so poll until the ring has settled.
  await expect.poll(() => pill.evaluate(el => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 4px/);
  const focused = await pill.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, ring: cs.boxShadow };
  });
  expect(focused.background).toBe(rest);
  expect(focused.ring).toMatch(/0px 0px 30px/);
});

// Every way back into browse lays the rails out as the first visit did.
test('coming back to the first rail keeps the category pills in view', async ({ page }) => {
  await seedCatalog(page, []);
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = browse(page, 'movies');
  const firstRail = layer.locator('[data-rail-key="cat:1"] .focused');
  const pillsShown = async () => {
    const g = await settled(page, 'movies');
    const box = await layer.locator('[data-rail-key="categories"]')
      .evaluate(el => el.getBoundingClientRect().toJSON() as DOMRect);
    return box.top >= g.railsTop - 0.5 && g.focusedRailBottom <= g.railsBottom + 0.5;
  };
  await expect(firstRail).toHaveCount(1);
  expect(await pillsShown()).toBe(true);

  // Home and back with the remote.
  await pressBack(page);
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#view-home [data-key="section:movies"].focused')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(firstRail).toHaveCount(1);
  expect(await pillsShown()).toBe(true);

  // A title's detail and back.
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .catalog-layer-detail')).toBeVisible();
  await pressBack(page);
  await expect(firstRail).toHaveCount(1);
  expect(await pillsShown()).toBe(true);

  // A deeper rail still snaps alone to the top when coming back to it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(layer.locator('[data-rail-key="cat:3"] .focused')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .catalog-layer-detail')).toBeVisible();
  await pressBack(page);
  await expect(layer.locator('[data-rail-key="cat:3"] .focused')).toHaveCount(1);
  const g = await settled(page, 'movies');
  expect(g.focusedRailTop).toBeCloseTo(g.railsTop, 0);
  expect(g.visibleAbove).toBe(0);
});

test('All categories lists every category in a grid, and Back walks out through it', async ({ page }) => {
  await seedCatalog(page, [], categoryList(300));
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = browse(page, 'movies');
  // Ten categories, then All categories.
  await expect(layer.locator('.catalog-pill')).toHaveCount(11);
  await openAllCategories(page);
  const grid = page.locator('#view-movies .catalog-layer-categories');
  await expect(grid.locator('.catalog-grid-title')).toHaveText(/^All categories\s*300 categories$/);
  // A bounded window of chips, not all 300.
  expect(await grid.locator('.catalog-cat').count()).toBeLessThan(100);
  const focused = grid.locator('.catalog-cat.focused');
  await expect(focused).toHaveAttribute('data-category-id', '1');
  // The focused chip rings like a poster: no drop shadow.
  expect(await focused.evaluate(el => getComputedStyle(el).boxShadow))
    .toMatch(/0px 0px 0px 5px.*0px 0px 20px/);
  // Counts show only where the titles are loaded (the six rails).
  await expect(grid.locator('[data-category-id="6"] .catalog-cat-count')).toHaveText('25 movies');
  await expect(grid.locator('[data-category-id="7"] .catalog-cat-count')).toHaveCount(0);
  const at = () => focused.evaluate(el => el.getBoundingClientRect().toJSON() as DOMRect);
  const first = await at();
  // Down moves one row.
  await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveAttribute('data-category-id', '7');
  const second = await at();
  expect(second.left).toBeCloseTo(first.left, 0);
  expect(second.top).toBeGreaterThan(first.bottom);
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveAttribute('data-category-id', '127');
  expect(await grid.locator('.catalog-cat').count()).toBeLessThan(100);
  await expect(grid.locator('[data-category-id="1"]')).toHaveCount(0);
  // The focused chip is on screen.
  await expect.poll(async () => {
    const box = await at();
    return box.top >= 0 && box.bottom <= 1080;
  }).toBe(true);

  await page.keyboard.press('Enter');
  const posters = page.locator('#view-movies .catalog-layer-grid');
  await expect(posters.locator('.catalog-grid-title')).toHaveText('Category 127');
  await expect(posters.locator('.catalog-tile').first()).toBeVisible();
  await pressBack(page);
  await expect(focused).toHaveAttribute('data-category-id', '127');
  await expect(grid).toBeVisible();
  // Its titles are loaded now, so its count shows.
  await expect(grid.locator('[data-category-id="127"] .catalog-cat-count')).toHaveText('25 movies');
  await pressBack(page);
  await expect(layer.locator('.catalog-pill[data-action="all-categories"]')).toHaveClass(/\bfocused\b/);
  await expect(grid.locator('.catalog-cat')).toHaveCount(0);
});

test('the pointer opens a category from All categories', async ({ page }) => {
  await seedCatalog(page, [], categoryList(40));
  await page.goto('/');
  await enterTab(page, 'movies');
  const layer = browse(page, 'movies');
  await layer.locator('.catalog-pill[data-action="all-categories"]').click();
  const chip = page.locator('#view-movies .catalog-layer-categories .catalog-cat[data-category-id="9"]');
  await chip.hover();
  await expect(chip).toHaveClass(/\bfocused\b/);
  await chip.click();
  await expect(page.locator('#view-movies .catalog-layer-grid .catalog-grid-title')).toHaveText('Category 9');
});

test('in Arabic the category pills mirror and keep the 80px keyline', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
  await seedCatalog(page, [], categoryList(300));
  await page.goto('/');
  await enterRails(page, 'movies');
  const layer = '#view-movies .catalog-layer-browse';
  await page.keyboard.press('ArrowUp');
  const first = page.locator(`${layer} .catalog-pill[data-category-id="1"]`);
  await expect(first).toHaveClass(/\bfocused\b/);
  // The row starts on the right keyline.
  const box = (await first.boundingBox())!;
  expect(Math.abs(1920 - (box.x + box.width) - 80)).toBeLessThanOrEqual(2);
  const pills = await walkRailToEnd(page, `${layer} .catalog-pill-track`, true);
  expect(pills.steps).toBe(10);
  expect(pills.closest).toBeGreaterThanOrEqual(80 - 1);
  expect(Math.abs(pills.last - 80)).toBeLessThanOrEqual(2);
  if (!isChromium53()) expect(pills.atEnd).toBe(true);

  // All categories mirrors too: the first chip on the right.
  await page.keyboard.press('Enter');
  const grid = page.locator('#view-movies .catalog-layer-categories');
  const one = (await grid.locator('[data-category-id="1"]').boundingBox())!;
  const two = (await grid.locator('[data-category-id="2"]').boundingBox())!;
  expect(two.x + two.width).toBeLessThan(one.x);
  await page.keyboard.press('ArrowLeft');
  await expect(grid.locator('.catalog-cat.focused')).toHaveAttribute('data-category-id', '2');
});
