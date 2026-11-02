import * as esbuild from 'esbuild';
import { cpSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'fs';
import {
  LEGACY_JS_BANNER,
  scanBundle,
  formatViolations,
} from './scripts/compat-gate.mjs';
import { validateShakaBundle } from './scripts/shaka-compat-gate.mjs';
import { writeThirdPartyNotices } from './scripts/third-party-notices.mjs';
import {
  convertLegacyColorSyntax,
  generateFlexGapFallback,
  linkedStylesheets,
  mirrorStylesheet,
  scaleFontSizes,
  scaleLengths,
} from './scripts/css-transforms.mjs';
import { tizenConfigXml } from './scripts/tizen-config.mjs';

const isPreview = process.argv.includes('--preview');
// The TV platform this bundle is for (`__PLATFORM__`). webOS builds into
// dist/; Samsung Tizen into dist-tizen/ (docs/tizen-port-plan.md).
const platformArg = process.argv.find(arg => arg.startsWith('--platform='));
const platform = platformArg ? platformArg.slice('--platform='.length) : 'webos';
if (platform !== 'webos' && platform !== 'tizen') {
  console.error(`Unknown --platform=${platform}; expected webos or tizen`);
  process.exit(1);
}
// LG's Full HD TVs run apps on a 1280x720 plane and need their own package
// (`"resolution": "1280x720"`). That build scales the whole 1920x1080 design
// by 2/3 into dist-720/: every stylesheet length, the canvas, and every JS
// length that goes through uiPx() (UI_BASE_SCALE).
const isFhd = process.argv.includes('--resolution=720');
if (isFhd && platform !== 'webos') {
  console.error('--resolution=720 is the LG Full HD package; it needs --platform=webos');
  process.exit(1);
}
const OUT = platform === 'tizen' ? 'dist-tizen' : isFhd ? 'dist-720' : 'dist';
const UI_BASE_SCALE = isFhd ? 2 / 3 : 1;
// Checked-in but regenerated on every build; never a source input.
const GENERATED_STYLESHEET = 'legacy-webos-base.css';
// Read version from package.json (single source of truth)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

// Sync version to appinfo.json
const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));
if (appinfo.version !== version) {
  appinfo.version = version;
  writeFileSync('appinfo.json', JSON.stringify(appinfo, null, 2) + '\n');
}

