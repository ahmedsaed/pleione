# AGENTS.md

IPTV player for LG webOS TVs, with a Samsung Tizen port in progress. Vanilla TypeScript (no UI framework), bundled
with esbuild and packaged as a webOS `.ipk`. A separate bundled webOS JS
service (`bundled-service/`) provides LAN M3U uploads over Luna + HTTP. App
id `com.merope.pleione`; targets webOS 4+ (Chromium 53).

## Skills

Procedural workflows live in `.agents/skills/` (open Agent Skills format;
`.claude/skills` is a symlink to it). Load the matching skill before acting:

| Skill | Use when |
| --- | --- |
| `feature-review` | A feature is implemented and its tests pass — run it unasked. |
| `commit` | The user asks to commit. |
| `ui-design` | Building or restyling a view, overlay, or component, or reviewing a UI change. |
| `ui-copy` | Adding or changing any user-visible string, naming a feature, or translating. |
| `legacy-engine` | Adding browser APIs/polyfills, editing CSS layout or `css/legacy-*.css`, writing or debugging E2E tests. |
| `webos-device` | Installing on a TV, or debugging what only reproduces on device. |
| `tizen-device` | Installing on a Samsung TV, signing, or probing what only reproduces there. |
| `user-choice` | Asking the user to pick, approve, or confirm anything. |

## Key rules

- Modern *APIs* silently break webOS 4. `npm run lint` and the build gate
  must pass; never change the esbuild `chrome53` target without reason.
- Render with `morph()` + the `html` template — never `innerHTML =`.
  Interpolate untrusted M3U/XMLTV text only through `html`.
- Every bug fix ships with a regression test that fails without the fix.
- Add a `tv.sh diag` event only when a bug report could not show the
  failure without it; no event beats a noisy one.
- Tests and docs use synthetic identifiers only.
- Never hand-edit the version in `appinfo.json` (it syncs from
  `package.json`), and never hand-edit the generated
  `css/legacy-webos-base.css`.
- CSS: never put a modern selector (e.g. `:focus-within`) in the same rule
  as a legacy one — Chromium 53 drops the whole rule (stylelint
  `iptv/no-mixed-legacy-selector` enforces it). Every legacy fallback
  sits under a top-level `@supports not (...)` or an `html.q-*` class
  that `src/engine-quirks.ts` measures at boot; every polyfill is
  feature-detected.
- Chromium 53 treats a `scrollIntoView` options object as `true`;
  `src/polyfills.ts` fixes it, so never bypass or reimplement that call.
- Only the surface that owns the keys shows a focus ring. Every surface
  owns its focus through a scope on the `Focus` owner stack
  (`src/navigation/focus-scope.ts`): the scope tracks its focused
  `data-key`, and only the owner scope paints its ring, by key, after
  every key, pointer move, push/pop, and `morph()`, so a re-render or a
  virtualized list never loses it. A new modal or overlay registers a
  scope at the right `Tier`, which both routes keys and picks the ring: a
  prompt pushes itself while shown (as `ConfirmationPrompt` does). A
  pushed modal keeps the pointer's hover outside it from the surfaces below.
  A `SpatialNav` only picks and hands its pick to its scope; it never
  paints. ESLint keeps the class behind
  `setRing()`/`ringsIn()`; the only `focus/*` disable is the player OSD's
  activity listener. Every E2E test fails when a key press
  leaves two rings on screen. Hover never moves the keys; after a
  pointer click on a Home card, `FocusRing.defer()`
  keeps the content's ring hidden and the first key only shows it.
- Right-to-left locales mirror the UI (`docs/rtl-layout.md`). Write CSS
  left to right: the build mirrors every sheet into `css/rtl/`, and
  `/* rtl:ignore */` opts a rule out. Position along a row in JS with
  `inlineStart()`, never a literal `left`. In RTL, Left/Right arrive as
  logical actions; geometric code converts them with `screenSide`. Never
  read or write an absolute horizontal `scrollLeft`: use the helpers in
  `src/utils/direction.ts`, which handle both engine models.
