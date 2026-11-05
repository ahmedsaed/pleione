# Samsung TV Seller Office listing

What Samsung's [TV Seller Office](https://seller.samsungapps.com/tv) asks for when the app is
registered, kept beside the LG listing (`store/`) so both change in the same pull request as the
app. The fields and limits are from Samsung's
[Entering application information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)
guide; Seller Office's own form is the authority when they differ.

| What | Where |
|---|---|
| Title, description, tags, category, service, feature and verification answers | [`listing.md`](listing.md) |
| The UI description the testers follow (Samsung's PPTX template) | [`ui-description.pptx`](ui-description.pptx), built from [`ui-description.md`](ui-description.md) |
| Icons, background image and 4 screenshots | this folder, written by `npm run store:samsung` |

## Images

| Seller Office field | File | Size | Format, limit |
|---|---|---|---|
| Icon 1920 × 1080: logo | `icon-logo-1920x1080.png` | 1920 × 1080 | 32-bit PNG with transparency, ≤ 300 KB |
| Icon 1920 × 1080: background | `icon-background-1920x1080.jpg` | 1920 × 1080 | JPG, ≤ 300 KB |
| Icon 512 × 423 | `icon-512x423.png` | 512 × 423 | PNG, ≤ 300 KB |
| Background image | `background-1920x1080.jpg` | 1920 × 1080 | JPG, ≤ 2 MB |
| Screenshots 1–4, in order | `screenshot-1.jpg` … `screenshot-4.jpg` | 1920 × 1080 | JPG, ≤ 500 KB each |

Upload the logo and the background separately: Seller Office composes them into its 16:9 and
1:1 icons, and crops the 1:1 one from the center, which is where the mark sits. Seller Office
darkens the left 40% of the background image under its own text, so the mark there sits in the
right 60%.

Samsung takes exactly four screenshots, and some TV models skip the third, so the order
(`SAMSUNG_SHOTS` in `scripts/generate-samsung-store.mjs`) is Home, Guide, Movies, Player:
Movies is the one the listing can best spare. They are the same captures as the LG listing's
(`store/screenshots/`), re-encoded as JPG.

## Regenerating

1. Refresh the captures, if the app changed: `npm run xtream:demo` in one terminal, then
   `npm run screenshots:store` (see `store/README.md`) and `npm run screenshots:store -- --samsung`
   for `captures/`.
2. `npm run store:samsung` draws the icons and background from `assets/icon.svg` and encodes
   the screenshots, lowering the JPG quality only as far as a file's limit needs. It fails if a
   file cannot fit its limit.

The files are generated, never edited by hand.

## What is left for a human

1. **Seller Office account.** Register as an **Individual** seller at
   [seller.samsungapps.com/tv](https://seller.samsungapps.com/tv), under the name Merope, with
   the support email from `site/content/privacy.md`; an individual needs no registration number. A Public Seller can launch only in the US; request Partner Seller
   status (an offline contract with Samsung) to reach other countries
   (`docs/tizen-port-plan.md`, §7.1).
2. **The package.** Upload `Pleione_<version>_tizen_store.wgt` from the GitHub release, signed
   with the author certificate (`docs/tizen.md`, "Certificates"). It is the store package: the
   same app without the LAN web service, since Seller Office takes a `<tizen:service>` only from
   Partner sellers, so it has no phone setup. The `_tizen.wgt` beside it, with the service, is
   for sideloading. Its package id `PleioneMrp` and that
   certificate are the app's identity for good: a different id is a different app, and a
   different author certificate cannot update this one.
3. **The UI description.** [`ui-description.pptx`](ui-description.pptx) is Samsung's
   [Application UI description](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/application-ui-description.html)
   template filled in from [`ui-description.md`](ui-description.md), with a labeled screenshot
   of each screen (the Player, Settings, Data Management and privacy notice captures come from
   `captures/`, written by `node scripts/generate-store-screenshots.mjs --samsung`). Before
   uploading it, replace the three test-account placeholders on the "Use Cases – Test Account" slide, **[Server URL]**,
   **[Username]** and **[Password]**, with the account from step 4, and never commit the filled-in
   copy. Update it, and upload it again, with every app update.
4. **The testers' accounts.** Host the demo Xtream server on an address Samsung's testers can
   reach, as for LG (`store/README.md`, "The reviewers' test account"), and enter its URL,
   username and password in Seller Office's test account fields. Never commit them here. Samsung
   asks for at least one account per model group it tests; the demo server takes any number of
   logins at once, so the same account can be listed for each.
5. **Before submitting**, check the [pre-submission items](#pre-submission-items) on a TV.

## Pre-submission items

Samsung certifies these; each is covered in the app, and needs a check on the build uploaded:

- **Return and Exit.** Return goes back one level and, on Home, asks before exiting; Exit and a
  long press of Return are left to the TV (`docs/tizen.md`).
- **The Smart Remote.** It has no color keys of its own; its **123** button opens the on-screen
  keypad with the color and number keys, and every color-key action also has a path with the
  arrows and **OK** (the table in `ui-description.md`). Walk that table on the TV.
- **Hidden and resumed.** Leave the app with Home and come back: playback picks up again.
- **Screensaver.** It stays off while a video plays and comes back when playback pauses or stops.
- **No source.** A fresh install shows Home's welcome cards, never a blank screen or an error.
- **FCC model groups.** They take only apps with both Caption and TTS, which Pleione lacks:
  check in the pre-test of a release request (without pressing **Done**) whether the US
  groups are among them.
- **The demo server**, from outside the home network: `player_api.php` with the test login
  answers `"auth":1`, and stays up for the whole review.
- **Privacy.** A fresh install asks **Your privacy** before any source is added (Samsung's
  privacy guide: what is kept, why, for how long, and what refusing costs), and **Settings ›
  Data Management** shows the policy with a QR code to its full text.