// The Interface sizes, from their single source in src/config/themes.ts.
function interfaceSizes() {
  const source = readFileSync('src/config/themes.ts', 'utf8');
  const list = /INTERFACE_SIZES = \[([^\]]+)\]/.exec(source);
  if (!list) throw new Error('INTERFACE_SIZES not found in src/config/themes.ts');
  return list[1].split(',').map((id) => id.trim().replace(/'/g, '')).filter((id) => id && id !== '100');
}

// Every non-default Interface size gets its own copy of each stylesheet in
// css/ui-<size>/, with the px lengths already multiplied out, and every
// stylesheet a mirrored right-to-left copy in css/rtl/ (and css/rtl/ui-<size>/).
function transformStylesheets(outDir, baseScale) {
  const sizes = interfaceSizes();
  for (const size of sizes) {
    mkdirSync(`${outDir}/ui-${size}`, { recursive: true });
    mkdirSync(`${outDir}/rtl/ui-${size}`, { recursive: true });
  }
  for (const file of readdirSync(outDir)) {
    if (!file.endsWith('.css')) continue;
    const path = `${outDir}/${file}`;
    const source = scaleFontSizes(convertLegacyColorSyntax(readFileSync(path, 'utf8')));
    // The plane's own scale reaches the canvas and subtitle cues too, which
    // an Interface size leaves alone.
    const css = baseScale === 1 ? source : scaleLengths(source, baseScale, { canvas: true, cues: true });
    const rtl = mirrorStylesheet(css);
    writeFileSync(path, css);
    writeFileSync(`${outDir}/rtl/${file}`, rtl);
    for (const size of sizes) {
      writeFileSync(`${outDir}/ui-${size}/${file}`, scaleLengths(css, Number(size) / 100));
      writeFileSync(`${outDir}/rtl/ui-${size}/${file}`, scaleLengths(rtl, Number(size) / 100));
    }
  }
}

// Copy static assets to dist. The source HTML is the production/webOS version;
// preview builds swap only the platform library at build time.
mkdirSync(OUT, { recursive: true });
const indexHtml = readFileSync('index.html', 'utf8');
const previewLibsMarker = '<!-- preview-libs -->';
let outputIndexHtml = indexHtml.replace(
  previewLibsMarker,
  isPreview ? '<script src="js/preview-libs.js"></script>' : '',
);
if (outputIndexHtml === indexHtml) {
  throw new Error('Build could not find the preview library marker in index.html.');
}
if (isFhd) {
  const viewport = '<meta name="viewport" content="width=1920, height=1080, initial-scale=1.0">';
  if (!outputIndexHtml.includes(viewport)) throw new Error('Build could not find the viewport meta in index.html.');
  outputIndexHtml = outputIndexHtml.replace(viewport, viewport.replace('width=1920, height=1080', 'width=1280, height=720'));
}
if (platform === 'tizen') {
  // Samsung remotes have no pointer, so the app starts in key mode.
  outputIndexHtml = outputIndexHtml.replace('<html lang="en">', '<html lang="en" class="keyboard-nav">');
  writeFileSync(`${OUT}/config.xml`, tizenConfigXml(version));
  cpSync('assets/icon130.png', `${OUT}/icon.png`);
} else {
  writeFileSync(`${OUT}/appinfo.json`, JSON.stringify(
    isFhd ? { ...appinfo, resolution: '1280x720' } : appinfo, null, 2) + '\n');
  rmSync(`${OUT}/resources`, { recursive: true, force: true });
  cpSync('resources', `${OUT}/resources`, { recursive: true });
}
writeFileSync(`${OUT}/index.html`, outputIndexHtml);
// Refresh the flex-`gap` fallback; see its header for the cascade rationale.
const sourceStylesheets = linkedStylesheets(indexHtml, readdirSync('css'), GENERATED_STYLESHEET)
  .map((file) => readFileSync(`css/${file}`, 'utf8'));
const generatedStylesheet = generateFlexGapFallback(sourceStylesheets);
// The 1280x720 and Tizen builds can run beside the main one (E2E servers
// start together), so only the main webOS build rewrites the checked-in copy.
if (platform === 'webos' && !isFhd) writeFileSync(`css/${GENERATED_STYLESHEET}`, generatedStylesheet);
cpSync('css', `${OUT}/css`, { recursive: true });
writeFileSync(`${OUT}/css/${GENERATED_STYLESHEET}`, generatedStylesheet);
transformStylesheets(`${OUT}/css`, UI_BASE_SCALE);
if (platform === 'webos') {
  cpSync('assets/icon80.png', `${OUT}/icon.png`);
  cpSync('assets/icon130.png', `${OUT}/largeIcon.png`);
}
cpSync('assets/group-icons', `${OUT}/assets/group-icons`, { recursive: true });
cpSync('assets/icons', `${OUT}/assets/icons`, { recursive: true });

// Main app bundle — playback libraries remain separate. Shaka is shipped as a
// lazy TV bundle for Widevine and is also used by the desktop preview.
const serviceId = JSON.parse(readFileSync('bundled-service/src/services.json', 'utf8')).id;
const define = {
  '__APP_VERSION__': JSON.stringify(version),
  '__APP_ID__': JSON.stringify(appinfo.id),
  '__SERVICE_ID__': JSON.stringify(serviceId),
  '__ENABLE_PSEUDO_LOCALE__': JSON.stringify(isPreview),
  '__PLATFORM__': JSON.stringify(platform),
  '__UI_BASE_SCALE__': JSON.stringify(UI_BASE_SCALE),
};
// Target Chromium 53 — the engine on webOS 4. This down-levels newer
// syntax (`?.`, `??`, etc.) which would otherwise fail to parse on
// older TVs and leave the app stuck on the loading screen.
const TARGET = ['chrome53'];

// Shared config for the main app bundle (src/app.ts). The shipped build and
// compat-gate scan use the same tree-shaken graph.
const appBuild = {
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: `${OUT}/js/app.js`,
  format: 'iife',
  target: TARGET,
  banner: { js: LEGACY_JS_BANNER },
  external: ['hls.js', 'mpegts.js', 'shaka-player'],
  define,
};
const workerBuild = {
  entryPoints: ['src/workers/app-worker.ts'],
  bundle: true,
  outfile: `${OUT}/js/app-worker.js`,
  format: 'iife',
  target: TARGET,
  banner: { js: LEGACY_JS_BANNER },
  define,
};
const shippedBuilds = [
  { name: 'app', config: appBuild },
  { name: 'worker', config: workerBuild },
];

// Shipped bundles (minified, both go into the IPK).
const bundled = await Promise.all(shippedBuilds.map(({ config }) =>
  esbuild.build({ ...config, minify: true, metafile: true })));

const shakaBundle = readFileSync('node_modules/shaka-player/dist/shaka-player.dash.js', 'utf8');
validateShakaBundle(shakaBundle);
writeFileSync(`${OUT}/js/shaka-player.dash.js`, shakaBundle);

// webOS 4 (Chromium 53) bundle compat gate. Down-leveling handles post-53
// *syntax*, but not *APIs* — and dependencies get bundled in without passing
// through the eslint source gate. Scan a NON-minified build of the same entry
// (same tree-shaken graph, readable identifiers) for banned APIs.
for (const { name, config } of shippedBuilds) {
  const scan = await esbuild.build({ ...config, minify: false, write: false });
  const violations = scanBundle(scan.outputFiles[0].text);
  if (violations.length > 0) {
    throw new Error(`${name} bundle:\n${formatViolations(violations)}`);
  }
}
console.log('Compat gate: app, worker and Shaka bundles are Chromium-53 clean.');

// Desktop-only HLS and MPEG-TS libraries. Shaka stays in its separate lazy
// bundle on both desktop and webOS.
if (isPreview) {
  await esbuild.build({
    entryPoints: ['src/preview-libs.ts'],
    bundle: true,
    outfile: `${OUT}/js/preview-libs.js`,
    format: 'iife',
    target: TARGET,
    minify: true,
  });
} else {
  rmSync(`${OUT}/js/preview-libs.js`, { force: true });
}

writeThirdPartyNotices({
  outDir: OUT,
  metafiles: bundled.map(({ metafile }) => metafile),
});

console.log('Build complete.');
