#!/usr/bin/env node

// Print one version's section of CHANGELOG.md, for a GitHub release's
// notes. The release job in .github/workflows/build.yml runs it with the
// tag it is publishing:
//
//   node scripts/release-notes.mjs v2.6.2 > notes.md
//
// A version with no section fails the job rather than publishing a
// release with no notes, which is what every release before 2.6.2 shipped
// as.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/** `v2.6.2` and `2.6.2` name the same version. */
export function normalizeVersion(tagOrVersion) {
  return String(tagOrVersion).trim().replace(/^v/, '');
}

/**
 * The body of `## [version] — date`, up to the next `## ` heading, with the
 * heading itself left out: a release page already shows the version.
 * Returns null when the changelog has no section for it.
 */
export function releaseNotes(changelog, tagOrVersion) {
  const version = normalizeVersion(tagOrVersion);
  const lines = changelog.split('\n');
  const heading = (line) => /^## \[([^\]]+)\]/.exec(line)?.[1];

  const start = lines.findIndex((line) => heading(line) === version);
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!tag) {
    console.error('usage: node scripts/release-notes.mjs <tag-or-version>');
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), tag);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${normalizeVersion(tag)}.`);
    process.exit(1);
  }
  process.stdout.write(notes + '\n');
}
