// The archived Chromium builds the smoke suite runs, matched to the TVs that
// ship each engine. Positions are Chromium snapshot build numbers in the
// public `chromium-browser-snapshots` bucket. `legacyPango` runs the build
// against the image's Pango 1.40 (see the Dockerfile).

export const ENGINES = [
  { version: 53, position: 403380, platform: 'webos', tvs: 'webOS 4', legacyPango: true },
  { version: 68, position: 561732, platform: 'webos', tvs: 'webOS 5' },
  { version: 69, position: 576753, platform: 'tizen', tvs: 'Tizen 5.5' },
  { version: 76, position: 665006, platform: 'tizen', tvs: 'Tizen 6' },
  { version: 79, position: 706915, platform: 'webos', tvs: 'webOS 6' },
  { version: 87, position: 812847, platform: 'webos', tvs: 'webOS 22' },
  { version: 94, position: 911577, platform: 'tizen', tvs: 'Tizen 7' },
  { version: 120, position: 1217362, platform: 'tizen', tvs: 'Tizen 9' },
];

// The engines every pull request runs; the rest run on tags and on demand.
export const PR_ENGINES = [53, 68, 69];

// What each platform's preview build needs: where esbuild writes it, the
// flags that build it, and the remote's Back key code (CONFIG.KEYS.BACK and
// platform.keys.back).
export const PLATFORMS = {
  webos: { dir: 'dist', buildArgs: ['--preview'], backKey: 461 },
  tizen: { dir: 'dist-tizen', buildArgs: ['--preview', '--platform=tizen'], backKey: 10009 },
};

export const SNAPSHOT_BASE = 'https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64';

export const snapshotUrl = position => `${SNAPSHOT_BASE}/${position}/chrome-linux.zip`;

/** The major version in `chrome --version` output ("Chromium 69.0.3497.0"), or null. */
export function parseChromeVersion(text) {
  const match = /(\d+)\.\d+\.\d+\.\d+/.exec(String(text));
  return match ? Number(match[1]) : null;
}

/**
 * The engines `--engine` values name: versions, comma lists, or `all`/`pr`.
 * No value means all of them.
 */
export function selectEngines(values = [], engines = ENGINES) {
  const tokens = values.flatMap(value => String(value).split(',')).map(v => v.trim()).filter(Boolean);
  if (!tokens.length || tokens.includes('all')) return engines.slice();
  const wanted = new Set();
  for (const token of tokens) {
    if (token === 'pr') {
      PR_ENGINES.forEach(v => wanted.add(v));
      continue;
    }
    const version = Number(token);
    if (!engines.some(e => e.version === version)) {
      throw new Error(`Unknown engine "${token}". Known: ${engines.map(e => e.version).join(', ')}, all, pr`);
    }
    wanted.add(version);
  }
  return engines.filter(e => wanted.has(e.version));
}

/** Pull every `--engine <v>` (repeatable) out of argv; the rest is left for parseArgs. */
export function extractEngineArgs(argv) {
  const engines = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--engine' || arg === '-e') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      engines.push(value);
      i++;
    } else if (arg.startsWith('--engine=')) {
      engines.push(arg.slice('--engine='.length));
    } else {
      rest.push(arg);
    }
  }
  return { engines, rest };
}

/** The console summary: one row per engine. */
export function formatSummary(results) {
  const rows = results.map(r => [
    `Chromium ${r.version}`, r.tvs, r.status.toUpperCase(),
    `${r.passed}/${r.total}`, `${(r.durationMs / 1000).toFixed(0)}s`,
    r.error ? r.error : r.failed.join(', '),
  ]);
  const head = ['Engine', 'TVs', 'Result', 'Checks', 'Time', 'Failures'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(row => String(row[i]).length)));
  const line = row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd();
  return [line(head), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
