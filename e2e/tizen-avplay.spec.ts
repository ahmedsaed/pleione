import {
  test, expect, enterTab, openLive, pressKeys, routePlaylist, seedPlaylist, type Page,
} from './helpers';
import { seedXtream } from './fixtures/xtream';

// The Samsung Tizen build on a Tizen 9 TV, where HLS, raw TS and single files
// play through AVPlay (src/platform/tizen-avplay.ts). AVPlay is stubbed to act
// as measured on the TV (docs/tizen.md). Runs only in the `tizen-sim` project.

const RETURN = 10009;
const UP = 38;
const RIGHT = 39;
const DOWN = 40;
const OK = 13;

test.use({ userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36 Chrome/120.0 TV Safari/537.36' });

interface AvplayRecord {
  opened: string[];
  closed: number;
  rects: number[][];
  selected: string[];
}

async function stubSamsung(page: Page, { live = false } = {}): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('iptv_privacy_consent', 'true'));
  await page.addInitScript((isLive: boolean) => {
    const record: AvplayRecord = { opened: [], closed: 0, rects: [], selected: [] };
    (window as unknown as { __avplay: AvplayRecord }).__avplay = record;
    let state = 'NONE';
    let time = 0;
    let listener: Record<string, (...args: unknown[]) => void> = {};
    let ticker: ReturnType<typeof setInterval> | null = null;
    (window as unknown as { tizen: unknown }).tizen = {
      tvinputdevice: { getSupportedKeys: () => [], registerKey: () => {} },
      application: {
        getCurrentApplication: () => ({ exit: () => {}, appInfo: { id: 'pkgAAAAAAA.App', packageId: 'pkgAAAAAAA' } }),
        getAppInfo: () => { throw new Error('no service'); },
      },
    };
    (window as unknown as { webapis: unknown }).webapis = {
      avplay: {
        open: (url: string) => { record.opened.push(url); state = 'IDLE'; time = 0; },
        close: () => { record.closed++; state = 'NONE'; },
        stop: () => {
          if (ticker) clearInterval(ticker);
          ticker = null;
          state = 'IDLE';
        },
        prepareAsync: (ok: () => void) => { state = 'READY'; setTimeout(ok, 0); },
        play: () => {
          state = 'PLAYING';
          ticker ??= setInterval(() => {
            time += 200;
            listener.oncurrentplaytime?.(time);
          }, 200);
        },
        pause: () => { state = 'PAUSED'; },
        seekTo: (ms: number, ok: () => void) => { time = ms; setTimeout(ok, 0); },
        getCurrentTime: () => time,
        getDuration: () => (isLive ? 0 : 120000),
        getState: () => state,
        getStreamingProperty: (name: string) => (isLive && name === 'GET_LIVE_DURATION' ? '0|300000' : ''),
        getTotalTrackInfo: () => [
          { index: 0, type: 'VIDEO', extra_info: '{"Width":"640","Height":"360"}' },
          { index: 1, type: 'AUDIO', extra_info: '{"language":"l1"}' },
          { index: 2, type: 'AUDIO', extra_info: '{"language":"l2"}' },
        ],
        setSelectTrack: (type: string, index: number) => {
          if (state !== 'PLAYING') throw Object.assign(new Error('state'), { name: 'InvalidStateError' });
          record.selected.push(`${type}:${String(index)}`);
        },
        setSilentSubtitle: () => {},
        setDisplayRect: (x: number, y: number, w: number, h: number) => { record.rects.push([x, y, w, h]); },
        setDisplayMethod: () => {},
        setListener: (l: typeof listener) => { listener = l; },
      },
    };
  }, live);
}

const avplay = (page: Page) =>
  page.evaluate(() => (window as unknown as { __avplay: AvplayRecord }).__avplay);

// A live channel with two audio renditions and WebVTT subtitles, whose first
// segment starts at `start`, which AVPlay's window puts at media time 0.
async function routeLiveChannel(page: Page): Promise<void> {
  const start = new Date(Date.now()).toISOString();
  const media = (uri: string) => [
    '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:300', '#EXT-X-MEDIA-SEQUENCE:0',
    `#EXT-X-PROGRAM-DATE-TIME:${start}`, '#EXTINF:300.000,', uri, '',
  ].join('\n');
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Track 1",LANGUAGE="l1",DEFAULT=YES,URI="audio-1.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Track 2",LANGUAGE="l2",URI="audio-2.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Track 3",LANGUAGE="l1",URI="subs.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=400000,AUDIO="aud",SUBTITLES="subs"',
    'video.m3u8', '',
  ].join('\n');
  const hls = 'application/vnd.apple.mpegurl';
  await routePlaylist(page, '#EXTM3U\n#EXTINF:-1 group-title="Group 1",Alpha\nhttp://host/live/a.m3u8\n');
  await page.route('**/live/a.m3u8', r => r.fulfill({ contentType: hls, body: master }));
  await page.route('**/live/video.m3u8', r => r.fulfill({ contentType: hls, body: media('video.ts') }));
  await page.route('**/live/subs.m3u8', r => r.fulfill({ contentType: hls, body: media('cues.vtt') }));
  await page.route('**/live/cues.vtt', r => r.fulfill({
    contentType: 'text/vtt',
    body: 'WEBVTT\n\n00:00:00.000 --> 00:05:00.000\nA subtitle line\n',
  }));
}

