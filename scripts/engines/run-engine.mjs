// Runs the smoke checks against one archived Chromium build. Normally started
// inside the engine container by scripts/engines/run.mjs, with the X server
// already up; it serves the fixtures, launches Chromium, and drives it over
// CDP. Writes report.json and one screenshot per check to --out.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CdpClient } from '../cdp-client.mjs';
import { parseArgs } from '../cli-args.mjs';
import { App, CHECKS, unexpectedErrors } from './checks.mjs';
import { EnginePage } from './driver.mjs';
import { ENGINES, PLATFORMS, parseChromeVersion } from './engines.mjs';
import { startFixtures } from './fixtures.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const { values: opts } = parseArgs(process.argv.slice(2), {
  options: {
    engine: { type: 'integer', positive: true },
    chrome: { type: 'string', default: '/chrome/chrome' },
    repo: { type: 'string', default: process.cwd() },
    out: { type: 'string', default: 'test-output/engines' },
    only: { type: 'string' },
  },
});
const engine = ENGINES.find(e => e.version === opts.engine);
if (!engine) throw new Error(`--engine must be one of ${ENGINES.map(e => e.version).join(', ')}`);
const platform = PLATFORMS[engine.platform];
const outDir = resolve(opts.out);
const log = (...args) => console.log(`[chromium ${engine.version}]`, ...args);

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function launchChrome(port, profileDir) {
  const args = [
    '--no-sandbox', '--test-type', '--disable-infobars', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--kiosk', '--window-position=0,0', '--window-size=1920,1080', '--force-device-scale-factor=1',
    `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-translate', '--disable-features=Translate', '--password-store=basic',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ];
  const env = engine.legacyPango
    ? { ...process.env, LD_LIBRARY_PATH: '/opt/legacy-pango' }
    : process.env;
  const child = spawn(opts.chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], env });
  let stderr = '';
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  const end = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Chromium exited (${child.exitCode}): ${stderr}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { child, version: await res.json() };
    } catch { /* not listening yet */ }
    if (Date.now() > end) throw new Error(`Chromium did not open its debugging port: ${stderr}`);
    await sleep(200);
  }
}

async function pageTarget(port) {
  const end = Date.now() + 10000;
  for (;;) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
    if (Date.now() > end) throw new Error('no page target');
    await sleep(200);
  }
}

// Kiosk mode fills the 1920x1080 screen on most builds; where a build's
// window comes out a pixel short (79 and later here), emulate the TV's size.
async function fitViewport(page) {
  const size = () => page.run(() => ({ width: innerWidth, height: innerHeight }));
  const before = await size();
  if (before.width === 1920 && before.height === 1080) return { ...before, emulated: false };
  await page.client.call('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
  const after = await size();
  log(`window viewport ${before.width}x${before.height}; emulating ${after.width}x${after.height}`);
  return { ...after, emulated: true, window: before };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const started = Date.now();
  const report = {
    engine: engine.version, position: engine.position, tvs: engine.tvs, bundle: platform.dir,
    browser: null, startedAt: new Date(started).toISOString(), durationMs: 0, checks: [], errors: [],
  };
  const fixtures = await startFixtures({ appDir: join(opts.repo, platform.dir), tizen: engine.platform === 'tizen', log });
  const profileDir = mkdtempSync(join(tmpdir(), 'engine-profile-'));
  const port = await freePort();
  let chrome;
  let client;
  try {
    chrome = await launchChrome(port, profileDir);
    report.browser = chrome.version.Browser;
    const major = parseChromeVersion(chrome.version.Browser);
    log(`${chrome.version.Browser}, ${platform.dir} bundle`);
    if (major !== engine.version) throw new Error(`expected Chromium ${engine.version}, got ${chrome.version.Browser}`);
    client = await CdpClient.connect(await pageTarget(port));
    const page = new EnginePage(client, { backKey: platform.backKey, log });
    await page.init();
    report.viewport = await fitViewport(page);
    const app = new App(page, fixtures);

    const only = opts.only ? new Set(opts.only.split(',')) : null;
    const checks = CHECKS.filter(c => !only || only.has(c.id));
    let profile = null;
    let n = 0;
    const record = async (check, fn) => {
      const t0 = Date.now();
      const shot = `${String(++n).padStart(2, '0')}-${check.id}.png`;
      const entry = { id: check.id, title: check.title, profile: check.profile, status: 'pass', reasons: [] };
      try {
        const result = await fn();
        entry.reasons = result.reasons;
        entry.details = result.details;
      } catch (error) {
        entry.reasons = [`could not run: ${error.message}`];
      }
      const errors = unexpectedErrors(await page.takeErrors());
      report.errors.push(...errors.map(e => ({ ...e, check: check.id })));
      if (errors.length) entry.reasons.push(`uncaught errors: ${errors.map(e => e.message).join(' | ')}`);
      if (entry.reasons.length) entry.status = 'fail';
      try {
        await page.screenshot(join(outDir, shot));
        entry.screenshot = shot;
      } catch (error) {
        entry.reasons.push(`no screenshot: ${error.message}`);
      }
      entry.durationMs = Date.now() - t0;
      report.checks.push(entry);
      log(`${entry.status === 'pass' ? 'PASS' : 'FAIL'} ${check.id} (${entry.durationMs} ms)`
        + (entry.reasons.length ? `\n    ${entry.reasons.join('\n    ')}` : ''));
      return entry;
    };

    for (const check of checks) {
      if (check.profile !== profile) {
        profile = check.profile;
        const boot = await record({ id: `boot-${profile}`, title: `Boot to Home (${profile})`, profile }, async () => {
          const t0 = Date.now();
          await app.boot(profile);
          return { reasons: [], details: { msToHome: Date.now() - t0 } };
        });
        if (boot.status === 'fail' && boot.reasons.some(r => r.startsWith('could not run'))) {
          for (const skipped of checks.filter(c => c.profile === profile)) {
            report.checks.push({ id: skipped.id, title: skipped.title, profile, status: 'fail',
              reasons: ['skipped: the app did not boot'] });
          }
          profile = `failed:${profile}`;
          continue;
        }
      }
      if (profile.startsWith('failed:')) continue;
      const entry = await record(check, () => check.run(app));
      // Start the next check from a known state, rebooting if Home is lost.
      if (entry.status === 'fail') {
        try {
          await app.goHome();
        } catch {
          try { await app.boot(profile); } catch (error) { log(`reboot failed: ${error.message}`); }
        }
      }
    }
  } catch (error) {
    report.fatal = error.message;
    log(`FATAL ${error.message}`);
  } finally {
    client?.close();
    if (chrome && chrome.child.exitCode === null) {
      const exited = new Promise(r => chrome.child.once('exit', r));
      chrome.child.kill('SIGKILL');
      await exited;
    }
    await fixtures.close();
    // The browser's helpers may still be letting go of the profile.
    try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a temp dir */ }
  }
  report.durationMs = Date.now() - started;
  report.passed = report.checks.filter(c => c.status === 'pass').length;
  report.failed = report.checks.filter(c => c.status !== 'pass').map(c => c.id);
  report.status = !report.fatal && report.failed.length === 0 && report.checks.length ? 'pass' : 'fail';
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  log(`${report.status.toUpperCase()}: ${report.passed}/${report.checks.length} checks in ${(report.durationMs / 1000).toFixed(1)} s`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

await main();