- `bundled-service/` runs on Node.js 0.12.2: ES5/CommonJS, newer Node APIs
  via `compat.ts`, and `npm run service:smoke` after any change. Read
  `bundled-service/AGENTS.md` before changing the service or its Luna/HTTP
  contract (`setup-client.ts`, `upload-client.ts`, reminder delivery).
- After installing on a TV, cold-restart the app (`build.sh --install`);
  a plain relaunch keeps running the old bundle.
- Commit only when asked, and only through the `commit` skill.

## Commands

```bash
npm install                    # setup
npm run typecheck              # tsc --noEmit (strict)
npm run lint                   # stylelint + eslint Chromium 53 compat gate
npm run build                  # typecheck + esbuild bundle into dist/
npm run preview                # build + serve dist/ at http://localhost:3000
npm test                       # vitest run (unit/integration)
npm run test:watch             # vitest watch
npm run test:e2e               # Playwright: webOS, simulated webOS 4 (see legacy-engine), tizen-sim
npm run test:all               # lint + unit + e2e
npm run test:engines           # smoke suite in real archived Chromium builds (Docker; docs/engine-suite.md)
npm run screenshots            # regenerate README screenshots
npm run xtream:demo            # demo Xtream server on :8090 (ffmpeg; docs/xtream-demo-server.md)
npm run service:smoke          # bundled service on real Node.js 0.12.2
npm run service:smoke:matrix   # webOS 4-26 Node runtime matrix
./build.sh [--install [device]]  # package the IPK (see webos-device)
PLEIONE_FHD=1 ./build.sh       # also package the 1280x720 IPK for LG Full HD TVs
npm run build:tizen            # Samsung bundle into dist-tizen/
TIZEN_TV=<ip> scripts/tizen.sh install  # package the .wgt and install (docs/tizen.md)
```

Run a single test by file or name:

```bash
npx vitest run src/parsers/m3u-parser.test.ts
npx vitest run -t "parses catchup-source"
```

There is no Prettier/autoformatter, but ESLint + stylelint (`npm run lint`)
and `tsc` strictness are real gates.

## CI

`.github/workflows/build.yml` runs typecheck (app, `service`, **and**
`benchmarks`), `npm run lint` and the compat gate, `vitest run`, the esbuild
bundle, `service:smoke:matrix`, and packages the IPK, while the E2E suite
runs in both projects across six parallel shards. The `engines` job runs
the engine smoke suite in real archived Chromium builds, one job per
engine: 53, 68 and 69 on every PR and push, all eight on tags. Pushes to `pleione` and every
PR build; tagged `v*` pushes publish a GitHub release with the `.ipk` once
the build and every shard pass.

Locally, run the unit tests and the E2E specs that cover the change with
`--project=chromium` (both projects when it touches layout, CSS, or a
browser API) and leave the full E2E suite to CI. After a layout change,
`npm run test:engines -- --engine pr` runs the oldest real engines.

## Versioning

`package.json` `version` is the **single source of truth**.
`esbuild.config.mjs` syncs it into `appinfo.json` and the `__APP_VERSION__`
build constant; `scripts/sync-version.mjs` runs on `npm version`.

A version bump carries its notes: add a `## [x.y.z] — date` section to
`CHANGELOG.md` in the same change, opening with one bold headline
sentence. The release job publishes that section as the GitHub release's
notes (`scripts/release-notes.mjs`), and a test fails while
`package.json` has a version with no section.

## Architecture

- **Entry `src/app.ts`** — the `App` class instantiates the top-level
  components, owns a `viewStack`, and routes remote-control input.
  `KeyHandler` (`src/navigation/key-handler.ts`) maps key codes
  (`CONFIG.KEYS`) to a small `Action` union (`up`/`down`/`select`/`red`/… in
  `src/types.ts`); `App.handleKey` dispatches to the active view's
  `handleAction`.
- **Views** are plain `<div>`s in `index.html` (`home`, `channels`, `player`, `epg`,
  `settings`, `loading`, plus the Xtream `movies`/`series` catalogs and
  `search`) toggled with `show`/`hide` from `src/utils/dom.ts`.
