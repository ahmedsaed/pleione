# Engine smoke suite

The Playwright E2E suite runs on a current Chromium, and its
`chromium-53-simulation` project only removes APIs and `@supports`
fallbacks. Neither can show how an old engine lays a page out: the
Settings view once scrolled whole, header and sidebar with it, on Chromium
68 and 69 (webOS 5, Tizen 5.5) because their grid grew an implicit row to
its content. The engine suite runs the app in the real archived Chromium
builds those TVs ship and checks layout and focus on every main screen.

## Engines

| Chromium | Snapshot | TVs | Bundle |
| --- | --- | --- | --- |
| 53 | 403380 | webOS 4 | `dist` |
| 68 | 561732 | webOS 5 | `dist` |
| 69 | 576753 | Tizen 5.5 | `dist-tizen` |
| 76 | 665006 | Tizen 6 | `dist-tizen` |
| 79 | 706915 | webOS 6 | `dist` |
| 87 | 812847 | webOS 22 | `dist` |
| 94 | 911577 | Tizen 7 | `dist-tizen` |
| 120 | 1217362 | Tizen 9 | `dist-tizen` |

webOS engines load the webOS preview build (`node esbuild.config.mjs
--preview`); Tizen engines load the Tizen one (`--preview
--platform=tizen`) with `window.tizen` stubbed as
`e2e/tizen-shell.spec.ts` stubs it, so each engine runs the code its TVs
run. The table lives in `scripts/engines/engines.mjs`.

## Running it

```bash
npm run test:engines                      # all eight engines
npm run test:engines -- --engine 69       # one engine
npm run test:engines -- --engine 53,68 --engine 69
npm run test:engines -- --engine pr       # the pull request set: 53, 68, 69
npm run test:engines -- --engine 69 --skip-build --only settings-sources-walk
```

It needs Docker and `unzip`. The runner builds the bundles (unless
`--skip-build`), downloads each Chromium build once into
`~/.cache/pleione-engines` (`--cache-dir` or `PLEIONE_ENGINES_CACHE`
moves it; `rm -rf ~/.cache/pleione-engines` clears it, and
`docker image rm pleione-engines:local` drops the image), builds the
`pleione-engines:local` image from `scripts/engines/Dockerfile`, and runs
the engines one after another, each in its own container. An engine takes
under a minute. Each writes `test-output/engines/<version>/report.json`
and one screenshot per check; the runner prints a summary table and exits
non-zero when any check fails.

Inside the container (Ubuntu 20.04, whose libraries the oldest builds
still link against, plus Ubuntu 18.04's Pango for Chromium 53),
`run-engine.mjs` serves the fixtures, starts Chromium under Xvfb at
1920x1080 in kiosk mode, and drives it over raw CDP with the methods
Chromium 53 already has (`Runtime.evaluate`, `Input.dispatchKeyEvent`,
`Page.captureScreenshot`). Builds from 79 on open their kiosk window a
pixel short, so there the runner emulates the 1920x1080 viewport
(`viewport` in the report). Keys go in as the remote sends them, Back as
461 on webOS builds and 10009 on Tizen ones.

## Fixtures

Old engines have no request interception over CDP, so a local server
answers everything: the built app with a harness script injected first
(an uncaught-error collector, and the Tizen stub), a 60-channel M3U, and
the demo Xtream portal (`scripts/xtream-demo`, catalog size `smoke`) for
Live, the XMLTV guide, Movies and Series. Streams carry no media: the M3U
channels answer with a segment-less live manifest so the player shows its
OSD, and the portal's streams fail. Before launch, a blank same-origin
page seeds `localStorage` with both sources (and the privacy consent a
Samsung build asks for) plus the profile under test: `default`, `rtl`
(Arabic), or `large` (text size 150, Interface size 130).

## Checks

Every screen check audits, after navigating there with keys:

- nothing inside the view reaches past the 1920 px screen sideways (an
  ancestor that clips, such as a rail, hides what it scrolls);
- the document and the view root have not scrolled;
- exactly one focus owner (`[data-ring-owner]`) and one ring, as the E2E
  ring audit counts them, and the focused element is on screen and inside
  its scroll container.

Walk checks press Down through Live's channel list and the Settings
Sources and Advanced pages, auditing each step: the intended pane must
scroll, the view and the header must stay put. The suite also opens and
cancels a confirmation prompt, and covers Home, Live, the Guide, the
player OSD, Movies and Series (rails, See all grid, detail), Search, and
every Settings page, then Home and Settings in Arabic and Home and Live at
the largest sizes. Any uncaught script error fails the check it happened
in, except the media `play()` rejections the stream-less fixtures cause
(`ERROR_ALLOWLIST` in `checks.mjs`).

To add a screen, add a `screen({ id, title, go, view })` entry to `CHECKS`
in `scripts/engines/checks.mjs`: `go` gets there with the `App` helpers
(`openSection`, `openSettingsPage`, `steer`, `pressUntil`,
`page.press`), `view` is its root, and `visible`, `ring`, `ringIn`, `dir`
and `htmlData` add assertions. A scrolling screen is a `walk({...})` with
its `scroller` and `header`. Code sent to the page (`page.run` and
`page.waitFor` bodies, `probes.mjs`) must parse as ES2015 and use no API
newer than Chromium 53; `probes.test.mjs` checks the syntax.

## CI

The `engines` job in `.github/workflows/build.yml` runs one parallel job
per engine: 53, 68 and 69 on pull requests and pushes, all eight on `v*`
tags and manual runs. It caches each Chromium zip by engine and the image
layers in the Actions cache, uploads `test-output/engines` as an artifact
on every run, and the release waits for it.

## What it cannot catch

- Media playback: there is no media, and desktop Chromium has neither
  webOS's native pipeline nor Tizen's AVPlay.
- TV-only APIs and services: Luna, the LAN service, the real
  `window.tizen`.
- TV fonts and performance: the container renders with DejaVu and Noto,
  and a desktop CPU hides the timing of a TV's.
- Pointer and Magic Remote input; the suite presses keys only.
- Differences between a snapshot build and the TV's patched browser.
