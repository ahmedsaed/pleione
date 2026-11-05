# Pleione — Application UI description for Samsung review

The source for the PPTX that Seller Office asks for. Samsung's template fixes the structure;
copy each section below into its slide, and add a screenshot of each screen with its buttons
labeled. The use cases are the LG review's ([`../ux-scenario.md`](../ux-scenario.md)), which
apply to the Samsung build as written except where [Samsung differences](#samsung-differences)
says otherwise.

## Title slide

| Field | Value |
|---|---|
| Application | Pleione |
| Content provider | None: Pleione is a player and ships no content. The test account serves synthetic test media made for this review. |
| Seller | Merope |

## Revision history

| Version | Date | Changes | Author | App version |
|---|---|---|---|---|
| 1.0 | 2026.11.03 | First submission | Merope | 2.3.0 |
| 1.1 | 2026.11.05 | Settings saves automatically; content follows the picked source; Time format | Merope | 2.6.1 |

Add a row for every update; the app version is `version` in `package.json`.

## UI structure

```
Home ──┬── Live ──── channel list ─┬── full-screen player (live)
       │      └──── Guide ─────────┘     └── catch-up player
       ├── Movies ── detail page ────── player (movie)
       ├── Series ── detail page ────── player (episode)
       ├── Search ── results ─────────── detail page / player
       └── Settings ─ General (language, time format, parental controls), Sources,
                      Program Guide, Appearance, Playback, Online Subtitles,
                      Advanced, Data Management
```

Return goes up one level on every screen, back along the arrows above, and asks before exiting
on Home. Screenshots for each screen: Home, Live, the Guide, the live player with its controls,
Movies, a movie's detail page, Series, an episode list, Search, and Settings.
`store/screenshots/` holds a capture of each; `captures/` holds the store build's own Player,
Settings, Data Management and privacy notice.

The account picker on Home (the circle at the top right) lists the accounts and playlists added;
Live, the Guide, Search, Movies and Series show only the one picked. Settings has no Save button:
a setting applies as soon as it changes, and sources save on **Return**, which goes Home. The clock
is 12-hour by default (**Settings › General › Time format**).

## Remote control keys

| Key | What it does |
|---|---|
| Arrows, **OK** | Move and select, everywhere |
| **Return** | Up one level; on Home, asks **Exit Pleione?** with **Exit** and **Cancel** |
| **Exit**, long press of **Return** | Left to the TV: Pleione closes |
| **Play/Pause** (one key) | Pause or resume a movie, an episode or a catch-up program; on live TV, show the player controls |
| **▶**, **⏸**, **■** | Play, pause, stop |
| **⏪**, **⏩** | Skip back or forward in movies and episodes |
| **CH +/−** | Change channel while watching live TV |
| **Info** | Show the player controls while watching |
| **Guide** | Open the Guide; in the Guide, back to the channel list |
| Number keys | Tune a channel by its number |
| **Red** | Open the Guide, as **Guide** does |
| **Green** | Add or remove the selected channel from Favorites, in Live |
| **Yellow** | Edit the channel list in Live; show the player controls while watching |
| **Blue** | Open Settings |

On the Smart Remote, the **123** button opens the on-screen keypad with the number and color
keys. Every color-key action also has a path with the arrows and **OK** alone:

| Color key | The same with the arrows and OK |
|---|---|
| **Red**, Guide | The **Guide** button in Live's header (**Up** from the list) |
| **Green**, Favorite in Live | **OK** to watch the channel, **OK** for the controls, then **Toggle Favorite** |
| **Green**, Favorite while watching | **Toggle Favorite** in the player controls |
| **Yellow**, edit the channel list | The **Edit Channel List** button in Live's header (**Up** from the list) |
| **Yellow**, player controls | **OK** |
| **Blue**, Settings | **Return** to Home, then **Settings** |
| Colors in the channel editor, favorites, parental controls and Live categories | The buttons in each screen's footer, which take focus and **OK** |

## Language switching

Settings › General › Language lists the 12 languages: English, Arabic, German, Spanish,
French, Italian, Polish, Portuguese (Brazil), Russian, Turkish, Ukrainian and Simplified
Chinese. The choice applies at once; Arabic mirrors the interface right to left.

## Use cases

Sections 0 to 7 and 10 of [`../ux-scenario.md`](../ux-scenario.md): the test account, first
launch and adding the account, Home, Live TV and the Guide, the player controls, Movies and
Series, Search, Settings with parental controls, and the resolution and network checks. Leave
out section 8 and the phone setup panel of section 1: the store package has no phone setup. One slide per section; each step names the keys and buttons it uses.

## Samsung differences

Use these in place of the LG text in the scenario:

- **Privacy notice** (section 1). A first launch shows **Your privacy** over the welcome
  screen: what the app keeps on the TV, why, for how long, and that a source can't be added
  without agreeing. **Agree** (focused) continues; **Not now** keeps the welcome screen, and
  **Add Xtream account** or **Add M3U playlist** asks again. The answer is kept until **Reset
  App**.
- **Privacy Policy** (section 7). **Settings › Data Management** opens on the policy in brief,
  with a QR code and the address of the full text.

- **The pointer.** Samsung remotes have none: every step uses the keys above, and the app starts
  with a selected item on screen.
- **Back** in the scenario is **Return** on the Samsung remote.
- **Leaving the app** (section 9). **Return** on Home asks **Exit Pleione?**; **Exit** closes the
  app and **Cancel** or **Return** stays. The remote's **Exit** key closes it at once, and
  **Home** leaves it running in the background; opening Pleione again returns to where it was.
- **Reminders** (sections 3 and 7). A reminder appears while Pleione is open; with Pleione
  closed, it appears when Pleione opens while the program is still on air.
- **Pause and rewind live TV** (sections 4 and 10). They are off on Samsung TVs: a live channel
  plays at the live point, and the **HLS** stream format does not add them. Catch-up programs
  play, pause and seek as in the scenario.
- **Player controls.** **Info** shows them as **Yellow** does, and **Play/Pause** pauses and
  resumes a movie, an episode or a catch-up program in one key. On live TV, which cannot pause
  here, it shows the controls.