- **Sections & Xtream catalog** — `Home` (`src/components/home.ts`) is the
  first screen: destinations for the **Live / Guide / Movies / Series /
  Search / Settings** sections (`sections.ts`), the Continue Watching and
  Favorites rails, and the avatar switcher (`account-switcher.ts`), which
  picks the one source (account or playlist) every section shows: all
  enabled sources stay loaded, and `PlaylistService.channels` holds only the
  picked one's channels. Sections open full screen. Back goes up one
  level (`navigation/back-route.ts`): a section's top level returns to Home,
  where Back leaves the app in one press (`utils/platform-exit.ts`); the
  pointer gets a Home button (`home-button.ts`). Search keeps its
  query box (`search-box.ts`) at the top of its view. `App` owns section
  switching. Movies/Series
  (`movies.ts`, `series.ts`) share the browse/grid/detail machinery in
  `CatalogView` (`catalog-view.ts`) over the per-account `xtream-catalog`
  cache, with a **Continue Watching** resume rail. `search.ts` ranks
  channels, programs, movies, and series in one view. Movies/Series require
  an Xtream account to be picked; a playlist shows Live/Guide/Settings/Search.
- **Components** (`src/components/`) own a DOM subtree and re-render through
  `morph()` (`src/utils/morph.ts`), a keyed in-place reconciler fed by the
  `html` tagged template. Reused nodes keep listeners, focus, and scroll, so
  list items carry a stable `data-key`. Build a `Safe` with `` html`…` `` and
  pass it to `morph`; bind listeners once (delegated), not per render.
  `Player` delegates media loading and desktop hls.js/mpegts.js/Shaka access
  to `PlayerPipeline` (`player-pipeline.ts`) and audio/subtitle state to
  `PlayerTracks` (`player-tracks.ts`). A desktop MSE library owns its own
  tracks behind the `MseEngine` adapters in `src/components/mse/`
  (`isMseActive()`); on webOS everything plays natively, DASH included — see
  `docs/mpeg-dash.md`.
  On Tizen 8+ HLS, raw TS and single files play through Samsung's AVPlay:
  Player, `PlayerTracks` and the subtitle services work on `PlayerMedia`
  (`player-media.ts`), which the `<video>` element satisfies and `AvplayMedia`
  (`src/platform/tizen-avplay.ts`) implements, so playback state goes through
  `media` and only DOM work through `videoEl` — see `docs/tizen.md`.
- **Services** (`src/services/`) expose facades such as `PlaylistService`,
  `EpgService`, `StorageService`, `SetupClient`, `UploadClient`, and
  `ReminderService`. `StorageService` keeps boot-critical configuration under
  `iptv_` localStorage keys and fronts durable user records from
  `idb-user-data`; `idb-cache` owns disposable IndexedDB data and
  `idb-database` owns the shared schema/transactions. A localStorage quota
  error evicts parsed-playlist and stream-MIME caches before retrying.
  `ReminderService` stores reminders, schedules an Activity Manager callback
  per reminder, and resolves a launch param back to a channel. Xtream access
  goes through `createXtreamClient` and the IndexedDB-backed `xtream-catalog`
  cache; `media-probe`, `hls-subtitles`, `vod-subtitles`, and
  `ass-subtitles` back the stream-info readout and subtitle rendering.
- **Navigation** (`src/navigation/`) — `SpatialNav` does geometric D-pad
  focus among `[data-focusable]` elements (grouped by
  `[data-nav-container]`); `KeyHandler` also wires pointer/Magic Remote and
  desktop mouse/wheel input. `Focus` scopes (`focus-scope.ts`) own the
  keys and paint the owner's ring by `data-key`, repainting it after every
  `morph()`; `FocusRing` (`focus-ring.ts`) shows only the owner's ring and
  marks the owner root `data-ring-owner` and `data-focus-scope` and
  the hover target `data-ring-hover`, which the E2E ring audit reads.
  `InputMode` (`input-mode.ts`) is the keys/pointer mode, written only
  by `KeyHandler`.
