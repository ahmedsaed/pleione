# Samsung TV Seller Office listing

Copy each block into Seller Office › Applications › the app's information pages. The limits
shown are Samsung's; the form's own counter is the authority. The LG listing (`store/listing.md`)
is the source of this text: change both together.

## Title

```
Pleione
```

The default language's title must match `<name>` in the package's `config.xml`
(`scripts/tizen-config.mjs`), or pre-testing fails. Seller Office locks the default language and
its title during certification.

## Description (up to 4,000 characters)

```
Pleione plays the IPTV service you already have on your Samsung TV: live TV with a program guide and catch-up, movies and series, all laid out for the remote.

Pleione does not include any channels, playlists or content. You add a playlist or an account from a provider of your own, and you are responsible for having the right to watch it.

LIVE TV
• M3U and M3U8 playlists, and Xtream Codes accounts, several at once
• A program guide (XMLTV) found from your playlist or added by hand, with time correction
• Catch-up for programs that already aired
• Favorites, Recently Watched, number-key tuning, and reminders while Pleione is open

MOVIES AND SERIES (Xtream accounts)
• Browse by category, sorted by name, date added, rating or year
• Detail pages with plot, cast, rating, seasons and episodes
• Continue Watching and a Watchlist; episodes play on into the next one

SEARCH
• One search across channels, guide programs, movies and series
• Arabic-aware matching that ignores differences in hamza, final letters, diacritics and digits

PLAYBACK
• Streams go straight to the TV's own player
• Audio and subtitle tracks, remembered per channel and per title
• Optional online subtitle search, and cast photos with your own TMDB key

MAKE IT YOURS
• 12 languages: English, Arabic, German, Spanish, French, Italian, Polish, Portuguese (Brazil), Russian, Turkish, Ukrainian and Simplified Chinese
• Interface size from 90% to 130%, text size from 80% to 150%
• Light and dark color themes
• Parental controls with a PIN

PRIVATE
No account, no analytics, no ads. Your accounts and history stay on the TV, and Pleione talks only to your own providers and the optional services you turn on.

FREE AND OPEN SOURCE
Pleione is free software under the Apache-2.0 license, based on webOS IPTV Player by lennylxx.

Setup guide: https://pleione.merope.dev/setup/
```

It differs from the LG text where the Samsung store package does: no phone setup, which needs
the LAN web service that Seller Office takes only from Partner sellers (`README.md`);
reminders show only while the app is open (no TV notification API, `docs/tizen.md`); and live
pause and rewind are off on Samsung's native player.

## Tags (at least 3, comma-separated)

```
IPTV, M3U, Xtream, EPG, live TV, catch-up, player
```

## App images

The files in this folder (`README.md` has their sizes and limits):

| Seller Office field | File |
|---|---|
| Icon 1920 × 1080: logo asset with transparency | `icon-logo-1920x1080.png` |
| Icon 1920 × 1080: background image | `icon-background-1920x1080.jpg` |
| Icon 512 × 423 | `icon-512x423.png` |
| Background image | `background-1920x1080.jpg` |
| Screenshots 1–4 | `screenshot-1.jpg` … `screenshot-4.jpg` |

## Service info

| Field | Entered |
|---|---|
| Service category | **Videos** |
| Rating | **ALL**: Pleione has no content of its own, and has parental controls |
| Language | The 12 the app has: English, Arabic, Chinese (Simplified), French, German, Italian, Polish, Portuguese, Russian, Spanish, Turkish, Ukrainian. Testers may check each one |
| Collect personal information | **Yes**: the app keeps provider logins and viewing history on the TV and sends the logins to the user's providers |
| Privacy policy URL, English | https://pleione.merope.dev/privacy/ |
| Privacy policy URL, Korean | https://pleione.merope.dev/privacy/ko/ |
| Did you check "App Development Privacy Guide"? | **Yes**: the app shows the policy in Settings › Data Management and asks for consent before a first source (`docs/tizen.md`) |
| Seller name (company name) | Merope |
| Customer support email | support@merope.dev |
| Seller homepage | https://pleione.merope.dev |
| Representative, phone, address | The individual seller's own, entered in Seller Office only |
| DoC for the European Accessibility Act | Empty: only for EU countries, which this release leaves out |

