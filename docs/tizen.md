# Samsung Tizen: device findings

What real Samsung TVs do, measured for the Tizen port
([`tizen-port-plan.md`](tizen-port-plan.md), §11). Each row is a
measurement on a device, not a reading of the docs. Add a column when
another TV is tested.

## Develop on a Samsung TV

`scripts/tizen.sh` builds, signs, installs, and debugs through a pinned
Tizen CLI container; the `tizen-device` skill has the details.

```bash
TIZEN_TV=<tv-ip> scripts/tizen.sh install      # build, package, install, cold-start
TIZEN_TV=<tv-ip> scripts/tizen.sh debug 9333   # DevTools on http://127.0.0.1:9333/json
npm run xtream:demo                            # in another terminal: the probe's media
TIZEN_TV=<tv-ip> scripts/tizen.sh probe 20     # the device checks; then press keys for 20 s
```

The TV's Developer Mode must name this computer as its Host PC IP (Apps,
then **1 2 3 4 5**).

### Certificates

A Tizen 5.5–6.5 TV installs the image's sample certificate. Tizen 7 and
later need a **Samsung** certificate: an author certificate (the app's
identity, kept forever) and a distributor certificate that lists each TV's
DUID. Samsung issues it only after a sign-in to a Samsung account in a
browser, which the container cannot show, so make it on the computer once:

1. Install the **Tizen** extension in VS Code, connect the TV
   (`TIZEN_TV=<tv-ip> scripts/tizen.sh connect` makes it visible to sdb),
   and open the extension's certificate manager.
2. Create a **Samsung** certificate, TV profile: the author certificate
   (name, password), then the distributor certificate with the connected
   TV's DUID; add the other test TV's DUID too.
3. Copy `author.p12` and `distributor.p12` to `~/.config/pleione/tizen-certs`
   (outside the repository) and register them:

   ```bash
   TIZEN_CERTS=~/.config/pleione/tizen-certs TIZEN_AUTHOR_PASSWORD=... \
     TIZEN_DISTRIBUTOR_PASSWORD=... TIZEN_TV=<tv-ip> scripts/tizen.sh profile samsung
   TIZEN_PROFILE=samsung TIZEN_TV=<tv-ip> scripts/tizen.sh install
   ```

CI signs the release `.wgt` with the project's author certificate when the
repository has the `TIZEN_AUTHOR_P12` (base64) and `TIZEN_AUTHOR_PASSWORD`
secrets, and with the sample one otherwise.

## Test TVs

| | 2020 TV | Current TV |
|---|---|---|
| Model year / series | 2020, T series | not tested yet |
| Tizen / engine | 5.5, Chromium 69 (`69.0.3497.106`) | |
| Firmware | 2743 | |
| `webapis` version | 3.5 | |
| CPU | armv7 | |
| Viewport | 1920×1080, `devicePixelRatio` 1 | |
| Remote | classic remote (color and number keys, no Play/Pause) | |
| Tested | 2026-11-02 | |

## Toolchain

- **CLI image**: `vitalets/tizen-webos-sdk@sha256:5107c8a83fae3128d3b9aa2b499a221f1e0188ebb0fa3ad5be01e9ba2eaf33dc`
  (Tizen CLI 2.5.25, `sdb` 4.2.16; built 2021-07). It works against the
  2020 TV.
- One long-running container with `--network host`, so the TV, whose
  Developer Mode only accepts the host IP, sees the host's address:

  ```bash
  docker run -d --name tizen --network host -v tizen-home:/home/developer \
    -v "$PWD/spike:/app" vitalets/tizen-webos-sdk@sha256:5107c8a8… sleep infinity
  docker exec tizen sdb connect <tv-ip>
  docker exec tizen tizen package -t wgt -s dev -o /home/developer/out -- /app
  docker exec tizen tizen install -s <tv-ip>:26101 -n Spike.wgt -- /home/developer/out
  docker exec tizen tizen run -s <tv-ip>:26101 -p <pkg>.<Name>
  docker exec tizen sdb -s <tv-ip>:26101 shell 0 was_kill <pkg>.<Name>   # cold restart
  ```

  `tizen run` on an app that is already open only brings it to the front;
  `was_kill` first for a cold start.
