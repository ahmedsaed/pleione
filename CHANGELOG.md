# Changelog

Notable changes, newest first. Each version's section is published as the
notes of its GitHub release by the `release` job in
`.github/workflows/build.yml`, so write it for the people installing the
app: what changed for them, not which files moved.

A section opens with one sentence on its own line. That sentence is the
release's headline wherever it is shown. Then `### Added`, `### Changed` and
`### Fixed`, as needed.

`scripts/release-notes.test.mjs` fails when `package.json` carries a version
with no section here, so a version bump and its notes land together.

## [2.6.3] — 2026-11-13

**Movies and Series no longer run older TVs out of memory, and their artwork fades in.**

### Changed

- Artwork in Movies and Series fades in once it has loaded instead of
  appearing all at once, and the previous title's artwork fades out as
  soon as you move to another one.

### Fixed

- Browsing Movies and Series on webOS 4 TVs no longer gets the app closed
  to free memory. The blurred poster behind a title without a backdrop
  used about 80 MB per page; it is now drawn as a soft wash that costs
  about 10 MB.
- A provider's artwork address can no longer add its own styles to the
  page.

## [2.6.2] — 2026-11-05

**A smoke suite runs in each TV's real Chromium engine, and wrapped rows sit flush on engines without flex gap.**

### Added

- A smoke suite that runs the app in the Chromium engines the supported TVs
  ship, from 53 to 120, on every tagged build.

### Fixed

- Wrapped rows of buttons and chips no longer indent their second line on
  the older TV engines that lack flexbox `gap`.

## [2.6.1] — 2026-11-05

**Name an Xtream account from the phone setup page, which now looks like the app.**

### Added

- The phone setup page can name an Xtream account as you add it.
- A Cast photos section on the phone setup page, for your own TMDB key.

### Changed

- The phone setup page has Pleione's own look.

### Fixed

- Settings' header and sidebar no longer move while you scroll on Chromium 69
  (Samsung 2020 TVs).
- Samsung TVs that play MPEG-TS natively are no longer sent through AVPlay.

## [2.6.0] — 2026-11-05

**Settings saves as it changes, with no Save or Cancel, and the app shows only the source you picked.**

### Changed

- Settings saves each change as you make it. Save and Cancel are gone.
- Only the source you picked is shown across the app. Live and the player's
  sidebar no longer have a tab per source.
- The focus ring in Settings keeps clear of the screen edges.

## [2.5.1] — 2026-11-04

**Settings and the dialogs take on Pleione's own look.**

## [2.5.0] — 2026-11-04

**AVPlay on Tizen 8 and later, and a time format setting, 12-hour by default.**

### Added

- A Time format setting, 12-hour or 24-hour, 12-hour by default.

### Changed

- Samsung TVs on Tizen 8 and later play through AVPlay.

### Fixed

- The text in Live's preview is no longer scaled twice.

## [2.4.0] — 2026-11-03

**Raw MPEG-TS plays through Samsung's AVPlay on the TVs that need it, and phone setup works on Tizen 9.**

### Fixed

- Raw MPEG-TS streams play on the Samsung TVs whose browser cannot play them,
  through AVPlay.
- Phone setup starts on Tizen 9, whose service drops reply ports.
- The catalog's large artwork is painted on its own layer, so moving past it
  stays smooth.

## [2.3.0] — 2026-11-03

**On Samsung, adding a source asks for privacy consent first, and Settings shows the policy.**

### Added

- On Samsung TVs, a privacy notice to agree to before a source is added, and
  the privacy policy in Settings.

## [2.2.1] — 2026-11-03

**A Samsung store package that passes Seller Office's pre-test.**

## [2.2.0] — 2026-11-03

**Samsung TVs from 2020 on, and a 1280×720 package for LG's Full HD sets.**

### Added

- Samsung TVs from 2020 (Tizen 5.5) and later. Phone setup is not in this
  build yet.
- A 1280×720 package for LG's Full HD TVs, mostly 32″ and some 43″ sets.
  Install the `_fhd` file on those.

### Fixed

- Faster re-tuning in Live, and a channel list that redraws only the rows that
  changed.
- Text fields take Samsung's Return key as Back.

## [2.1.0] — 2026-11-01

**Arabic lays the whole interface out right to left, while passwords, PINs and the playback controls keep their own direction.**

### Added

- A fully mirrored right-to-left layout for Arabic: rails, the Guide's
  timeline, the seek bar, the track menu, the channel list, overlays, and the
  phone setup page.

### Changed

- Password fields, parental PIN slots and the player's playback controls stay
  left to right.

## [2.0.0] — 2026-11-01

**The first release as Pleione: Restart for movies and catch-up, Continue Watching that resumes a series, and Live loaded through the Xtream Player API.**

### Added

- A Restart button for movies, episodes and catch-up.
- Continue Watching resumes a series at its last played episode, with the
  series' own artwork. Hold OK on a title to remove it.
- The audio and subtitle tracks show as labeled pills in the player.
- A buffering spinner over movies, episodes and catch-up.

### Changed

- Xtream Live channels load from the Player API, and each account signs in
  once per session.
- Episodes are named in the interface language.

### Fixed

- A movie or episode that fails to start is retried before an error is shown.