- **Parsers** (`src/parsers/`) — `parseM3U` / `parseXMLTV` are pure
  functions; keep them tolerant of messy real-world feeds.
- **Platform** (`src/platform/`) — the TV platform behind one `platform`
  adapter, picked at build time by `__PLATFORM__` (`--platform=`, default
  `webos`): exit, launch params, relaunch, and media capabilities. Code
  outside `src/platform/` asks it instead of checking `isWebOS()`; the
  Samsung port adds a second adapter (`docs/tizen-port-plan.md`).
- **Full HD package** — LG's Full HD TVs run apps on a 1280x720 plane, so
  `--resolution=720` builds the same app into `dist-720/` scaled by 2/3:
  every stylesheet length (canvas and `::cue` included) and every JS
  length through `uiPx()` (`__UI_BASE_SCALE__`). Design at 1920x1080 as
  usual; a JS length that skips `uiPx()` comes out 1.5x too large there.
  The `webos-720` E2E project checks it.
- **Config** (`src/config.ts`) — `CONFIG` holds key codes, refresh
  intervals, and player/EPG/storage constants. Prefer it over magic numbers.
- **Bundled service** (`bundled-service/`) — Node.js 0.12.2 CommonJS service
  `com.merope.pleione.service` for LAN setup/uploads and dev-mode reminder
  alerts. See `bundled-service/AGENTS.md`.

## Conventions

- **Build-time constants** `__APP_VERSION__`, `__APP_ID__`, `__SERVICE_ID__`,
  `__PLATFORM__`, `__UI_BASE_SCALE__` are injected via esbuild `define`. Keep them in
  lockstep across `esbuild.config.mjs`, `vitest.config.ts`, and `src/globals.d.ts`.
- **XSS safety.** Channel names, program titles, group titles, and logo URLs
  come from untrusted M3U/XMLTV. Always interpolate them through `html`
  (auto-escapes); wrap only genuinely trusted markup in `raw(...)`. E2E tests
  guard this.
- **TS strictness.** `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns` are on — unused symbols fail `typecheck`/CI.
- **Tests** are colocated as `*.test.ts`. Vitest defaults to `node`;
  DOM tests opt in with `// @vitest-environment jsdom` as the **first line**.
- **Synthetic identifiers only — in tests _and_ `docs/`.** No real channel
  names, brands, domains, URLs, audio-track names, or locale-specific
  language codes, in fixtures, log samples, or doc examples. Use
  `http://host/a`, `ch1`/`ch2`, `Track 1/2/3`, `l1`/`l2` (existing
  Alpha/Bravo/Charlie are fine).
- **Logging** uses `createLogger('Tag')` (`src/utils/logger.ts`), giving
  `[Tag]`-prefixed output. Prefer it over bare `console`.
- **Comments** are sparse — a one-line `//` only for a non-obvious *why*. No
  JSDoc that restates a name. Match the surrounding file's density.
- **American English** in new code, comments, tests, docs, and English UI
  copy (`color`, `behavior`, `canceled`). A technical term keeps its
  standard form: API, protocol, and spec names and existing identifiers
  stay as written.

## webOS platform gotchas

- **No exotic Unicode *symbols* in UI text.** The TV's `LG Smart UI` font
  covers whole scripts (Latin/Cyrillic/Greek/Korean, with `LG_Display` for the
  rest), but uncommon *symbols* (e.g. `↺`) render as a blank box. Use an
  **inline SVG** (`fill: currentColor`), as the EPG replay indicator does.
- **Audio tracks switch via `audioTracks[i].enabled`.** The list holds one
  entry **per distinct `LANGUAGE`** with empty `label`/`language`, so names
  come from parsing the master `EXT-X-MEDIA`. **Don't** call
  `com.webos.media/selectTrack` directly: it decode-errors on a track the
  pipeline didn't demux. See `docs/audio-track-selection.md`
  (`src/utils/audio-tracks.ts`).
