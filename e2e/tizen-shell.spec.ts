import { test, expect, enterTab, pressKeys, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';

// The Samsung Tizen build (`--platform=tizen`) against a stubbed Tizen Web
// Device API. Runs only in the `tizen-sim` project.

const RETURN = 10009;
const LEFT = 37;
const RIGHT = 39;
const OK = 13;
const GUIDE = 458;

interface TizenRecord {
  registered: string[];
  exits: number;
  launches: string[];
}

// The parts of window.tizen the app calls, recording what it asks for.
// `store` is the store package, which carries no LAN web service; `agreed`
// is an earlier yes to the privacy notice.
async function stubTizen(page: Page, { store = false, agreed = true } = {}): Promise<void> {
  if (agreed) await page.addInitScript(() => localStorage.setItem('iptv_privacy_consent', 'true'));
  await page.addInitScript((storePackage: boolean) => {
    const record: TizenRecord = { registered: [], exits: 0, launches: [] };
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
        getCurrentApplication: () => ({ exit: () => { record.exits++; }, appInfo: { packageId: 'pkgAAAAAAA' } }),
        // The LAN service does not run here: the launch is recorded and fails.
        launchAppControl: (_control: unknown, appId: string, _ok: () => void, fail: (e: Error) => void) => {
          record.launches.push(appId);
          fail(new Error('no service in the simulation'));
        },
      },
      ApplicationControl: function ApplicationControl() {},
    };
    const application = (window as unknown as { tizen: { application: Record<string, unknown> } }).tizen.application;
    application.getAppInfo = (id: string) => {
      if (storePackage) throw Object.assign(new Error(`${id} not installed`), { name: 'NotFoundError' });
      return { id };
    };
  }, store);
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
  // Home's brand logo ships in the Samsung package too.
  await expect.poll(() => page.locator('.home-logo').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
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

test('phone setup launches the package\'s LAN service, and says when it cannot', async ({ page }) => {
  await stubTizen(page);
  await page.goto('/');
  await expect(page.locator('#view-home [data-add]')).toHaveCount(2);
  await expect(page.locator('#view-home .home-setup')).toContainText('currently unavailable');
  expect((await tizenRecord(page)).launches).toContain('pkgAAAAAAA.PleioneLan');

  await seedXtream(page);
  await page.goto('/');
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings')).toBeVisible();
  await expect(page.locator('#setup-info')).toContainText('currently unavailable');
});

test('the Guide key opens the Guide from Home', async ({ page }) => {
  await stubTizen(page);
  await seedXtream(page);
  await page.goto('/');
  await expect(page.locator('#view-home .focused')).toHaveCount(1);
  await pressKeys(page, GUIDE);
  await expect(page.locator('#view-channels.live-guide-mode #live-guide .guide-cell').first()).toBeVisible();
  await expect(page.locator('#live-guide .focused')).toHaveCount(1);
});

test('the store package, without the LAN service, offers no phone setup and starts no service', async ({ page }) => {
  await stubTizen(page, { store: true });
  await page.goto('/');
  await expect(page.locator('#view-home [data-add]')).toHaveCount(2);
  await expect(page.locator('#view-home .home-setup')).toHaveCount(0);
  await expect(page.locator('#view-home .focused')).toHaveCount(1);

  await seedXtream(page);
  await page.goto('/');
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings')).toBeVisible();
  await expect(page.locator('#setup-info')).toHaveCount(0);
  expect((await tizenRecord(page)).launches).toEqual([]);
});

test('a first launch asks for privacy consent before any source is added', async ({ page }) => {
  await stubTizen(page, { store: true, agreed: false });
  await page.goto('/');
  const notice = prompt(page);
  await expect(notice.locator('.confirmation-title')).toHaveText('Your privacy');
  await expect(notice.locator('.focused')).toHaveAttribute('data-key', 'confirm');

  // Not now: the welcome screen stays, and adding a source asks again.
  await pressKeys(page, RIGHT, OK);
  await expect(notice).toHaveCount(0);
  await expect(page.locator('#view-home .focused')).toHaveAttribute('data-add', 'xtream');
  await pressKeys(page, OK);
  await expect(notice).toBeVisible();
  await expect(page.locator('#view-settings')).toBeHidden();

  // Agree: the account form opens, and the answer is kept.
  await pressKeys(page, OK);
  await expect(page.locator('#view-settings')).toBeVisible();
  await expect(page.locator('#settings-privacy')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#view-home [data-add]')).toHaveCount(2);
  await expect(prompt(page)).toHaveCount(0);
});
