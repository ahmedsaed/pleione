// npm run test:engines [-- --engine 69 [--engine 53,68]] [--skip-build]
// Runs the smoke suite in archived Chromium builds (docs/engine-suite.md):
// builds the preview bundles, downloads and caches each engine, builds the
// engine image, and runs every engine in its own container, one after the
// other. Exits non-zero when any engine fails.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { formatOptions, parseArgs } from '../cli-args.mjs';
import { extractEngineArgs, formatSummary, PLATFORMS, selectEngines, snapshotUrl } from './engines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'scripts', 'engines');

const SPEC = {
  options: {
    help: { type: 'boolean', short: 'h', description: 'Show this help' },
    'skip-build': { type: 'boolean', description: 'Use the bundles already in dist/ and dist-tizen/' },
    'cache-dir': {
      type: 'string', valueName: '<path>',
      default: process.env.PLEIONE_ENGINES_CACHE || join(homedir(), '.cache', 'pleione-engines'),
      description: 'Where Chromium builds are downloaded and unzipped (env PLEIONE_ENGINES_CACHE)',
    },
    out: { type: 'string', valueName: '<path>', default: join(ROOT, 'test-output', 'engines'), description: 'Report and screenshot folder' },
    image: { type: 'string', valueName: '<tag>', default: 'pleione-engines:local', description: 'Docker image tag to build and run' },
    'skip-image': { type: 'boolean', description: 'Use the --image already built (CI builds it with layer caching)' },
    only: { type: 'string', valueName: '<ids>', description: 'Comma-separated check ids to run (boot always runs)' },
  },
};

const HELP = `Usage: npm run test:engines -- [--engine <version>]... [options]

Runs the engine smoke suite in archived Chromium builds under Docker.
--engine takes a version (53, 68, 69, 76, 79, 87, 94, 120), a comma list,
"pr" (the pull request set) or "all" (the default).

${formatOptions(SPEC)}
`;

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status ?? r.signal})`);
};

async function ensureEngine(engine, cacheDir) {
  const dir = join(cacheDir, String(engine.position));
  const chrome = join(dir, 'chrome-linux', 'chrome');
  if (existsSync(chrome)) return join(dir, 'chrome-linux');
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, 'chrome-linux.zip');
  if (!existsSync(zip)) {
    const url = snapshotUrl(engine.position);
    console.log(`Downloading Chromium ${engine.version} from ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
    const partial = `${zip}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    execFileSync('mv', [partial, zip]);
  }
  rmSync(join(dir, 'chrome-linux'), { recursive: true, force: true });
  execFileSync('unzip', ['-q', zip, '-d', dir]);
  return join(dir, 'chrome-linux');
}

function runEngine(engine, chromeDir, outDir, opts) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const args = [
    'run', '--rm', '--shm-size=1g', '--user', `${uid}:${gid}`, '-e', 'HOME=/tmp',
    '-v', `${ROOT}:/repo:ro`, '-v', `${chromeDir}:/chrome:ro`, '-v', `${outDir}:/out`, '-w', '/repo',
    opts.image, 'node', 'scripts/engines/run-engine.mjs', '--engine', String(engine.version), '--out', '/out',
    ...(opts.only ? ['--only', opts.only] : []),
  ];
  return new Promise(res => {
    const child = spawn('docker', args, { stdio: 'inherit' });
    child.on('exit', code => res(code ?? 1));
  });
}

async function main() {
  const { engines: engineArgs, rest } = extractEngineArgs(process.argv.slice(2));
  const { values: opts } = parseArgs(rest, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const engines = selectEngines(engineArgs);
  const cacheDir = resolve(opts['cache-dir']);
  console.log(`Engines: ${engines.map(e => e.version).join(', ')}`);
  console.log(`Chromium cache: ${cacheDir} (delete it to free the space)`);

  if (!opts['skip-build']) {
    for (const name of new Set(engines.map(e => e.platform))) {
      run('node', ['esbuild.config.mjs', ...PLATFORMS[name].buildArgs]);
    }
  }
  if (!opts['skip-image']) run('docker', ['build', '-q', '-t', opts.image, HERE]);

  const results = [];
  for (const engine of engines) {
    const outDir = join(resolve(opts.out), String(engine.version));
    const t0 = Date.now();
    let error = null;
    let code = 1;
    try {
      const chromeDir = await ensureEngine(engine, cacheDir);
      code = await runEngine(engine, chromeDir, outDir, opts);
    } catch (e) {
      error = e.message;
    }
    let report = null;
    try { report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')); } catch { /* none written */ }
    results.push({
      version: engine.version, tvs: engine.tvs,
      status: code === 0 && report?.status === 'pass' ? 'pass' : 'fail',
      passed: report?.passed ?? 0, total: report?.checks.length ?? 0,
      failed: report?.failed ?? [], error: error ?? report?.fatal ?? (report ? null : 'no report'),
      durationMs: Date.now() - t0,
    });
  }
  console.log(`\n${formatSummary(results)}\n\nReports: ${resolve(opts.out)}`);
  if (results.some(r => r.status !== 'pass')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
