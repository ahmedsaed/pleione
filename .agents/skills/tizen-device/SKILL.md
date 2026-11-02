---
name: tizen-device
description: Build, install, debug, and probe the Samsung Tizen build on a real TV through the Docker Tizen CLI — packaging, signing profiles, cold restart, DevTools over sdb, and the device checks. Use when deploying to a Samsung TV or investigating behavior that only reproduces on one.
---

# Samsung Tizen device

Everything runs through `scripts/tizen.sh`, which drives a pinned Tizen CLI
container (`pleione-tizen`, host networking). Nothing from Tizen Studio is
installed on the host. Background and device findings: `docs/tizen.md`; the
port's plan: `docs/tizen-port-plan.md`.

## The TV

Developer Mode: Apps, then type **1 2 3 4 5** (the Smart Remote's **123**
button gives digits), switch Developer mode on, enter this computer's LAN
address as the **Host PC IP**, and restart the TV. The TV accepts `sdb`
only from that address, so a new network means a new Host PC IP.

## Build and install

```bash
TIZEN_TV=<tv-ip> scripts/tizen.sh install     # lint, build, package, install, cold-start
TIZEN_TV=<tv-ip> scripts/tizen.sh restart     # cold-start the installed app
TIZEN_TV=<tv-ip> scripts/tizen.sh uninstall   # remove it
```

**Install needs a cold restart**, as on webOS: `tizen run` only brings an
open app to the front. `install` and `restart` kill it first.

## Signing

The image's sample certificate (profile `dev`) installs on Tizen 5.5–6.5.
Tizen 7 and later refuse it: `install` then says the TV refused the
signature. Make a Samsung certificate once (`docs/tizen.md`, Certificates;
`scripts/tizen.sh duid` gives the DUID it needs), then:

```bash
TIZEN_CERTS=~/.config/pleione/tizen-certs TIZEN_AUTHOR_PASSWORD=... \
  TIZEN_DISTRIBUTOR_PASSWORD=... TIZEN_TV=<tv-ip> scripts/tizen.sh profile samsung
TIZEN_PROFILE=samsung TIZEN_TV=<tv-ip> scripts/tizen.sh install
```

`tizen security-profiles add` cannot store passwords in a container
(no desktop keyring); `profile` works around it. Keep the author
certificate forever: with the package id it is the app's identity.

## Debug

```bash
TIZEN_TV=<tv-ip> scripts/tizen.sh debug [port]   # cold-start in debug mode; DevTools on 127.0.0.1:<port>/json
```

`sdb` drops the TV after an install or a debug launch; every command
reconnects first. Screenshots over DevTools (`Page.captureScreenshot`)
hang on Tizen 5.5: read the DOM instead, or ask for a photo. Profile with
the CDP `Profiler` and `Tracing` domains; a minified bundle keeps class
method names, and `minify: false` in `esbuild.config.mjs` (never
committed) gives the rest.

## Device checks

```bash
npm run xtream:demo                                   # the media the checks play
TIZEN_TV=<tv-ip> scripts/tizen.sh probe [key-seconds]  # writes tizen-probe-<time>.json
```

`probe` installs a separate app (`meropeProb.Probe`, from
`scripts/tizen-probe/`) that reports the engine, APIs, DRM key systems,
the web service's Node version, native HLS/TS/MP4 playback, audio-track
switching, live seeking, the RTL scroll model, and the storage quota;
`key-seconds` then records remote keys. Record what a new TV shows in
`docs/tizen.md`.