The account is an **Individual** seller, with no company registration number.

## Service country/region

- **Rating certificates** (PEGI, ESRB, GRB, MJ/DEJUS, FSK, SAMSUNG): none. They are optional
  outside the countries that require one (Brazil's MJ/DEJUS, Korea's GRB).
- **Countries**: **United States of America** only. A Public seller can launch nowhere else, and
  the countries under the EU Digital Services Act also need a company registration number.

## Billing info

**Free** only: no Samsung Checkout and no 3rd-party billing.

## App feature info

**Player**, and nothing else:

| Feature | Why not |
|---|---|
| Caption | Closed captions that follow the TV's caption settings: the Samsung build shows a stream's own subtitles, not CEA-608/708 |
| HDR | Not checked on a Samsung TV |
| TTS | Voice Guide is not supported yet |
| Mobile Device | The store package has no phone setup |
| The rest | Pleione uses none of them |

The Player page, as Seller Office lists its choices:

| Field | Selected |
|---|---|
| Video codec | H.264, HEVC |
| Audio codec | AAC, AC3, Other |
| Container | MP4 (FMP4), MPEG-TS, Mstroska (Seller Office's spelling of Matroska) |
| DRM | PlayReady, Widevine (Modular) |
| Streaming engine | HLS, HTTP(HTTPS), MPEG-DASH |
| Player API | MSE, Other |
| Subtitle | WebVTT, Other |
| Other (100 bytes) | `HTML5 video for native playback; E-AC-3 audio; SRT and ASS/SSA subtitles; HLS TS/fMP4 segments` |

WebM, Smooth Streaming, AVPlay, Close Caption and SMPTE-TT are left out, untested or unused.
The codecs are the ones `canPlayType` reports as playable on the 2020 TV (`docs/tizen.md`);
Pleione does not decode media itself, so what plays is what the TV plays. Seller Office notes
that PlayReady support ends with 2027 TV models; Widevine streams keep working.

## Verification info

| Field | Entered |
|---|---|
| App description file | [`ui-description.pptx`](ui-description.pptx), with the three test-account cells on slide 6 filled in. The filled-in copy is never committed |
| Geo IP block | No |
| Voucher code | `Not applicable: Pleione is free and has no paid content.` |
| Share app source with members | No: the account has no other members |

**Test account** (up to 4,000 bytes; fill in the three values, never commit them):

```
Pleione is an IPTV player and ships no content. Testers add this test account in the app: on first launch, select Agree on "Your privacy", then Add Xtream account on Home (later: Settings > Sources > + Add Xtream Account).

Account type: Xtream account
Server URL: [Server URL]
Username: [Username]
Password: [Password]

This account allows any number of simultaneous logins, so the same login can be used by every tester and every model group at the same time. All content is synthetic test media made for this review: live channels in Group 1 to Group 8 and Group HD, a program guide with catch-up, movies and series. Channel Alpha (number 1) has catch-up; Movie A has two audio tracks and several subtitle tracks; Group HD holds the resolution test streams. The content is the same for every login, so no other accounts are needed.
```

Seller Office asks for at least as many test accounts as model groups. The demo server checks
one login and does not limit concurrent use, which the text says. If reviewers still want
separate logins, the demo server needs to learn several accounts.

## Distribute

- **App service › Request New Release** is the submission: the version, the model groups,
  then **Next** runs the pre-test for those groups and **Done** sends the app to certification.
  The list starts at 2022 models (Tizen 6.5); leave out groups ending in "LIC"/"LIC2", which
  are other brands' TVs licensed to run Tizen.
- **FCC model groups** take only apps with both Caption and TTS. Check before submitting whether
  the US groups are among them: the pre-test of a request shows it, without pressing **Done**.
- **Beta test** is optional and runs only in the app's service countries, on 2021 and later
  models: a tester enters **1 3 4 6 7 8** in the TV's Settings, then a one-time activation code.
- **App Review** lists users' reviews of the app, not Samsung's certification.
