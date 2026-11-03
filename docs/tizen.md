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

Every `.wgt` carries two signatures:

- **Author**: who made the app. With the package id (`meropeDevs`) it is
  the app's permanent identity: an update must carry the same author
  certificate, or the TV treats it as a different app. Make it once and
  keep it and its password safe (not in the repository).
- **Distributor**: who may install it where. The image's sample one is
  Tizen's public test distributor, which a Tizen 5.5–6.5 TV in Developer
  Mode accepts. **Tizen 7 and later accept only a Samsung distributor
  certificate**, which lists the DUIDs (device ids) of the TVs it may
  install on. The store re-signs with Samsung's own distributor when it
  publishes, so this one is for development and sideloading.

Samsung issues its certificates only after a sign-in to a Samsung account
in a browser, which the container cannot show, so make them on the computer
once:

1. Note each test TV's **DUID**: `TIZEN_TV=<tv-ip> scripts/tizen.sh duid`
   (it needs only Developer Mode, no installed app).
2. Stop the container (`scripts/tizen.sh down`): the extension below runs
   its own `sdb`, which would clash with the container's on the same port.
3. Install Samsung's **Tizen** extension in VS Code (or Tizen Studio's
   Certificate Manager), and create a **Samsung** certificate for TV:
   - the author certificate: a name, and a password you keep;
   - the distributor certificate: sign in with the Samsung account when
     the browser opens, then enter the DUIDs of every test TV.
4. Copy `author.p12` and `distributor.p12` to `~/.config/pleione/tizen-certs`
   (outside the repository) and register them:

   ```bash
   TIZEN_CERTS=~/.config/pleione/tizen-certs TIZEN_AUTHOR_PASSWORD=... \
     TIZEN_DISTRIBUTOR_PASSWORD=... TIZEN_TV=<tv-ip> scripts/tizen.sh profile samsung
   TIZEN_PROFILE=samsung TIZEN_TV=<tv-ip> scripts/tizen.sh install
   ```

Adding a TV later needs a new distributor certificate with its DUID added;
the author certificate stays.

CI signs the release `.wgt` with the project's author certificate when the
repository has the `TIZEN_AUTHOR_P12` (base64) and `TIZEN_AUTHOR_PASSWORD`
secrets, and with the sample one otherwise. Use the same author certificate
there and on the computer: `base64 -w0 author.p12` gives the secret.

### Testing a new Samsung TV

What to do on a TV that has not been through the checks yet (the second
test TV is one). Bring a computer with Docker and this repository onto the
TV's network.

1. **Developer Mode on the TV**: Apps, then **1 2 3 4 5** (the Smart
   Remote's **123** button gives digits), switch Developer mode on, enter
   this computer's address *on this network* as the Host PC IP, restart.
   Note the TV's IP (Settings › General › Network › Network status).
2. **Media for the checks**, in a terminal of its own: `npm run xtream:demo`.
3. **The checks**: `TIZEN_TV=<tv-ip> scripts/tizen.sh probe 20`. When the
   media checks finish (about a minute), press each remote key once within
   20 seconds: arrows, OK, the four colors, digits, Play/Pause if there is
   one, CH+ and CH−, Info, Guide, Return. It writes
   `tizen-probe-<time>.json`.
   - "The TV refused the signature": the TV needs a Samsung certificate.
     Make one (above, with this TV's DUID from `scripts/tizen.sh duid`),
     register it with `scripts/tizen.sh profile samsung`, and rerun with
     `TIZEN_PROFILE=samsung`.
4. **Pleione itself**: `TIZEN_TV=<tv-ip> scripts/tizen.sh install` (with
   the same `TIZEN_PROFILE`), then by hand: how it looks, how fast keys
   feel, Live and the Guide, a movie's Audio and Subtitles buttons, typing
   in Search with the TV keyboard, Arabic, Return on Home (asks first), the
   Exit key (leaves at once), and phone setup from a phone (pair, add a
   playlist).
5. **Record it**: add the TV as a column in "Test TVs" and the sections
   below, from the probe's JSON.

Two decisions wait on this TV's results:

- **AVPlay** (`avplay` in the probe, and `audioSwitch` under `liveHls`):
  if native audio switching fails here and AVPlay's works, an AVPlay
  backend is worth building for Tizen 8+; if both behave as on Tizen 5.5,
  AVPlay is worth it only for live rewind (plan §5.1, Stage B).
- **Native MPEG-TS** (`liveTs`): it plays on every TV tested so far, so no
  mpegts.js fallback is planned; this check keeps it that way.

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

### AVPlay (`webapis.avplay` 4.0) on the same live HLS

| Check | AVPlay | Native `<video>` |
|---|---|---|
| Plays | Yes | Yes |
| Live window | `GET_LIVE_DURATION` (e.g. 4000–304000 ms) | `seekable`, duration finite |
| Track names | Audio tracks carry their language | Language only, no labels |
| `seekTo` on live | Fails (`PLAYER_ERROR_SEEK_FAILED`) | Freezes at the edge |
| `jumpBackward` 60 s / `jumpForward` to near the edge | Both play on | n/a |
| Audio-track switch | Does not switch (stays on the first) | Switches |

So on Tizen 5.5 AVPlay trades audio-track switching for live rewind. The
plan's Stage B (an AVPlay backend) waits for the same checks on a Tizen 8+
TV, where native audio switching is reported broken: `scripts/tizen.sh
probe` runs them.

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

The bundled service runs there as Pleione's own web service: phone setup
works on 5.5 (`docs/lan-service.md`). Node 4.4.3 inherits `Buffer.from` from
`Uint8Array.from`, which throws on a string with an encoding; `compat.ts`
takes the constructor there.

| LAN service check | 2020 TV |
|---|---|
| Trusted message ports, app and service | Work both ways; the service sees the caller's app id |
| Launch data to a service | Arrives in `getRequestedAppControl()` |
| Writable folders | `/opt/usr/home/owner/apps_rw/<pkg>/data` and `/tmp`; not `$HOME` or the package |
| Cold start, launch to `start` reply | ~210 ms |
| Phone flow (pair, add a playlist, remove it) | The TV applies each within seconds |

## Fonts

- The computed family is the generic `sans-serif`; the Samsung UI font's
  CSS name is still unknown.
- Arabic renders joined and right to left.
- ↺ ★ ✓ ▶ render as text glyphs, but ⏸ renders as a **color emoji**. Keep
  using inline SVG for icons on Samsung too.

## Still open

For the 2020 TV, only the Exit key (15): its remote has none. Alarms (8)
were dropped with plan D5. The second TV needs the whole set: follow
"Testing a new Samsung TV" above.
