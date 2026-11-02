import { test, expect, enterTab, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';

// The backdrops and Home's glows draw from images painted once from their
// gradients (src/utils/backdrop-art.ts), not from the gradients themselves.

// A blob: URL where the engine can make one, else a PNG data: URL.
const PAINTED = /^url\("(blob:|data:image\/png)/;

const background = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundImage);

test('every backdrop and Home glow draws from a painted image', async ({ page }) => {
  await seedXtream(page);
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/backdrop-art/);

  expect(await background(page, '#view-home')).toMatch(PAINTED);
  expect(await background(page, '#view-home .home-glow-live')).toMatch(PAINTED);
  // The probes keep the gradients the images come from.
  expect(await background(page, '.backdrop-art-probe[data-backdrop="home"]')).toMatch(/gradient/);
  for (const view of ['#view-channels', '#view-settings', '#view-movies', '#view-search']) {
    expect(await background(page, view), view).toMatch(PAINTED);
  }
});

test('the images follow the theme', async ({ page }) => {
  await seedXtream(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/backdrop-art/);
  const dark = await background(page, '#view-home');
  // Picking a theme in Settings previews it; the images repaint for it.
  await enterTab(page, 'settings');
  await page.locator('[data-settings-target="appearance"]').click();
  await page.locator('.theme-swatch[data-theme-id="daylight"]').click();
  await expect.poll(() => background(page, '#view-settings')).not.toBe(dark);
  await expect.poll(() => background(page, '#view-settings')).toMatch(PAINTED);
});
