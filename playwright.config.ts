import { defineConfig, devices } from '@playwright/test';
import { LEGACY_HEADER } from './scripts/chromium-53-simulation.mjs';

// The preview server (scripts/serve.mjs) listens on port 3000 unless PREVIEW_PORT is set.
const basePort = Number(process.env.PREVIEW_PORT || 3000);
const baseURL = `http://localhost:${basePort}`;
// The 1280x720 package for LG's Full HD TVs (`npm run preview:720`), one
// port above the main preview.
const fhdPort = basePort + 1;
const fhdURL = `http://localhost:${fhdPort}`;
const FHD_SPEC = /fhd-720\.spec\.ts/;
// The Samsung Tizen build (`npm run preview:tizen`) with a stubbed Tizen API,
// two ports above the main preview.
const tizenPort = basePort + 2;
const tizenURL = `http://localhost:${tizenPort}`;
const TIZEN_SPEC = /tizen-shell\.spec\.ts/;

// Build and serve an extra package only when a test of its project can run:
// no --project filter or one naming it, and no spec filter that leaves it out.
function wantsServer(argv: string[], project: string, spec: RegExp): boolean {
  const projects: string[] = [];
  const files: string[] = [];
  for (let i = argv.indexOf('test') + 1; i > 0 && i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') projects.push(argv[++i] ?? '');
    else if (arg.startsWith('--project=')) projects.push(arg.slice('--project='.length));
    else if (!arg.startsWith('-')) files.push(arg);
  }
  if (projects.length > 0 && !projects.includes(project)) return false;
  return files.length === 0 || files.some((f) => spec.test(f) || !/\.spec\.ts$/.test(f));
}

// End-to-end tests drive the real app in headless Chromium (close to the
// legacy webOS Chromium engine). The preview harness builds the app and serves
// dist/ on baseURL.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { outputFolder: 'test-output/report', open: 'never' }]],
  // Per-test artifacts (traces, screenshots) — kept under the shared test-output/ folder.
  outputDir: 'test-output/results',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [FHD_SPEC, TIZEN_SPEC],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    // The same suite against a simulated webOS 4 engine, degraded on two axes, both from scripts/chromium-53-simulation.mjs:
    // - CSS: the preview server rewrites each stylesheet through simulateLegacyEngine() — legacy fallbacks on, post-53 syntax dropped.
    // - JS: removeApis() deletes every API newer than Chromium 53 before the app loads.
    {
      name: 'chromium-53-simulation',
      testIgnore: [FHD_SPEC, TIZEN_SPEC],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        extraHTTPHeaders: { [LEGACY_HEADER]: '1' },
      },
    },
    // LG's Full HD TVs: the whole UI scaled by 2/3 onto a 1280x720 plane,
    // on the webOS 4 engine most of those sets run.
    {
      name: 'webos-720',
      testMatch: FHD_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: fhdURL,
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: { [LEGACY_HEADER]: '1' },
      },
    },
    // Samsung Tizen: the --platform=tizen build, with window.tizen stubbed
    // (e2e/tizen-shell.spec.ts) on a modern engine; Tizen 5.5 is Chromium 69.
    {
      name: 'tizen-sim',
      testMatch: TIZEN_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: tizenURL,
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run preview',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...(wantsServer(process.argv, 'webos-720', FHD_SPEC) ? [{
      command: 'npm run preview:720',
      url: fhdURL,
      env: { PREVIEW_PORT: String(fhdPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    }] : []),
    ...(wantsServer(process.argv, 'tizen-sim', TIZEN_SPEC) ? [{
      command: 'npm run preview:tizen',
      url: tizenURL,
      env: { PREVIEW_PORT: String(tizenPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    }] : []),
  ],
});
