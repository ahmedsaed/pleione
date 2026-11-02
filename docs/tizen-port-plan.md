# Samsung Tizen port — plan

Status: decisions taken 2026-10-30, revised 2026-11-02 (see
[§12](#12-decisions)); next step is Phase 0, the device spike
([§11](#11-device-spike)). Progress is tracked in a GitHub issue, one
checklist per phase; spike results go in `docs/tizen.md`.
Research dates: 2026-10-30, 2026-11-02.

Code references name files and symbols, not line numbers, so they survive
edits; `git grep` the symbol to find the line.

Goal: ship Pleione on Samsung TVs from this repo, as a second build target
next to webOS, without regressing webOS and without forking the UI.

Legend for facts: **[V]** verified against a cited source, **[I]** inferred,
**[U]** unverified — must be checked on a device (see [§11](#11-device-spike-checklist)).

---

## 1. Summary

- ~90% of the app is platform-neutral: views, `morph()`/`html`, focus
  scopes, SpatialNav, parsers, Xtream, catalog, search, EPG, storage,
  i18n, OSD/menu, DVR/catch-up logic, DRM config parsing, VOD/ASS
  subtitles, media probe.
- webOS coupling is concentrated in five places:
  1. **Keys** — `CONFIG.KEYS` and a handful of hard-coded `BACK` checks.
  2. **Lifecycle** — `PalmSystem.launchParams`, `webOSRelaunch`,
     `window.close()`, `cursorStateChange`, `keyboardStateChange`.
  3. **Luna** — `src/services/luna.ts` (bundled service, Activity Manager
     reminders, toasts, PlayReady, native CC compositor). Every caller
     already degrades when `isLunaAvailable()` is false.
  4. **Native playback assumptions** — `isWebOS()` gates in
     `player-pipeline.ts`, `player.ts`, `player-tracks.ts`, plus
     `mediaOption`, `video.mediaId`, and the audio-track-collapse workaround.
  5. **Build/packaging/tooling** — `appinfo.json`, `build.sh`/`ares-*`,
     `tv.sh` (CDP + SSH), Homebrew manifest, CI, docs, site, store.
- Today a Tizen UA would fail `isWebOS()` and fall to the desktop path with
  no hls.js/mpegts loaded → plain `video.src = url`. So a raw build would
  *partly* work by accident; the plan makes that intentional.
- Recommended shape: compile-time `__PLATFORM__` (`'webos' | 'tizen'`), a
  small `src/platform/` adapter, one bundle per platform, `.wgt` packaged
  from `dist-tizen/`.

---

## 2. Platform research (key facts)

### 2.1 Versions and engines [V]
[Samsung web engine specs](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)

| Model year | Tizen | Engine |
|---|---|---|
| 2016 | 2.4 | WebKit (out of scope) |
| 2017 | 3.0 | Chromium 47 |
| 2018 | 4.0 | Chromium 56 |
| 2019 | 5.0 | Chromium 63 |
| 2020 | 5.5 | Chromium 69 |
| 2021 | 6.0 | Chromium 76 |
| 2022 | 6.5 | Chromium 85 |
| 2023 | 7.0 | Chromium 94 |
| 2024 | 8.0 | Chromium 108 |
| 2025 | 9.0 | Chromium 120 |
| 2026 | 10.0 | Chromium 130 |

- Tizen 4+ (and so the 5.5 support floor, D1) is **above** our `chrome53`
  engine floor → current polyfills, legacy CSS, lint gate, and
  `chromium-53-simulation` already cover it.
- Tizen 3 (Chromium 47) is **below** the floor → lowering it affects webOS
  too (esbuild target, browserslist, compat gate, BCD simulation, more
  polyfills).
- 2024+ TVs get OS upgrades (up to 7 years), so detect features, never infer
  them from model year.

### 2.2 Packaging and signing [V]
- `.wgt` (W3C widget zip + `author-signature.xml` + `signature1.xml`),
  manifest `config.xml`. App id `<10-char package>.<Name>`.
- CLI: `tizen package -t wgt -s <profile> -- <dir>`, `tizen install`,
  `tizen run`, `sdb connect <ip>`.
- Tizen Studio is being deprecated in favor of the Tizen VS Code extension;
  the CLI keeps working. Docker images exist for headless packaging
  (`vitalets/docker-tizen-webos-sdk`).
- Certificates: **Samsung** author + distributor certs (Tizen 7+ rejects
  plain Tizen certs). The distributor cert lists allowed TV DUIDs; creating
  it needs an interactive Samsung-account browser login. The author cert
  must stay the same across all updates.
- Dev mode: Apps → type `12345` → Developer Mode ON → host PC IP → reboot.

### 2.3 Distribution [V unless marked]
- **Samsung store** ([TV Seller Office](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html)):
  every new member starts as a **Public Seller**, which can launch only in
  the **US**. Other countries need a **Partner Seller** status, which
  takes an offline contract with Samsung HQ or a local subsidiary and then
  a partnership request in Seller Office. Review needs
  working test credentials. No written IPTV-player policy found [U];
  Samsung has removed IPTV players case-by-case after rights-holder
  complaints (Smart IPTV, 2016).
- **Apps2Samsung** (formerly Jellyfin2Samsung): desktop/Android/CLI
  installer that makes a per-TV Samsung cert after one browser login and
  re-signs any `.wgt`. Users can add a custom `.wgt` URL. This is the
  de facto sideload path (Jellyfin used it before its store launch).
- **TizenBrew**: a launcher that loads "app modules" from npm/GitHub via
  jsDelivr at every launch, under TizenBrew's own id. No own icon/app id.
  Viable as an extra channel, not a primary one.

### 2.4 Playback [V unless marked]
- `<video>` plays HLS (TS + fMP4) natively — Jellyfin disables hls.js on
  Tizen for that reason. MSE + EME (PlayReady, Widevine) supported;
  Shaka officially supports Tizen.
- `audioTracks` switching works on Tizen 5.5–7 and is **broken on Tizen 8+**
  (Jellyfin gates it to `5.5 <= v < 8`).
- Only one `<video>` playing at a time (community report).
- **AVPlay** (`webapis.avplay`): `<object type="application/avplayer">`,
  video on a plane under transparent HTML, `setDisplayRect` in 1920×1080
  space. HLS (v7/v10), DASH, Smooth, TS over HTTP. Tracks via
  `getTotalTrackInfo`/`setSelectTrack` (TEXT not for DASH). Subtitles
  arrive as text via `onsubtitlechange`; external subtitles must be a
  local file. `setDrm` for PlayReady/Widevine. Live DVR window via
  `getStreamingProperty('GET_LIVE_DURATION')`. Known limits: no
  PROGRAM-DATE-TIME through 2020, no LL-HLS/IMSC1, some live HLS never
  prepares.
- hls.js on Tizen works but has open Tizen issues (long-stream
  degradation, discontinuity stalls, crashes on 2023). mpegts.js Tizen
  performance unknown [U]; heavy on 2018 hardware [I].

### 2.5 Input [V]
- Delivered without registration: arrows, Enter (13), Back (10009).
- Must `tizen.tvinputdevice.registerKey(Batch)`: digits 48–57, colors
  403–406, media (Play 415, Pause 19, PlayPause 10252, Stop 413,
  Rew 412, FF 417, Prev 10232, Next 10233), ChannelUp/Down 427/428,
  Info 457, Guide 458, Exit 10182, Caption 10221, Search 10225.
- **The Smart Remote (default on most models) has no color or number keys**
  — a "123" button opens an on-screen pad. Long-press Back = Exit.
- No pointer remote since 2016. USB/BT mice still work.
- IME Done/Cancel keys 65376/65385.
- **Return/Exit policy** ([terminating applications](https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html),
  [FAQ](https://developer.samsung.com/smarttv/develop/faq/user-interaction.html)):
  Return on a detail page goes to the previous page; Return on the app's
  **home page must show an exit confirmation popup** (an HTML element of
  our own), and the app exits only on **Yes**, through
  `tizen.application.getCurrentApplication().exit()`. Long-press Return
  force-terminates the app — never register it. The **Exit** key must
  leave the app immediately, from anywhere: don't register or handle it,
  and never show a popup on it. The FAQ also allows terminating or hiding
  on Return at home; the policy page's popup rule is the stricter one, so
  follow it. This differs from LG, which requires Back on Home to close
  the app in one press.

### 2.6 Platform services [V unless marked]
- **Alarms**: `tizen.alarm.add(AlarmAbsolute, appId, appControl)` can only
  *launch* the app, full screen over whatever is playing. Not used (D5).
- **No notification/toast API on TV** → in-app only.
- **Lifecycle**: JS pauses on hide; `visibilitychange` fires; exit via
  `tizen.application.getCurrentApplication().exit()`; deep links via
  `getRequestedAppControl()` + `appcontrol` event (`reload="disable"`).
- **Screensaver**: `webapis.appcommon.setScreenSaver(OFF|ON)`.
- **Background web services** (`<tizen:service>`) run **Node.js** on TV and
  are usable with an ordinary Samsung cert (TizenBrew ships one running
  express on loopback). Node version per Tizen release [U] (v4.4.3 on
  Tizen 3), LAN bind (`0.0.0.0`) permitted [U], store acceptance [U].
- Storage: localStorage ~5 MB; IndexedDB supported, quota/eviction [U];
  `tizen.filesystem` available.

### 2.7 Fonts
UI font is Samsung One UI Sans; CSS family name exposed to web apps [U].
Custom web fonts (incl. Arabic) supported. Inline-SVG icon rule still applies.

### 2.8 Emulator / automation [V]
TV Extension 10.0 emulator ships for Ubuntu (no DRM, no 4K, needs KVM).
No headless CI emulator. Automation = Playwright with stubbed `tizen`/
`webapis` + manual/scripted `sdb` checks on a real TV.

---

## 3. Codebase coupling inventory

Paths are repo-relative. Counts are non-test lines.

### 3.1 Keys and input
- `src/config.ts` — `KEYS` (BACK 461, CH±=33/34, CURSOR 1536/1537).
- `src/navigation/key-handler.ts` — `ACTION_MAP`,
  `INPUT_PASSTHROUGH_KEYS`, cursor pseudo-keys,
  `cursorStateChange`, wheel → channel.
- Hard-coded BACK/ESC in input listeners: `sidebar.ts`,
  `epg-grid.ts`, `settings.ts`,
  `channel-list-editor.ts`.
- `edge-scroll.ts` (cursor events).
- No `play_pause` toggle action in the `Action` union (`types.ts`).
- Color-key actions (matters for the Smart Remote, which has no color
  keys). Since the plan was first written, the player controls gained a
  Favorite button and the EPG lost its Green "today" key. Still to audit
  for an on-screen path: Green favorite and Yellow edit in the channel
  list (`channel-list.ts`), Green/Yellow in the player (`app.ts`
  `handleKey`), and the Live categories picker
  (`live-category-picker.ts`). Red/Blue (Guide/Settings) and the channel
  editor's key hints are already clickable/focusable.

### 3.2 Lifecycle and shell
- `app.ts` cold launch params (`PalmSystem.launchParams`) and
  `webOSRelaunch`; `utils/platform-exit.ts` `closeApp()` (`window.close()`,
  one press of Back on Home, as LG requires).
- `app.ts` bundled-service start/stop on visibility.
- `keyboardStateChange`: `sidebar.ts`,
  `channel-list-editor.ts`.
- Boots in pointer mode (`input-mode.ts`; `index.html` lacks
  `keyboard-nav`) — wrong default on Samsung.
- `css/main.css` font stack names `'LG Smart UI'`.
- `utils/logger.ts` logs webOS version from UA.
- `appinfo.json` `disableBackHistoryAPI`, `requiredACG`.

### 3.3 Luna and services
| Luna target | Caller | Tizen replacement |
|---|---|---|
| `…pleione.service/start\|stop\|serviceEvents\|getDevMode` | `app.ts` | Tizen web service + message port / localhost (optional, §6.4) |
| `activitymanager/create\|cancel` | `reminder-service.ts` | none: an in-app timer while the app is open (D5) |
| `notification/createToast\|createAlert`, `applicationManager/launch` | AM callback, bundled service | none: no notification API on the TV (`tizen.notification` is undefined on 5.5); in-app prompt only |
| `com.webos.service.drm` (PlayReady) | `playready-drm.ts`, `player-pipeline.ts` | EME via Shaka (`com.microsoft.playready`) or AVPlay `setDrm` |
| `com.webos.media/setSubtitleEnable` | `player-tracks.ts` | native `textTracks`, or AVPlay `setSilentSubtitle`/`setSelectTrack` |

- Storage is plain web standards; `idb-cache.ts` quota branches already
  feature-detect.
- LAN setup/upload (`setup-client.ts`, `upload-client.ts`,
  `bundled-service/`): app side already treats "no service" as
  unreachable; UI shows nothing usable.

### 3.4 Playback (~7,000 lines in scope)
- Path fork: `player-pipeline.ts` (`isWebOS()` → native `<source>`
  with MIME routing + IDB route cache; else hls.js/mpegts/Shaka/`src=`).
- Other `isWebOS()` gates: stall watchdog (`player.ts`), CC row
  (`player-tracks.ts`), live-preview corner radius
  (`player-presentation.ts`) — 9 call sites across 5 files as of
  2026-11-02.
- Strictly Luna/`mediaOption`: ~350 lines. Native-workaround code
  (manifest-parsed track names, HLS/DASH subtitle self-render, MIME
  sniff/cache): ~1,500–1,900 lines, portable and reusable on Tizen native.
- Seams: `MseEngine` (tracks + stream info) and `PlayerPipeline` facade.
  **No transport seam**: `Player`, `PlayerTracks`, subtitle sinks,
  `PlayerPresentation` (live preview) take a raw `HTMLVideoElement`; all
  text subtitles render through Blink `TextTrack`. An AVPlay backend needs
  a media facade + a DOM cue renderer; a `<video>`/MSE backend needs none.
- Bundling: hls.js/mpegts.js are external and only in the preview build
  (`preview-libs.js`); Shaka ships always, lazy-loaded.
- PlayReady on the non-webOS path is dropped (`player-pipeline.ts`;
  Shaka only maps Widevine/ClearKey).

### 3.5 Build, tests, CI, docs (~55–80 files total)
- `esbuild.config.mjs` (version sync, static copies, defines, entries,
  preview libs, notices), `build.sh`, `package.json`, `vitest.config.ts`,
  `src/globals.d.ts`, `index.html`, `.gitignore`, `assets/build-icons.sh`,
  `scripts/sync-version.mjs`, `scripts/third-party-notices.mjs`.
- E2E: two projects; webOS faked per spec (UA spoof, `FakePalmServiceBridge`);
  ~20 specs dispatch literal `461`.
- CI: `.github/workflows/build.yml` (ares-package, IPK artifact, release).
- Tooling: `scripts/tv.sh` + `tv-*.mjs` + `cdp-client.mjs` (ares/SSH/CDP 9998).
- Docs: `AGENTS.md`, skills (`webos-device`, `legacy-engine`, `ui-design`,
  `feature-review`, `ui-copy`), `README*`, ~7 `docs/*.md`, `store/`, `site/`.

---

## 4. Target architecture

### 4.1 Build-time platform
- New define `__PLATFORM__: 'webos' | 'tizen'`, kept in lockstep in
  `esbuild.config.mjs`, `vitest.config.ts`, `src/globals.d.ts` (AGENTS.md
  rule). esbuild dead-code-eliminates the other platform.
- `node esbuild.config.mjs --platform=tizen` → `dist-tizen/`; default stays
  `webos` → `dist/`. `--preview` stays a separate axis (desktop).
- Per-platform static files: webOS copies `appinfo.json`, `resources/`,
  `icon.png`/`largeIcon.png`; Tizen generates `config.xml` from
  `platform/tizen/config.xml.tmpl` (version from `package.json`, localized
  names from the same source as `resources/`) and copies Tizen icons.
- Tizen `index.html` gets `<script src="$WEBAPIS/webapis/webapis.js">`
  (only if AVPlay/productinfo/appcommon are used) via the existing marker
  mechanism.
- `__APP_ID__` becomes per-platform (Tizen: `<pkg>.Pleione`).

### 4.2 `src/platform/` adapter
```
src/platform/
  index.ts          // export const platform: Platform (picked by __PLATFORM__)
  types.ts          // Platform interface
  webos/            // wraps today's code: luna, PalmSystem, keys
  tizen/            // tizen.*, webapis.*
  desktop.ts        // preview: no-ops (or folded into webos with guards)
```
Interface (first cut):
- `keys`: the keymap (replaces `CONFIG.KEYS` platform parts) +
  `registerKeys()` at boot.
- `exit()`, `launchParams(): unknown`, `onRelaunch(cb)`.
- `confirmExitAtHome: boolean` (webOS false: Back on Home closes at once;
  Tizen true: exit confirmation first, §6.2).
- `onVirtualKeyboard(cb)` (webOS `keyboardStateChange`; Tizen: focus +
  `resize` heuristic).
- `pointerDefault: boolean` (webOS true, Tizen false → boot in
  `keyboard-nav`).
- `scheduleReminder(id, at, payload) / cancelReminder(id)` +
  `deliversClosedAppAlerts` (webOS true; Tizen false: no scheduling, the
  in-app timer covers it).
- `setScreenSaver(enabled)` (Tizen real; webOS no-op for now).
- `playback`: capability record consumed by the pipeline (see §5).
- `lanService?`: start/stop/events, absent when unsupported.
- `describeEnvironment()` for `logEnvironment`.

`isWebOS()` call sites become `platform.playback.*` capability checks.
`luna.ts` stays, imported only from `platform/webos/` and webOS-only
services.

---

## 5. Playback plan

### 5.1 Recommended: staged
**Stage A — native `<video>` + Shaka (ship this first).**
- Tizen gets the *native* branch of `player-pipeline.ts` (same as webOS)
  minus Luna bits: `<source>` + MIME routing, manifest-parsed names,
  HLS/DASH WebVTT self-render, IDB route cache, stall watchdog on.
- HLS → native. Raw MPEG-TS over HTTP → native `video/mp2t` if the
  device plays it [U]; else mpegts.js fallback (ship it in the Tizen
  bundle as a lazy chunk like Shaka).
- DASH clear/Widevine/ClearKey → Shaka (already). PlayReady → Shaka with a
  new `com.microsoft.playready` mapping (server URL + custom data headers)
  instead of the Luna `PlayReadyDrm`.
- Captions: no Luna compositor, and the native element neither renders
  nor exposes in-band CEA-608 (spike, HLS and DASH) → CC row hidden on the
  native path. Shaka parses and renders 608 itself, so a stream whose
  captions matter can go through Shaka.
- Audio switching via `audioTracks[i].enabled` on Tizen 5.5–7; on 8+
  hide the picker for multi-audio native streams (or route those to
  Shaka/hls.js) until Stage B.
- Capability record:
  `{ native: true, nativeDashMediaOption: false, nativeCcCompositor: false,
     playReady: 'eme', audioTrackSwitch: <by version>, stallWatchdog: true }`.

**Stage B — AVPlay engine (only if Stage A falls short on device).**
Triggers: Tizen 8+ multi-audio, TS streams the native element refuses,
4K/HDR or performance gaps, and **live DVR**: native seeks to the live edge
freeze on Tizen 5.5 (spike, `docs/tizen.md`), so timeshift is off on the
native path.
- Introduce a `MediaBackend` facade over the ~40 element operations
  `Player` uses (load/play/pause/seek, time/duration/seekable,
  readyState/networkState, events, volume, error, display rect).
  `HtmlVideoBackend` wraps today's element; `AvplayBackend` implements it.
- AVPlay tracks via an `MseEngine`-style adapter (`getTotalTrackInfo`).
- Subtitles: a DOM cue renderer fed by `onsubtitlechange`; sidecar
  SRT/VTT parsed in JS and rendered by the same renderer (avoids local-file
  requirement); assjs needs a clock shim.
- Live preview: `PlayerPresentation` → `setDisplayRect`.
- Biggest single work item; estimate 1.5–3 weeks.

### 5.2 Alternative: MSE-first (hls.js + mpegts.js + Shaka everywhere)
Fastest to stand up (desktop path already works), but known hls.js Tizen
bugs, JS transmux cost on 2018–2019 hardware, and it bypasses the
hardware pipeline the webOS build deliberately uses. Keep as fallback only.

---

## 6. Feature-by-feature

### 6.1 Remote keys
- Tizen keymap: BACK 10009, CH± 427/428, PLAYPAUSE 10252 → new
  `play_pause` action, INFO 457 → OSD, GUIDE 458 → Guide, plus standard
  colors/media/digits. **Never register EXIT 10182 or long-press Return**:
  the system must handle both (§2.5).
- `registerKeyBatch` at boot for every non-default key we map; tolerate
  missing keys (`getSupportedKeys`).
- Replace hard-coded `CONFIG.KEYS.BACK` checks in input listeners with a
  helper `isBackKey(e)`; add IME Done/Cancel.
- Drop cursor pseudo-keys on Tizen (map absent).
- **Smart Remote gap**: give every remaining color-key action an
  on-screen path (audit list in §3.1). Benefits LG remotes without a
  pointer too, so it can land on webOS first.

### 6.2 Lifecycle
- Exit → `tizen.application.getCurrentApplication().exit()`.
- Launch/relaunch params → `getRequestedAppControl().appControl.data`
  (`PAYLOAD`) + `appcontrol` event; `config.xml` app-control with
  `reload="disable"`.
- Back at Home differs per build (decision D6): webOS keeps today's
  one-press close (`closeApp()`, LG's requirement); Tizen shows an exit
  confirmation through `ConfirmationPrompt` (pushed on the `Focus` owner
  stack like any prompt), and **Yes** calls `platform.exit()`. Back closes
  the prompt. The copy goes through the `ui-copy` skill. Behind
  `platform.confirmExitAtHome: boolean`.
- Screensaver off while video plays, on when paused/stopped
  (`webapis.appcommon`). Also a small UX win; webOS no-op.
- On resume: re-check network, restart live stream (JS was paused).

### 6.3 Reminders
- **In-app only** (D5). Reminders fire while Pleione is open: the same
  `ReminderPrompt` with **Watch now**, driven by a timer, as webOS does
  in-app today. Nothing is scheduled with the system.
- Why not `tizen.alarm`: the TV has no notification or toast API, so an
  alarm can only launch Pleione full screen over whatever the user is
  watching. On webOS a closed-app reminder is a passive toast and the user
  decides; a launch takes the decision away.
- A reminder whose air time passed while the app was closed raises
  nothing; it is pruned once its program ends, as `ReminderService.prune`
  does today.
- The places that set a reminder say, on Tizen only, that reminders appear
  while Pleione is open (copy through the `ui-copy` skill).

### 6.4 LAN phone setup / M3U upload
- Option 1 (recommended later phase): port `bundled-service/` as a Tizen
  web service (`<tizen:service>`). Its Node 0.12/ES5 constraint already
  satisfies Node 4. Replace `webos-service` with a thin host shim; app↔
  service doorbell via `tizen.messageport` or polling loopback HTTP.
  Blockers to verify first: LAN bind allowed, service start/stop from the
  app, Node version per release.
- Option 2: ship Tizen without LAN setup (Settings hides the phone-setup
  card when `platform.lanService` is absent); users type URLs/credentials
  with the remote.
- Option 3: cloud relay — new infra and changes the privacy promise
  (`site/content/privacy.md`); not recommended.

### 6.5 DRM
- Widevine/ClearKey: Shaka/EME, unchanged.
- PlayReady: add Shaka `com.microsoft.playready` config (license URL,
  custom data → `X-...` header or challenge customization). Store DRM may
  need partner level [U].

### 6.6 Storage
No change. Verify IndexedDB quota branch chosen on device; consider the
`unlimitedstorage` privilege.

### 6.7 Fonts / RTL
Add the Samsung family name to `css/main.css` font stack once confirmed on
device; Arabic shaping via Chromium [I] — verify with the `ar` locale.

---

## 7. Packaging, signing, distribution

- `platform/tizen/config.xml.tmpl`:
  `tizen:application id="<pkg>.Pleione" package="<pkg>" required_version="4.0"`,
  `tizen:profile name="tv-samsung"`, `content src="index.html"`,
  `access origin="*" subdomains="true"`, privileges
  (`internet`, `tv.inputdevice`, `application.launch`,
  `network.public`, `productinfo`, `unlimitedstorage`, `tv.window`
  if AVPlay, `drmplay` if PlayReady/AVPlay DRM),
  `tizen:setting screen-orientation="landscape" context-menu="disable"
  background-support="disable" encryption="disable"
  install-location="auto" hwkey-event="enable"`, app-control for deep
  links, localized `<name xml:lang>`.
- `<pkg>`: generate a random 10-char id **once** and never change it (with
  the author cert, it is the app's permanent identity).
- `build-tizen.sh` (or `build.sh --tizen`): lint → build `--platform=tizen`
  → `tizen package -t wgt -s <profile>` → `--install [ip]` does
  `sdb connect`, `tizen install`, cold restart, `tizen run`.
- Icons: add Tizen sizes to `assets/build-icons.sh` (exact Samsung
  requirements [U]).
- `scripts/config-privileges.test.mjs`: analogue of `appinfo-acg.test.mjs`
  — every `tizen.*`/`webapis.*` namespace used has its privilege.
- CI: a `tizen` job using a pinned Tizen CLI Docker image; produce an
  author-signed `.wgt` artifact from secrets (author `.p12` + Samsung
  distributor cert/password); skip signing on fork PRs; attach `.wgt` to
  releases. Note: a CI-signed `.wgt` only installs on DUIDs in that
  distributor cert — public users re-sign with Apps2Samsung.
- Distribution (decision D3): GitHub release `.wgt` + Apps2Samsung
  instructions first, then the Samsung store (Phase 8); optional
  TizenBrew module.

### 7.1 Samsung store (Phase 8)
- **Seller Office account** as a Public Seller under Merope: US launch
  only. Request Partner Seller status (offline contract) to reach other
  countries; until then, other countries keep the GitHub/Apps2Samsung
  path.
- **Store build signing**: a store submission is signed with the author
  certificate only; Samsung re-signs it with its distributor certificate
  on release [U — confirm in the publication guide]. Keep the author
  `.p12` and the 10-char package id fixed forever.
- **Certification items** to pass before submitting: the Return/Exit
  policy (§2.5), every action reachable on the Smart Remote (Phase 4),
  no crash or blank screen without a source (Home's welcome cards
  already cover it), resume after the app was hidden, and screensaver
  handling during playback.
- **Reviewer credentials**: review needs a working account. Host the
  synthetic demo Xtream server (`docs/xtream-demo-server.md`) on a
  reachable address for the review window, so no real content or
  provider is involved; the same approach serves the LG submission.
- **Listing materials** under `store/samsung/` beside the LG ones
  (`store/`): descriptions reuse `store/listing.md`, screenshots come
  from the same capture script at Samsung's required sizes [U],
  privacy/terms/support URLs are the existing site pages.
- **Policy risk**: no written Samsung IPTV-player policy was found [U];
  Samsung has removed IPTV players after rights-holder complaints. The
  listing must say, as the LG one does, that Pleione ships no content.

---

## 8. Testing

- **Unit**: `src/platform/tizen/*.test.ts` with stubbed `tizen`/`webapis`
  (keymap, registerKeys, exit, launch params, in-app reminders,
  screensaver).
  `player-pipeline-tizen.test.ts` beside `player-pipeline-webos.test.ts`.
  Vitest runs both platforms (define per test file via `vi.stubGlobal` or a
  second Vitest project with `__PLATFORM__='tizen'`).
- **E2E**: a third Playwright project `tizen-sim`: preview build with
  `--platform=tizen`, init script installing fake `tizen` (tvinputdevice,
  application) and `webapis` (appcommon, productinfo), UA with
  `Tizen`. Run a focused subset (startup, key nav/Back, player, reminders,
  settings without LAN). Replace literal `461` in specs with a
  `KEY.BACK` helper so specs run on both.
- Ring audit (two rings = fail) applies unchanged.
- No engine floor change: the Tizen 5.5 floor (Chromium 69) is above 53.
- **Device**: scripted smoke over `sdb` (install, run, CDP logs/eval through
  `sdb forward` + existing `cdp-client.mjs`), plus a manual checklist per
  release on the Tizen 5.5 TV and the current (Tizen 8+) TV.

---

## 9. Tooling, docs, site

- `scripts/tizen.sh`: `connect`, `install`, `run`, `restart`, `logs`,
  `eval` (reuse `cdp-client.mjs` with a CDP URL from
  `sdb shell 0 debug <appId>` + `sdb forward`). No SSH/`/dev/input`/Luna
  probes on retail Tizen; `diag` gets a reduced Tizen variant later.
- New skill `.agents/skills/tizen-device/` (mirror of `webos-device`).
- `AGENTS.md`: platform section, `__PLATFORM__` rule, Tizen gotchas
  (Back 10009, registerKey, Smart Remote has no color keys, no toasts,
  JS paused on hide, audioTracks broken on 8+).
- `legacy-engine` skill: Tizen version→Chromium table; floor statement.
- `docs/tizen.md` (playback paths, keys, lifecycle, reminders, LAN),
  short Tizen notes in `audio-track-selection.md`, `hls-subtitles.md`,
  `mpeg-dash.md`, `storage-and-data.md`, `lan-service.md`.
- `README.md`: supported platforms, Samsung install via Apps2Samsung
  (and the store once listed).
- `site/`: setup page for Samsung, home copy "LG and Samsung TVs",
  terms trademark line; `store/samsung/` for the store listing (§7.1).

---

## 10. Phases

Estimates are rough working days for one developer with AI help and a TV
on the desk.

| # | Phase | Output | Exit criteria | Est. |
|---|---|---|---|---|
| 0 | Device spike | Docker toolchain, hello-world `.wgt` on both TVs, answers to §11 | Checklist filled in `docs/tizen.md` | 1–2 |
| 1 | Platform layer (webOS only) | `__PLATFORM__`, `src/platform/`, call sites moved | All webOS unit + E2E green, no behavior change | 2–3 |
| 2 | Tizen shell | `--platform=tizen` build, `config.xml`, keys, exit confirmation at Home, launch params, keyboard-nav default, `.wgt` packaging, `tizen.sh` | App boots, navigates, exits per Samsung's Return/Exit policy on TV | 2–3 |
| 3 | Playback Stage A | Native path on Tizen, mpegts fallback, Shaka PlayReady, capability gates, screensaver | Live HLS/TS, VOD, catch-up, DASH play on TV; tracks where supported | 3–5 |
| 4 | Smart Remote + reminders | On-screen paths for color-only actions, in-app reminders on Tizen | Every action reachable without color keys; a reminder prompts while the app is open | 2–3 |
| 5 | Tests, CI, docs | `tizen-sim` project, unit tests, CI `.wgt` job, docs/skills/README/site | CI green on both platforms | 2–3 |
| 6 | LAN service | Tizen web service port (Node 4.4.3 on 5.5, LAN bind confirmed) | Phone setup + upload work on TV | 3–5 |
| 7 | AVPlay (conditional) | `MediaBackend` + `AvplayBackend` | Gaps from Stage A closed | 8–15 |
| 8 | Samsung store | Seller Office account, `store/samsung/`, hosted demo reviewer account, submission | App passes certification and is live in the US; partnership requested for other countries | 3–5 + review time |

Phases 1 and 4's Smart Remote work can land on webOS before any Tizen
code ships.

---

## 11. Device spike

### 11.1 Toolchain (Docker)

The Tizen CLI (`tizen`, `sdb`) runs from a pinned Docker image, so nothing
from Tizen Studio is installed on the host.

- **Image**: start from `vitalets/tizen-webos-sdk` (Tizen Studio 5.5 CLI,
  also carries the webOS CLI). Pin it by digest, not `latest`. If its
  Tizen Studio proves too old for the 2026 TV, build our own image from
  the Tizen Studio 6.x CLI installer in `platform/tizen/Dockerfile`.
- **Networking**: run with `--network host` on Linux. The TV's Developer
  Mode only accepts the host IP entered on the TV, and `sdb connect`
  starts a background daemon that must outlive single commands, so keep
  one long-running container (`docker run -d … sleep infinity`) and
  `docker exec` into it.
- **State**: mount a named volume at the container's home for the
  `sdb` keys and security profiles, and the repo's `dist-tizen/`
  read-only for packaging.
- **Certificates**: the image's sample certificate is enough for the
  hello-world on the 2020 TV if Tizen 5.5 accepts a plain Tizen
  certificate [U]. Tizen 7+ needs a **Samsung** author + distributor
  certificate, whose creation needs an interactive Samsung-account login
  that the container cannot do. Create it once on the host (Tizen VS Code
  extension's certificate manager, or Apps2Samsung), list **both** TVs'
  DUIDs in the distributor certificate, store the `.p12` files outside
  the repo, mount them, and register a profile inside the container with
  `tizen security-profiles add`.
- **Wrapper**: `scripts/tizen.sh` drives the container (`up`, `connect`,
  `package`, `install`, `run`, `restart`, `logs`, `eval`), the way
  `scripts/tv.sh` drives a webOS TV. CDP comes from
  `sdb shell 0 debug <appId>` plus `sdb forward`, reusing
  `scripts/cdp-client.mjs`.

### 11.2 Checklist

Run on both test TVs (Tizen 5.5 and the current model):
1. `canPlayType('application/vnd.apple.mpegurl')` and `('video/mp2t')`;
   does `<video src>` play live HLS, raw TS over HTTP, MKV/MP4 VOD?
2. `audioTracks` count/labels/switching on a multi-audio HLS stream.
3. In-band CEA-608 exposed as a `TextTrack`?
4. Self-rendered WebVTT (`addTextTrack` + `VTTCue`) draws over native video?
5. Seeking within a live DVR window via `currentTime`/`seekable`.
6. `getStartDate()` on HLS with PROGRAM-DATE-TIME.
7. Shaka PlayReady + Widevine with a test stream.
8. ~~`tizen.alarm` with app closed, in standby, after reboot.~~ Dropped
   with D5: reminders are in-app only.
9. Web service: Node version, can it bind `0.0.0.0`, reachable from a phone.
10. IndexedDB quota (`navigator.storage.estimate` / webkit quota).
11. Font family name; Arabic rendering; symbol glyph coverage.
12. `sdb` + CDP debugging flow for `tizen.sh`.
13. Key codes actually delivered by the Smart Remote and a classic remote.
14. Right-to-left: which `scrollLeft` model the engine uses
    (`src/utils/direction.ts` detects both) and Arabic shaping in the
    Samsung UI font.
15. Return on the home page and the Exit key behave as §2.5 describes
    with nothing registered; long-press Return terminates the app.
16. Which certificate each TV accepts for a Developer Mode install.

---

## 12. Decisions

Decided 2026-10-30:
- **D1 — Oldest supported Tizen: 5.5** (2020, Chromium 69), the oldest
  test TV. *Revised 2026-11-02 from 4.0*: nothing older can be tested.
  Tizen 4.0–5.0 (Chromium 56/63) stay above the Chromium 53 gate and may
  work, but are not claimed as supported. No change to the engine floor.
- **D2 — Playback:** native `<video>` + Shaka first (Stage A); AVPlay only
  if the spike or Stage A shows gaps (Stage B).
- **D3 — Distribution:** GitHub release `.wgt` + Apps2Samsung guide
  first, then the **Samsung store** (Phase 8, §7.1): US as a Public
  Seller, other countries after a partnership. Optional TizenBrew module.
  *Revised 2026-11-02*: the store is in scope.
- **D4 — LAN phone setup:** the bundled service runs as a Tizen web
  service over trusted message ports (Phase 6, done; `docs/lan-service.md`).
- **D5 — Reminders: in-app only on Tizen.** *Revised 2026-11-02* from
  launching the app with `tizen.alarm`: with no notification API on the
  TV, a launch would take over the screen. See §6.3.
- **D6 — Back at Home, per build:** webOS closes in one press (LG
  requires it; today's `closeApp()`); Tizen shows an exit confirmation and
  exits on Yes (Samsung's Return policy, §2.5). The Exit key is never
  handled. *Revised 2026-11-02* from "press Back again to exit", which
  matches neither store.
- **D7 — Test hardware:** two TVs — a 2020 model (`T` model code →
  Tizen 5.5, Chromium 69; software version 2743) and a current supported
  model (OS version to confirm). Neither runs Tizen 4,
  which is why D1 sets the floor at 5.5.
  The 2020 TV is on the working side of the `audioTracks` cutoff
  (5.5 <= v < 8); the new TV likely tests the broken side if it runs 8+.
