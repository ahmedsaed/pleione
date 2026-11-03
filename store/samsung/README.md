# Samsung TV Seller Office listing

What Samsung's [TV Seller Office](https://seller.samsungapps.com/tv) asks for when the app is
registered, kept beside the LG listing (`store/`) so both change in the same pull request as the
app. The fields and limits are from Samsung's
[Entering application information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)
guide; Seller Office's own form is the authority when they differ.

| What | Where |
|---|---|
| Title, description, tags, category, service, feature and verification answers | [`listing.md`](listing.md) |
| The UI description the testers follow (Samsung's PPTX template) | [`ui-description.md`](ui-description.md) |
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
   `npm run screenshots:store` (see `store/README.md`).
2. `npm run store:samsung` draws the icons and background from `assets/icon.svg` and encodes
   the screenshots, lowering the JPG quality only as far as a file's limit needs. It fails if a
   file cannot fit its limit.

The files are generated, never edited by hand.

## What is left for a human

1. **Seller Office account.** Register Merope as a seller at
   [seller.samsungapps.com/tv](https://seller.samsungapps.com/tv), with the support email from
   `site/content/privacy.md`. A Public Seller can launch only in the US; request Partner Seller
   status (an offline contract with Samsung) to reach other countries
   (`docs/tizen-port-plan.md`, §7.1).
2. **The package.** Upload the `.wgt` from the GitHub release, signed with the Merope author
   certificate (`docs/tizen.md`, "Certificates"). Its package id `PleioneMrp` and that
   certificate are the app's identity for good: a different id is a different app, and a
   different author certificate cannot update this one.
3. **The UI description.** Download the template from Samsung's
   [Application UI description](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/application-ui-description.html)
   page, fill it in from [`ui-description.md`](ui-description.md) without changing the
   template's structure, add a labeled screenshot for each screen, and upload it as PPTX. Update
   and upload it again with every app update.
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
  keypad with the color and number keys. Check that every color-key action in
  `ui-description.md` also has an on-screen path, as `docs/tizen-port-plan.md` §3.1 lists.
- **Hidden and resumed.** Leave the app with Home and come back: playback picks up again.
- **Screensaver.** It stays off while a video plays and comes back when playback pauses or stops.
- **No source.** A fresh install shows Home's welcome cards, never a blank screen or an error.
