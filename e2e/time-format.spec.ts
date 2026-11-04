import {
  test, expect, enterTab, openGuide, openLive, routeLiveManifest, routePlaylist, seedPlaylist, type Page,
} from './helpers';

test.use({ pinTime24h: false, timezoneId: 'UTC' });

// channelKey mirrors src/utils/channel.ts (fnv1a of the URL sans query/fragment).
function channelKey(url: string): string {
  const stable = url.split('#')[0].split('?')[0];
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) { h ^= stable.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}


const clock = (page: Page) => page.locator('#view-home .home-clock');

test('times show 12-hour by default, and the setting switches them to 24-hour', async ({ page }) => {
  await seedPlaylist(page);
  await routePlaylist(page);
  await page.goto('/');
  await expect(clock(page)).toHaveText(/^\d{1,2}:\d{2} (AM|PM)$/);

  await enterTab(page, 'settings');
  await expect(page.locator('#time-format .toggle-option.active')).toHaveAttribute('data-value', '12h');
  await page.locator('#time-format [data-value="24h"]').click();
  await page.locator('#save-settings').click();
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(clock(page)).toHaveText(/^\d{2}:\d{2}$/);
});

test('the Guide\'s ruler keeps 12-hour times apart', async ({ page }) => {
  await seedPlaylist(page);
  await routePlaylist(page);
  await page.goto('/');
  await openLive(page);
  await openGuide(page);
  const labels = page.locator('.guide-time');
  await expect(labels.first()).toContainText(/AM|PM/);
  const boxes = await labels.evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right };
  }));
  expect(boxes.length).toBeGreaterThan(1);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right);
});

const CHANNELS = '#EXTM3U\n#EXTINF:-1 tvg-id="ch1" group-title="Group 1",ch1\nhttp://host/ch1.m3u8\n';
const EPG = `<tv>
  <channel id="ch1"><display-name>ch1</display-name></channel>
  <programme channel="ch1" start="20260915113000 +0000" stop="20260915123000 +0000"><title>Program 1</title></programme>
  <programme channel="ch1" start="20260915123000 +0000" stop="20260915130000 +0000"><title>Program 2 with a long name that runs on</title></programme>
  <programme channel="ch1" start="20260915130000 +0000" stop="20260915133000 +0000"><title>Program 3</title></programme>
</tv>`;

async function openLiveAt(page: Page, locale: string, textSize: number): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-09-15T12:00:00Z'));
  await routePlaylist(page, CHANNELS);
  await routeLiveManifest(page);
  await page.route('http://host/guide.xml', route => route.fulfill({ contentType: 'application/xml', body: EPG }));
  await page.addInitScript(([lang, size]) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ id: 'p1', name: 'P1', url: 'http://host/playlist.m3u' }]));
    localStorage.setItem('iptv_manual_epg_sources', JSON.stringify([{ url: 'http://host/guide.xml', playlistIds: [] }]));
    localStorage.setItem('iptv_locale', JSON.stringify(lang));
    localStorage.setItem('iptv_text_size', JSON.stringify(size));
    const proto = HTMLMediaElement.prototype;
    proto.load = function () { /* no-op */ };
    proto.play = function () { return Promise.resolve(); };
    document.addEventListener('error', event => {
      if (event.isTrusted && event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
    }, true);
  }, [locale, textSize] as const);
  await page.goto('/');
  await openLive(page);
  await expect(page.locator('#channel-browser .channel-item')).toHaveCount(1);
}

for (const locale of ['en', 'es']) {
  for (const textSize of [100, 150]) {
    test(`12-hour times fit the preview and the Guide, ${locale} at ${String(textSize)}%`, async ({ page }) => {
      await openLiveAt(page, locale, textSize);

      const rows = page.locator('#live-preview .live-preview-program');
      await expect(rows.first()).toBeVisible();
      const overlaps = await rows.evaluateAll(list => list.map((row) => {
        const time = row.querySelector('time')!;
        const title = row.querySelector('span')!;
        const range = document.createRange();
        range.selectNodeContents(time);
        return range.getBoundingClientRect().right - title.getBoundingClientRect().left;
      }));
      for (const overlap of overlaps) expect(overlap).toBeLessThanOrEqual(0);

      const schedule = await page.locator('#live-preview .live-preview-schedule').evaluate((row) => {
        const [time, remaining] = [...row.children].map(el => el.getBoundingClientRect());
        return { gap: remaining.left - time.right, end: remaining.right - row.getBoundingClientRect().right };
      });
      expect(schedule.gap).toBeGreaterThan(0);
      expect(schedule.end).toBeLessThanOrEqual(0);

      await openGuide(page);
      const time = page.locator('#live-guide .guide-cell-time').filter({ hasText: /1:00/ }).first();
      await expect(time).toBeVisible();
      if (textSize === 100) {
        const fits = await time.evaluate(el => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
      }
    });

    test(`a 12-hour reminder time fits its column, ${locale} at ${String(textSize)}%`, async ({ page }) => {
      await routePlaylist(page);
      await seedPlaylist(page);
      await page.clock.setFixedTime(new Date('2026-09-15T11:00:00Z'));
      await page.addInitScript(([lang, size, start, key]) => {
        localStorage.setItem('iptv_locale', JSON.stringify(lang));
        localStorage.setItem('iptv_text_size', JSON.stringify(size));
        localStorage.setItem('iptv_reminders', JSON.stringify([{
          channelKey: key, channelName: 'Channel', title: 'Program', startMs: start, stopMs: start + 3600000,
        }]));
      }, [locale, textSize, Date.UTC(2026, 8, 15, 12, 30), channelKey('http://streams.example.com/one.m3u8')] as const);
      await page.goto('/');
      await enterTab(page, 'settings');
      await page.locator('[data-settings-target="guide"]').click();
      await page.locator('#manage-reminders').click();
      const fit = await page.locator('.reminder-manager-time').evaluate(el => ({
        clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, text: el.textContent?.trim(),
      }));
      expect(fit.text).toContain('12:30');
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    });
  }
}

test('Arabic writes a 12-hour range with its marker once', async ({ page }) => {
  await openLiveAt(page, 'ar', 100);
  const text = (selector: string) => page.locator(selector).first().evaluate(
    el => el.textContent?.replace(/[\u200e\u200f\u2066-\u2069]/g, '').trim());
  await expect.poll(() => text('#live-preview .live-preview-time-range')).toBe('11:30 ص–12:30 م');
  await expect.poll(() => text('#live-preview .live-preview-program time')).toBe('12:30–1:00 م');
});
