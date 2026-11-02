---
name: commit
description: Stage and commit changes in this repo — tests scoped to the change first, no trailers, 72-column lines. Use whenever the user asks to commit.
---

# Commit

Only commit or push when the user asks. The default branch is `pleione`;
never commit to it directly. Commit on a branch off `pleione` named
`pleione-<topic>` (e.g. `pleione-readme`), and when the user asks for a PR,
push it and open one against `pleione` with `gh pr create --base pleione`.
If you are already on a `pleione-*` branch for the same work, commit there.

## 1. Test what the change touches

Run tests against the final changes, scoped to what they can affect:

- **No code:** docs, skills, comments, or other files nothing executes
  need no tests.
- **Clear scope:** run the colocated unit tests of the touched modules and
  the E2E specs covering the touched views, e.g.
  `npx vitest run src/foo.test.ts` and
  `npx playwright test e2e/foo.spec.ts`. Shared code (`src/utils/`,
  `src/navigation/`, `css/main.css`, `css/themes.css`) affects its
  callers too, so include their tests.
- **Unclear scope:** run both full suites, `npm test` and
  `npm run test:e2e`. That covers build, config, or dependency changes,
  and anything whose blast radius you can't name with confidence.

Also run `npm run typecheck` and `npm run lint` for any code change, and
`npm run service:smoke` for `bundled-service/`. State the scope you chose
and the commands you ran. Do not commit unless they pass after the last
code change; if one fails, fix it (or report it) and rerun.

## 2. Stage

Stage only what belongs to the change; leave unrelated local edits alone.
**Never run `git add` and `git commit` in the same command** — staging and
committing are separate, user-visible steps.

## 3. Write the message

- **Every line is at most 72 characters** — subject, body, and bullets.
  Measure it; 72 is a hard limit, not an approximation.
- Length is proportional: a small or mechanical change gets one tight
  subject line. A real feature gets an imperative subject, a blank line,
  then a body covering the key behaviors and the *why*, with bullets for
  supporting changes.
- **No trailers of any kind**: no `Co-Authored-By`, no `Copilot-Session`,
  no tool or agent attribution, even if the runtime adds one by default.
  The body ends with its last content line.

## 4. Commit

Commit with the message as a heredoc; no approval step is needed:

```bash
git commit -F - <<'EOF'
Subject

Body
EOF
```

Show the final message in your reply after committing.

## Media for README or GitHub

Upload with `gh image --repo ahmedsaed/pleione-webos-iptv-player -- <files>`; it
prints ready-to-use Markdown attachment URLs.
