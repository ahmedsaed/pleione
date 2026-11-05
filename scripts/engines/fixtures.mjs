// Fixture servers for the engine smoke suite: the built app on one origin
// and the demo Xtream portal (synthetic catalog, no media) on another, as a
// real provider would be. Old engines lack request interception over CDP,
// so everything the app loads comes from here.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { createCatalog } from '../xtream-demo/catalog.mjs';
import { createDemoServer } from '../xtream-demo/server.mjs';

export const XTREAM_USER = 'demo';
export const XTREAM_PASS = 'demo';
export const HARNESS_PATH = '/__engines/harness.js';
export const BLANK_PATH = '/__engines/blank.html';
export const PLAYLIST_PATH = '/__engines/playlist.m3u';
export const LIVE_PATH = '/__engines/live/';

const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
};

// No streams: the suite checks layout, so playback may fail.
const NO_MEDIA = {
  ensureShared: () => Promise.resolve(),
  ensureChannel: () => Promise.reject(new Error('no media in the engine suite')),
  sharedMeta: () => Promise.reject(new Error('no media in the engine suite')),
  channelSegment: () => Promise.reject(new Error('no media in the engine suite')),
  audioSegment: () => Promise.reject(new Error('no media in the engine suite')),
  vodFile: () => Promise.reject(new Error('no media in the engine suite')),
};

// Installed before the app's own scripts. ES5 only: it runs on Chromium 53.
export function harnessScript({ tizen }) {
  const collector = `
(function () {
  var errors = window.__engineErrors = [];
  window.addEventListener('error', function (e) {
    if (!(e instanceof ErrorEvent)) return;
    errors.push({ message: String(e.message), source: (e.filename || '') + ':' + e.lineno });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    errors.push({ message: 'Unhandled rejection: ' + (r && r.message ? r.message : String(r)), source: '' });
  });
})();`;
  // What the Tizen bundle calls on window.tizen, as e2e/tizen-shell.spec.ts
  // stubs it. The LAN service is "installed" but never launches.
  const tizenStub = `
(function () {
  var names = ['0','1','2','3','4','5','6','7','8','9','ColorF0Red','ColorF1Green','ColorF2Yellow',
    'ColorF3Blue','MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaRewind',
    'MediaFastForward','ChannelUp','ChannelDown','Info','Guide','Exit'];
  window.tizen = {
    tvinputdevice: {
      getSupportedKeys: function () { return names.map(function (name, i) { return { name: name, code: 1000 + i }; }); },
      registerKey: function () {}
    },
    application: {
      getCurrentApplication: function () { return { exit: function () {}, appInfo: { packageId: 'pkgAAAAAAA' } }; },
      getAppInfo: function (id) { return { id: id }; },
      launchAppControl: function (control, appId, ok, fail) { fail(new Error('no service in the engine suite')); }
    },
    ApplicationControl: function ApplicationControl() {}
  };
})();`;
  return collector + (tizen ? tizenStub : '');
}

export function injectHarness(html) {
  return html.replace(/<head>/i, `<head>\n  <script src="${HARNESS_PATH}"></script>`);
}

/** A synthetic M3U of the catalog's live channels, guided by the portal's XMLTV. */
export function smokePlaylist(catalog, xtreamOrigin, appOrigin) {
  const auth = `username=${XTREAM_USER}&password=${XTREAM_PASS}`;
  const groups = new Map(catalog.liveCategories.map(c => [c.id, c.name]));
  const lines = [`#EXTM3U url-tvg="${xtreamOrigin}/xmltv.php?${auth}"`];
  for (const ch of catalog.channels) {
    lines.push(
      `#EXTINF:-1 tvg-id="${ch.epgId}" tvg-logo="${xtreamOrigin}/demo-assets/logo/${ch.streamId}.svg"`
        + ` group-title="${groups.get(ch.categoryId)}",${ch.name}`,
      `${appOrigin}${LIVE_PATH}${ch.streamId}.m3u8`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// A segment-less live manifest (as e2e/helpers.ts LIVE_MANIFEST): hls.js
// parses it and waits for segments, so the player shows its OSD, not an error.
const LIVE_MANIFEST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n';

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

/**
 * Serve `appDir` (a preview build) and the Xtream portal. Resolves with both
 * origins and a close().
 */
export async function startFixtures({ appDir, tizen = false, host = '127.0.0.1', log = () => {} }) {
  const catalog = createCatalog('smoke');
  const demo = createDemoServer({
    catalog, media: NO_MEDIA, username: XTREAM_USER, password: XTREAM_PASS,
    log: (level, message) => { if (level === 'error' && !message.includes('no media')) log(message); },
  });
  const xtreamPort = await demo.listen(0, host);
  const xtreamOrigin = `http://${host}:${xtreamPort}`;
  const harness = harnessScript({ tizen });
  const root = normalize(appDir);
  let appOrigin = '';

  const app = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (pathname === HARNESS_PATH) return send(200, MIME['.js'], harness);
    if (pathname === BLANK_PATH) return send(200, MIME['.html'], '<!DOCTYPE html><title>seed</title>');
    if (pathname === PLAYLIST_PATH) return send(200, 'audio/x-mpegurl', smokePlaylist(catalog, xtreamOrigin, appOrigin));
    if (pathname.startsWith(LIVE_PATH)) return send(200, 'application/vnd.apple.mpegurl', LIVE_MANIFEST);
    const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (file !== root && !file.startsWith(root + sep)) return send(403, 'text/plain', 'Forbidden');
    try {
      const data = await readFile(file);
      if (file.endsWith('index.html')) return send(200, MIME['.html'], injectHarness(String(data)));
      return send(200, MIME[extname(file)] || 'application/octet-stream', data);
    } catch {
      return send(404, 'text/plain', 'Not found');
    }
  });
  const appPort = await listen(app, 0, host);
  appOrigin = `http://${host}:${appPort}`;
  return {
    catalog,
    appOrigin,
    xtreamOrigin,
    async close() {
      app.closeAllConnections?.();
      await new Promise(resolve => app.close(() => resolve()));
      await demo.close();
    },
  };
}
