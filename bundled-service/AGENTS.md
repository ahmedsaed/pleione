# bundled-service — AGENTS.md

Scoped to `bundled-service/`; the root `AGENTS.md` still applies.

A sandbox-separate Node (CommonJS) webOS service,
`com.merope.pleione.service`. It hosts LAN phone setup and M3U uploads and,
in Developer Mode, interactive program-reminder alerts. `src/index.ts` wires
`lan/`, `setup/`, and `reminder/`.

On Samsung Tizen the same build is the package's web service
(`<pkg>.PleioneLan`), entered through `src/tizen.ts`: it serves the LAN
feature's Luna methods over a trusted message port instead of Luna, and
stores uploads in the app's private data folder. The caller names itself in
a `from` field, since Tizen 9 drops messages that carry a reply port, and
replies go to that app's trusted port. So any app signed with the same
certificate can *send* a command as Pleione (it never sees the reply):
a method that acts without needing its reply is open to every app under
that certificate, the Tizen probe included. Its runtime is Node 4.4.3
on Tizen 5.5, which the smoke matrix covers.

**Read `docs/lan-service.md` before changing it.**

## Runtime: Node.js 0.12.2

It must run on webOS 4's Node.js 0.12.2:

- compile to ES5/CommonJS;
- route newer Node APIs through `compat.ts`;
- the final JavaScript build is gated, like the app bundle.

## Contract with the app

- **Luna:** `start` / `stop` / `heartbeat` / `serviceEvents` for LAN
  changes; `getDevMode` / `fireReminderAlert` for reminders.
- **HTTP:** phone setup pages and uploads. App-only routes need a
  loopback caller with the per-bind app key from the Luna `start` reply;
  loopback alone is not trusted, since the TV's browser is loopback too.
  Reading, listing, or deleting an upload needs the pairing token or the
  app key, and only keyed app responses get CORS. See
  `docs/lan-service.md`.
- Changes are pushed through `serviceEvents`; nothing polls.
- The lifecycle follows the app's `visibilitychange`.

Keep both sides aligned with `src/services/setup-client.ts` and
`src/services/upload-client.ts` in the app, and update their colocated tests
with any messaging change.

## Reminder alerts

`com.webos.notification/createAlert` (with buttons) is denied to every
identity the app or service can present; the block is identity-based in the
notification daemon, not an `appinfo.json`/ACG gap. Passive `createToast`
works. Only `/usr/bin/luna-send-pub` (Luna role `type:"devmode"`) may raise
`createAlert`, and only while Developer Mode is on, so the service execs it
through `child_process` for the dev-mode alert; retail falls back to a toast
plus an in-app prompt.

Reminders are scheduled through the Activity Manager
(`com.webos.service.activitymanager` `create` with a `callback` and
`schedule.start`, `local: true`), which fires at air time **even with the
app closed**. The dev callback targets the service's `fireReminderAlert`;
the retail callback targets `createToast`.

## Verify

```bash
npm run service:smoke          # build + gate + real Node.js 0.12.2 smoke
npm run service:smoke:matrix   # webOS 4-26 representative runtimes
```

`service:smoke` downloads the official Node.js 0.12.2 archive, verifies its
published SHA-256, caches it under the user cache directory, then parses and
exercises the compiled service with that exact runtime. CI runs the matrix
across Node.js 0.12.2, 8.12.0, 12.21.0, 16.19.1, and 20.12.2 (webOS 4
through 26), and 4.4.3 (Samsung Tizen 5.5). On Apple Silicon, Node 16/20
run as arm64 and older releases as x64 through Rosetta.