- **Certificate**: the image's sample Tizen author certificate (`dev`
  profile) installs and runs on Tizen 5.5. No Samsung certificate is
  needed for this TV.
- The probe reported its results over HTTP to a collector on the host.
- **DevTools (checklist 12)**: `sdb -s <tv-ip>:26101 shell 0 debug <pkg>.<Name>`
  launches the app and prints a port; `sdb forward tcp:<local> tcp:<port>`
  exposes it, and `http://127.0.0.1:<local>/json` lists the page. A plain
  WebSocket `Runtime.evaluate` works, so `scripts/tizen.sh eval` can reuse
  the CDP code. `sdb` drops the device now and then; `sdb connect` again
  and redo the forward.

## Playback (native `<video src>`)

Media came from the demo Xtream server (`docs/xtream-demo-server.md`).

| Check | 2020 TV |
|---|---|
| Live HLS (master + 2 audio renditions + WebVTT) | Plays |
| Live HLS `duration` | **Finite and growing** (300 → 308 s), not `Infinity` |
| Live HLS `seekable` / DVR | Sliding window (e.g. 8–308 s); seeking 30 s back works |
| `getStartDate()` with `PROGRAM-DATE-TIME` | **Invalid Date**: the engine ignores PDT |
| Live MPEG-TS over HTTP | Plays; `duration` null, no seekable range |
| MP4 VOD | Plays and seeks |
| MKV | `canPlayType('video/x-matroska')` is `""`; playback not tried |
| `audioTracks`, HLS | One per rendition; `language` set (`l1`/`l2`), `label` empty |
| `audioTracks`, TS and MP4 | One per stream; `language` `und`, `label` empty |
| Audio switch via `enabled` | Works on HLS, TS and MP4: the audio changes and playback continues |
| In-manifest HLS WebVTT | Listed in `textTracks`, but **0 cues** when `showing`: not rendered natively |
| Self-rendered `addTextTrack` + `VTTCue` | Draws over the video |
| MSE / EME | Both present |
| `canPlayType` | HLS, `video/mp2t`, `video/mp4`, `application/dash+xml`: `maybe`; H.264, HEVC, AC-3, E-AC-3: `probably` |

| Native DASH (`<video src="….mpd">`, clear) | Plays |
| CEA-608, native (HLS and DASH) | **Not rendered and not exposed** as a `TextTrack` |
| CEA-608 through Shaka | Parsed (CC1/CC3) and rendered over the video |

### Live seeking (in the app, through the Tizen build)

| Seek on live HLS | Result |
|---|---|
| None (plain play) | Plays. While loading (`readyState` 1) `currentTime` reads 0 under a window that starts later, then jumps to the live edge |
| Back to edge − 60 s | Plays on |
| Back to the window start + 3–10 s | Borderline: plays a few seconds, or freezes |
| Forward to the live edge (Go to Live) | **Freezes for good**, with `readyState` 4 and `paused` false |

A freeze at `readyState` 4 also slips past the stall watchdog, which
treats frozen-but-buffered as a hiccup. So live DVR stays off on Tizen
(the finite duration already keeps `dvrWindow()` from seeing a live
window); timeshift waits for an MSE (Shaka/hls.js) or AVPlay path. With
no live seeks, nothing in the app triggers this freeze.

So the Stage A plan holds on Tizen 5.5: the native path plays HLS, TS and
MP4, the audio picker works, and subtitles take the self-render path as
on webOS. Live-stream detection must not rely on `duration === Infinity`,
and catch-up/EPG alignment cannot use `getStartDate()` here. Live DVR
stays off (above).

## DRM (Shaka 5.2.12 on MSE/EME)

`requestMediaKeySystemAccess` grants `com.widevine.alpha`,
`com.microsoft.playready`, and `org.w3.clearkey`
(`com.microsoft.playready.recommendation` and `.hardware`: not supported).
Shaka's own `isBrowserSupported()` is true.

