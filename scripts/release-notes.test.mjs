import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { normalizeVersion, releaseNotes } from './release-notes.mjs';

const changelog = `# Changelog

Intro text.

## [1.1.0] — 2026-01-02

**The newer one.**

### Added

- A thing.

## [1.0.0] — 2026-01-01

**The first one.**
`;

describe('releaseNotes', () => {
  it('returns one section without its heading', () => {
    expect(releaseNotes(changelog, '1.1.0')).toBe(
      '**The newer one.**\n\n### Added\n\n- A thing.',
    );
  });

  it('reads the last section to the end of the file', () => {
    expect(releaseNotes(changelog, '1.0.0')).toBe('**The first one.**');
  });

  it('accepts a tag as well as a version', () => {
    expect(normalizeVersion('v1.0.0')).toBe('1.0.0');
    expect(releaseNotes(changelog, 'v1.0.0')).toBe('**The first one.**');
  });

  it('returns null for a version with no section', () => {
    expect(releaseNotes(changelog, '9.9.9')).toBeNull();
  });

  it('does not match a version that only starts the same', () => {
    expect(releaseNotes(changelog, '1.1')).toBeNull();
  });
});

describe('CHANGELOG.md', () => {
  const real = readFileSync('CHANGELOG.md', 'utf8');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

  // A version bump without its notes would tag a release the job then
  // refuses to publish. Failing here moves that to the pull request.
  it(`has a section for the package version, ${version}`, () => {
    expect(releaseNotes(real, version)).not.toBeNull();
  });

  it('opens every section with a headline sentence', () => {
    const versions = [...real.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(releaseNotes(real, v), v).toMatch(/^\*\*[^*\n]+[.!?]\*\*/);
    }
  });
});
