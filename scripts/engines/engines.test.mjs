import { describe, expect, it } from 'vitest';
import {
  ENGINES, extractEngineArgs, formatSummary, parseChromeVersion, PLATFORMS, PR_ENGINES, selectEngines, snapshotUrl,
} from './engines.mjs';

describe('engine table', () => {
  it('maps every engine to a platform build, once', () => {
    const versions = ENGINES.map(e => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const e of ENGINES) {
      expect(PLATFORMS[e.platform]).toBeDefined();
      expect(Number.isInteger(e.position)).toBe(true);
    }
    expect(PR_ENGINES.every(v => versions.includes(v))).toBe(true);
  });

  it('builds the snapshot URL from the position', () => {
    expect(snapshotUrl(403380)).toBe(
      'https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/403380/chrome-linux.zip');
  });

  it('reads the major version from --version output and /json/version', () => {
    expect(parseChromeVersion('Chromium 69.0.3497.0 ')).toBe(69);
    expect(parseChromeVersion('Chrome/53.0.2785.0')).toBe(53);
    expect(parseChromeVersion('no version')).toBeNull();
  });
});

describe('selectEngines', () => {
  it('runs every engine by default and for "all"', () => {
    expect(selectEngines([])).toHaveLength(ENGINES.length);
    expect(selectEngines(['all'])).toHaveLength(ENGINES.length);
  });

  it('takes versions, comma lists and the PR set, in table order', () => {
    expect(selectEngines(['69', '53,68']).map(e => e.version)).toEqual([53, 68, 69]);
    expect(selectEngines(['pr']).map(e => e.version)).toEqual(PR_ENGINES);
  });

  it('rejects an unknown version', () => {
    expect(() => selectEngines(['70'])).toThrow('Unknown engine "70"');
  });
});

describe('extractEngineArgs', () => {
  it('collects repeated and inline --engine values and keeps the rest', () => {
    expect(extractEngineArgs(['--engine', '69', '--skip-build', '--engine=53', '-e', '68']))
      .toEqual({ engines: ['69', '53', '68'], rest: ['--skip-build'] });
  });

  it('requires a value', () => {
    expect(() => extractEngineArgs(['--engine'])).toThrow('--engine requires a value');
    expect(() => extractEngineArgs(['--engine', '--skip-build'])).toThrow('--engine requires a value');
  });
});

describe('formatSummary', () => {
  it('prints one aligned row per engine with its failures', () => {
    const text = formatSummary([
      { version: 53, tvs: 'webOS 4', status: 'pass', passed: 30, total: 30, failed: [], durationMs: 41000 },
      { version: 69, tvs: 'Tizen 5.5', status: 'fail', passed: 28, total: 30, failed: ['a', 'b'], durationMs: 9000 },
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatch(/^Chromium 53 +webOS 4 +PASS +30\/30 +41s$/);
    expect(lines[3]).toMatch(/FAIL +28\/30 +9s +a, b$/);
  });
});
