import { test, expect, enterTab, pressKeys, type Page } from './helpers';

// The account picker on Home narrows Live, the Guide and Search to one source,
// and lists M3U playlists by name beside Xtream accounts.

const list = (name: string) =>
  `#EXTM3U\n#EXTINF:-1 group-title="Group 1",${name}\nhttp://host/${name}.m3u8\n`;

async function seedLists(page: Page): Promise<void> {
  for (const name of ['one', 'two']) {
    await page.route(`**/${name}.m3u`, route => route.fulfill({
      contentType: 'application/x-mpegurl',
      body: list(name === 'one' ? 'Alpha' : 'Bravo'),
    }));
  }
  await page.addInitScript(() => {
    localStorage.setItem('iptv_privacy_consent', 'true');
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'p1', name: 'First list', url: 'http://host/one.m3u', source: 'url' },
      { id: 'p2', name: 'Second list', url: 'http://host/two.m3u', source: 'url' },
    ]));
  });
}

const channels = (page: Page) => page.locator('.channel-main .channel-item');

async function pickOnHome(page: Page, name: string): Promise<void> {
  await page.locator('.account-avatar').click();
  await page.locator('.account-menu').getByText(name).click();
}

test('Live shows only the picked list, and switching needs no reload', async ({ page }) => {
  await seedLists(page);
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  await enterTab(page, 'live');
  await expect(channels(page).filter({ hasText: 'Alpha' })).toBeVisible();
  await expect(channels(page).filter({ hasText: 'Bravo' })).toHaveCount(0);
  await expect(page.locator('.playlist-tabs')).toHaveCount(0);

  await pressKeys(page, 461);
  await expect(page.locator('#view-home')).toBeVisible();
  let fetched = 0;
  page.on('request', (request) => { if (request.url().endsWith('.m3u')) fetched++; });
  await pickOnHome(page, 'Second list');
  await enterTab(page, 'live');
  await expect(channels(page).filter({ hasText: 'Bravo' })).toBeVisible();
  await expect(channels(page).filter({ hasText: 'Alpha' })).toHaveCount(0);
  expect(fetched).toBe(0);
});

test('the pick survives a restart', async ({ page }) => {
  await seedLists(page);
  await page.goto('/');
  await pickOnHome(page, 'Second list');
  await page.reload();
  await enterTab(page, 'live');
  await expect(channels(page).filter({ hasText: 'Bravo' })).toBeVisible();
  await expect(channels(page).filter({ hasText: 'Alpha' })).toHaveCount(0);
});

test('a single list has nothing to pick', async ({ page }) => {
  await seedLists(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'p1', name: 'First list', url: 'http://host/one.m3u', source: 'url' },
    ]));
  });
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('.account-avatar')).toHaveCount(0);
});

test('adding a source keeps the current pick', async ({ page }) => {
  await seedLists(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'p1', name: 'First list', url: 'http://host/one.m3u', source: 'url' },
    ]));
  });
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'x1', name: 'Account', url: 'http://host:8080', source: 'xtream', xtream: { username: 'u', password: 'p' } },
      { id: 'p1', name: 'First list', url: 'http://host/one.m3u', source: 'url' },
    ]));
  });
  await page.reload();
  await expect(page.locator('#view-home')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('iptv_selectedXtream'))).toBe('"p1"');
});

test('a picked source that fails offers Try again, even with another source loaded', async ({ page }) => {
  test.slow();
  await seedLists(page);
  let broken = true;
  await page.route('**/two.m3u', route => (broken
    ? route.fulfill({ status: 500, body: '' })
    : route.fulfill({ contentType: 'application/x-mpegurl', body: list('Bravo') })));
  await page.goto('/');
  await pickOnHome(page, 'Second list');
  await enterTab(page, 'live');
  // The app retries a failing source for a few seconds first.
  await expect(page.locator('.live-load-error')).toBeVisible({ timeout: 20000 });

  broken = false;
  const retried = page.waitForRequest('**/two.m3u', { timeout: 2000 });
  await page.locator('.live-load-retry').click();
  await retried;
  await expect(channels(page).filter({ hasText: 'Bravo' })).toBeVisible({ timeout: 20000 });
});

test('a reminder for another source moves the pick, and Home follows', async ({ page }) => {
  await seedLists(page);
  await page.goto('/');
  await enterTab(page, 'live');
  await expect(channels(page).filter({ hasText: 'Alpha' })).toBeVisible();
  const key = await page.evaluate(() => {
    const url = 'http://host/Bravo.m3u8';
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  });
  await page.evaluate(reminderChannelKey => document.dispatchEvent(
    new CustomEvent('webOSRelaunch', { detail: { reminderChannelKey } })), key);
  await expect(page.locator('#view-player')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('iptv_selectedXtream'))).toBe('"p2"');
});