async function watchFirstChannel(page: Page): Promise<void> {
  await stubSamsung(page, { live: true });
  await seedPlaylist(page);
  await routeLiveChannel(page);
  await page.goto('/');
  await openLive(page);
  await pressKeys(page, RIGHT, OK);
  await expect(page.locator('#view-player')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/avplay-playing/);
}

// The player's controls, from hidden, to a dock button, whose menu opens.
async function openDock(page: Page, key: string): Promise<void> {
  await pressKeys(page, OK);
  const focused = () => page.locator('#view-player .focused').getAttribute('data-key');
  await expect.poll(focused).toMatch(/^dock:/);
  for (let i = 0; i < 6 && await focused() !== key; i++) await pressKeys(page, RIGHT);
  expect(await focused()).toBe(key);
  await pressKeys(page, OK);
}

test('a live HLS channel plays through AVPlay, with the manifest\'s audio tracks to switch', async ({ page }) => {
  await watchFirstChannel(page);
  expect((await avplay(page)).opened).toEqual(['http://host/live/a.m3u8']);
  // The element stays idle: AVPlay draws under the page.
  await expect(page.locator('#video-player source')).toHaveCount(0);

  await openDock(page, 'dock:audio');
  await expect(page.locator('[data-key="audio:0"]')).toContainText('Track 1');
  await expect(page.locator('[data-key="audio:1"]')).toContainText('Track 2');
  await pressKeys(page, DOWN, OK);
  await expect.poll(async () => (await avplay(page)).selected).toEqual(['AUDIO:2']);
});

test('live subtitles draw over AVPlay\'s picture, and stop when turned off', async ({ page }) => {
  await watchFirstChannel(page);
  await openDock(page, 'dock:subtitles');
  await pressKeys(page, DOWN, OK);
  const cue = page.locator('.cue-overlay .cue');
  await expect(cue).toHaveText('A subtitle line');
  const box = await page.locator('.cue-overlay').boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });

  // OK reopens the menu on the active track; Off is the row above.
  await pressKeys(page, OK);
  await expect(page.locator('[data-key="sub:0"]')).toHaveClass(/\bfocused\b/);
  await pressKeys(page, UP, OK);
  await expect(cue).toHaveCount(0);
});

test('the Live preview keeps AVPlay in its box, and leaving Live gives the page back', async ({ page }) => {
  await watchFirstChannel(page);
  await pressKeys(page, RETURN);
  await expect(page.locator('#view-channels')).toBeVisible();

  const slot = await page.locator('.live-preview-slot').boundingBox();
  await expect.poll(async () => (await avplay(page)).rects.at(-1)).toEqual([
    Math.round(slot!.x), Math.round(slot!.y), Math.round(slot!.width), Math.round(slot!.height),
  ]);
  // The view's backdrop opens over the picture.
  const clip = await page.locator('#view-channels').evaluate(el => getComputedStyle(el).clipPath);
  expect(clip).toContain('evenodd');

  await pressKeys(page, RETURN);
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/avplay/);
  expect((await avplay(page)).closed).toBeGreaterThan(0);
});

test('a movie plays through AVPlay with its audio tracks and sidecar subtitles', async ({ page }) => {
  await stubSamsung(page);
  await seedXtream(page);
  await page.route('**/sub1.srt', r => r.fulfill({
    contentType: 'text/plain',
    body: '1\n00:00:00,000 --> 00:10:00,000\nA sidecar line\n',
  }));
  await page.goto('/');
  await enterTab(page, 'movies');
  await page.locator('.catalog-tile[data-item-id="10"]')
    .evaluate(el => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await pressKeys(page, OK);
  await expect(page.locator('#view-movies .detail-plot')).toBeVisible();
  await page.locator('[data-action="play"]')
    .evaluate(el => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await pressKeys(page, OK);
  await expect(page.locator('#view-player')).toBeVisible();
  await expect.poll(async () => (await avplay(page)).opened.length).toBe(1);
  await expect(page.locator('html')).toHaveClass(/avplay-playing/);

  await pressKeys(page, OK);
  await expect(page.locator('[data-key="dock:audio"]')).toBeVisible();
  // Seek bar, then the button row.
  await pressKeys(page, DOWN);
  await expect(page.locator('[data-key="dock:seek"]')).not.toHaveClass(/\bfocused\b/);
  const focused = () => page.locator('#view-player .focused').getAttribute('data-key');
  for (let i = 0; i < 6 && await focused() !== 'dock:subtitles'; i++) await pressKeys(page, RIGHT);
  await pressKeys(page, OK);
  await pressKeys(page, DOWN, OK);
  await expect(page.locator('.cue-overlay .cue')).toHaveText('A sidecar line');
});
