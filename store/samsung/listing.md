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

## Service information

| Field | Value |
|---|---|
| Service category | Videos |
| Age rating | The questionnaire's lowest that fits an app with no content of its own |
| Supported languages | English, Arabic, German, Spanish, French, Italian, Polish, Portuguese (Brazil), Russian, Turkish, Ukrainian, Chinese (Simplified) |
| Privacy policy URL | https://pleione.merope.dev/privacy/ |
| Seller type | Individual: no company registration number |
| Seller name | Merope (the name shown on the listing) |
| Representative, phone, mailing address | The individual seller's own, entered in Seller Office only |
| Customer support email | the address in `site/content/privacy.md` |
| Homepage URL | https://pleione.merope.dev |
| Service country | United States (the only one open to a Public Seller) |
| Billing | Free |

## App feature information

Select **Player**, and only it: Pleione has no captions of its own to certify (it shows the
provider's), no ads, no Smart View, and no external devices.

| Player field | Value |
|---|---|
| Streaming engine / player API | The TV's native player through the HTML5 `<video>` element |
| Container | HLS (MPEG-TS and fMP4 segments), MPEG-TS, MP4, MKV, MPEG-DASH |
| Video codec | H.264, HEVC |
| Audio codec | AAC, AC-3, E-AC-3 |
| DRM | Widevine Modular, PlayReady (MPEG-DASH, through Shaka Player on the TV's EME) |
| Subtitle format | WebVTT (in HLS), SRT, WebVTT and ASS/SSA files for movies and episodes |

The codecs are the ones `canPlayType` reports as playable on the 2020 TV (`docs/tizen.md`);
Pleione does not decode media itself, so what plays is what the TV plays.

## Verification information

| Field | Value |
|---|---|
| App description file | The PPTX made from [`ui-description.md`](ui-description.md) |
| Geo IP block | No |
| Test accounts | The demo Xtream server's URL, username and password (`store/README.md`), one entry per model group |
| Voucher codes | None: nothing is paid |