- **Subtitles switch via `textTracks[i].mode`** on webOS and
  `hls.subtitleTrack` in the preview. They're **off by default** (unless
  `FORCED=YES`); the choice, including *off*, is remembered per channel.
  On-device the app self-renders in-manifest WebVTT into a Blink `TextTrack`,
  so `::cue` styling applies; CEA-608/708 and TTML/IMSC ride the native
  compositor via Luna `setSubtitleEnable`. See `docs/hls-subtitles.md`; VOD
  subtitles (native, SRT/WebVTT, ASS/SSA) are in `docs/vod-subtitles.md`.
- **Magic Remote OK fires a normal `click`** — the full trusted pointer/mouse
  sequence, with `click.target` the topmost element, even over the native
  video plane ([LG guide](https://webostv.developer.lge.com/develop/guides/magic-remote)).
  Drive pointer activation from a `click` listener local to the component,
  not `mouseup`. Components that self-activate mark their root
  `data-self-activate` so the global click handler in `key-handler.ts`
  doesn't double-fire `select`.

## Samsung Tizen gotchas

The Samsung build (`--platform=tizen`, `src/platform/tizen.ts`) runs on
Tizen 5.5+ (Chromium 69+), above the Chromium 53 gate. Findings per TV are
in `docs/tizen.md`; use the `tizen-device` skill on a TV.

- **Back is Return, 10009** (`key` `XF86Back`, `code` `Escape`): match it
  with `isBackKey()` or `platform.keys.back`, never a literal. **Never
  register Exit or a long press of Return**: Samsung requires the system to
  handle both, and Return on Home must ask before exiting
  (`platform.confirmExitAtHome`).
- **No notification API**: reminders fire in-app only.
- **Privacy consent**: every new way to add a source goes through
  `withPrivacyConsent()` (`src/components/privacy-notice.ts`), which
  asks on Tizen before the first one (Samsung's privacy guide).
- **The native player** reports a live stream's duration as finite and
  growing, so live DVR stays off; a seek to the live edge freezes it. It
  neither renders nor exposes CEA-608 (Shaka does), and `getStartDate()`
  ignores PROGRAM-DATE-TIME.
- **Phone setup runs as the package's web service** (Node 4.4.3 on Tizen
  5.5): `bundled-service/src/tizen.ts` serves the Luna methods over a
  trusted message port, which `src/platform/tizen-lan.ts` calls. Node 4.0–4.4
  inherit `Buffer.from` from `Uint8Array.from`; use `compat.ts`.

## Workflow

- Prefer small, surgical changes that fit the existing architecture over a
  new state container, UI framework, or ad hoc pattern.
- When changing UI behavior, preserve the remote-control and desktop-preview
  experience; keep key handling, focus navigation, and view transitions
  consistent with the `App`/`KeyHandler`/component flow.
- When changing parsers, services, or bundled-service messaging, add or
  update the colocated tests for the touched module.
- **Every bug fix ships with a regression test** — whether the bug came from
  a review, the user, or anywhere else. Add the narrowest test that covers
  it (unit where possible, E2E for UI or focus behavior), and confirm it
  fails without the fix and passes with it.
- **Add `tv.sh diag` events only where a bug report needs them.** Log a
  state the report could not otherwise reveal: a failure or its reason, a
  fallback taken, a detected engine capability, or a decision the code
  made (mode, outcome, count). Don't log routine UI activity (show/hide,
  focus moves, key presses already in the input timeline) or a success
  that later events imply; a fix that leaves no failure state to observe
  needs no event. Log once per occurrence that matters, never per frame
  or per interaction. Use `createLogger` with `event=<area>.<what>` plus
  `key=value` fields (never URLs, credentials, or M3U/XMLTV text), and
  assert each event in a test.
- **Done** means `npm run typecheck`, `npm run lint`, and the relevant tests
  pass. Then run the `feature-review` skill for any finished feature.
- **Git:** commit only when asked, via the `commit` skill, on a
  `pleione-<topic>` branch merged into `pleione` by PR — scoped tests
  first, lines ≤ 72, no trailers.