| Test vector | Result |
|---|---|
| Widevine, a public single-DRM DASH test stream | Decodes and plays |
| Widevine, a public multi-DRM DASH test stream (one key) | Decodes and plays |
| PlayReady, the same multi-DRM test stream | Decodes and plays |

So PlayReady on Tizen can go through Shaka with the
`com.microsoft.playready` key system, in place of webOS's Luna DRM
service. Shaka 5 has no `setTextTrackVisibility`/`isTextTrackVisible`;
selecting a text track shows it.

## Input

Arrows (37–40), OK (13) and Return (10009, `XF86Back`) arrive without
registration. `tizen.tvinputdevice.getSupportedKeys()` lists 46 keys, and
every key the plan maps registered without error:

| Key | keyCode | `key` |
|---|---|---|
| Red / Green / Yellow / Blue | 403 / 404 / 405 / 406 | `XF86Red` / `XF86Green` / `XF86Yellow` / `XF86Blue` |
| Digits | 48–57 | `0`–`9` |
| CH+ / CH− | 427 / 428 | `XF86RaiseChannel` / `XF86LowerChannel` |
| Info | 457 | `XF86Info` |
| Guide | 458 | `XF86ChannelGuide` |
| Return | 10009 | `XF86Back` (`code` `Escape`) |

Listed but not pressed (this remote has no such keys): media keys
(Play 415, Pause 19, PlayPause 10252, Stop 413, Rewind 412,
FastForward 417, Previous 10232, Next 10233), Exit 10182, Caption 10221,
Search 10225, PreviousChannel 10190, Minus 189.

- **Return, short press**: reaches the app as a keydown and does not
  close it.
- **Return, long press**: terminates the app with nothing registered. No
  keydown reaches the page; the next launch is a cold start.
- **Exit key**: not tested (no Exit key on this remote).

## Engine and layout

| Check | 2020 TV |
|---|---|
| RTL `scrollLeft` model | Old Chromium model: starts at the maximum (800) and runs down to 0. `src/utils/direction.ts` handles it |
| `CSS.supports('gap', …)` | `true`, which in Chromium 69 means grid gap only; flex `gap` still needs `engine-quirks.ts` to measure it |
| `:focus-visible` | Not supported (invalid selector) |
| `inert` | Not supported |
| `backdrop-filter` | Not supported |
| `IntersectionObserver`, `ResizeObserver`, `fetch`, `VTTCue` | Present |
| IndexedDB quota (`navigator.storage.estimate`) | About 92 MB |
| `tizen.alarm`, `tizen.tvinputdevice`, `webapis.avplay`, `webapis.appcommon` | Present |

Every unsupported feature already has a fallback for webOS 4, so Tizen
5.5 adds no new legacy work.

## Platform services

| Check | 2020 TV |
|---|---|
| Notification / toast API | **None**: `tizen.notification` is undefined, and no `webapis` module offers one |
| `tizen.alarm` | Present; not used, since reminders are in-app only (plan D5) |
| Web service (`<tizen:service>`) | Starts from the app through `launchAppControl` with the `service` operation |
| Web service Node.js | **v4.4.3** (V8 4.5, OpenSSL 1.0.2), `arm` |
| Web service LAN bind | `listen(8099, '0.0.0.0')` works, and a computer on the LAN gets a reply |

The bundled service already targets Node 0.12 (ES5/CommonJS), which runs
on Node 4, so the LAN setup port (Phase 6) is feasible on 5.5.

## Fonts

- The computed family is the generic `sans-serif`; the Samsung UI font's
  CSS name is still unknown.
- Arabic renders joined and right to left.
- ↺ ★ ✓ ▶ render as text glyphs, but ⏸ renders as a **color emoji**. Keep
  using inline SVG for icons on Samsung too.

## Still open

For this TV, only the Exit key (15): this remote has none. Alarms (8) were
dropped with plan D5. The current TV needs the whole checklist, including
whether it rejects a plain Tizen certificate (16).
