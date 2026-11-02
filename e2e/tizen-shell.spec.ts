import { test, expect, enterTab, pressKeys, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';

// The Samsung Tizen build (`--platform=tizen`) against a stubbed Tizen Web
// Device API. Runs only in the `tizen-sim` project.

const RETURN = 10009;
const LEFT = 37;
const OK = 13;

interface TizenRecord {
  registered: string[];
  exits: number;
}

// The parts of window.tizen the app calls, recording what it asks for.
async function stubTizen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: TizenRecord = { registered: [], exits: 0 };
    (window as unknown as { __tizen: TizenRecord }).__tizen = record;
    const supported = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
      'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward',
      'ChannelUp', 'ChannelDown', 'Info', 'Guide', 'Exit'];
    (window as unknown as { tizen: unknown }).tizen = {
      tvinputdevice: {
        getSupportedKeys: () => supported.map((name, i) => ({ name, code: 1000 + i })),
        registerKey: (name: string) => { record.registered.push(name); },
      },
      application: {
        getCurrentApplication: () => ({ exit: () => { record.exits++; } }),
      },
    };
  });
}

const tizenRecord = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tizen: TizenRecord }).__tizen);

const prompt = (page: Page) => page.locator('.confirmation-prompt:not(.hidden)');

test('boots in key mode and registers the remote keys, never Exit', async ({ page }) => {
  await stubTizen(page);
  await seedXtream(page);
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/keyboard-nav/);
  await expect(page.locator('#view-home .focused')).toHaveCount(1);
  const { registered } = await tizenRecord(page);
  expect(registered).toEqual(expect.arrayContaining(['ColorF0Red', 'ChannelUp', 'ChannelDown', '0', '9']));
  expect(registered).not.toContain('Exit');
});

test('Return walks back to Home, where it asks before exiting', async ({ page }) => {
  await stubTizen(page);
  await seedXtream(page);
  await page.goto('/');
  await enterTab(page, 'live');
  await expect(page.locator('#view-channels')).toBeVisible();
  await pressKeys(page, RETURN);
  await expect(page.locator('#view-home')).toBeVisible();

  // Return on Home: the confirmation, on Cancel; Return again cancels.
  await pressKeys(page, RETURN);
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page).locator('.confirmation-title')).toHaveText('Exit Pleione?');
  await expect(prompt(page).locator('.focused')).toHaveAttribute('data-key', 'cancel');
  await pressKeys(page, RETURN);
  await expect(prompt(page)).toHaveCount(0);
  await expect(page.locator('#view-home')).toBeVisible();
  expect((await tizenRecord(page)).exits).toBe(0);

  // Exit leaves through the Tizen application.
  await pressKeys(page, RETURN);
  await expect(prompt(page)).toBeVisible();
  await pressKeys(page, LEFT, OK);
  await expect.poll(async () => (await tizenRecord(page)).exits).toBe(1);
});

test('the first run and Settings leave phone setup out', async ({ page }) => {
  await stubTizen(page);
  await page.goto('/');
  await expect(page.locator('#view-home [data-add]')).toHaveCount(2);
  await expect(page.locator('#view-home .home-setup')).toHaveCount(0);

  await seedXtream(page);
  await page.goto('/');
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings')).toBeVisible();
  await expect(page.locator('#setup-info')).toHaveCount(0);
  await page.locator('[data-settings-target="sources"]').click();
  await expect(page.locator('#upload-entries')).toHaveCount(0);
});
