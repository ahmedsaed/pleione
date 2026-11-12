# Catalog prefetch and disk cache

Design decisions for issue #51: make the first visit to Movies, Series,
and Search fast on every TV, including low-storage webOS 4 sets where
IndexedDB is read-only. Nothing here is implemented yet.

## Today

- `xtream-catalog.ts` caches each category's stream list in IndexedDB.
  Browse loads the first `CONFIG.XTREAM.RAIL_CATEGORIES` (6) categories up
  front and the rest when opened. Expired lists are served at once and
  refreshed in the background.
- Search builds a whole-catalog copy (`vod_all` / `series_all`) by
  fetching one category at a time. Each run stops after
  `CONFIG.XTREAM.CATALOG_LOAD_BUDGET_MS` (60 s) and saves a cursor, so the
  next run resumes where it stopped. Nothing starts this fetch until
  Search asks for it.
- On low-storage webOS 4 sets, IndexedDB write failures (a few MiB in, on
  the set tested below) leave these caches memory-only, so a cold start
  downloads and parses everything again.

## Part B: background prewarm

Does not depend on device checks.

- **Scope:** only the picked source (the account the avatar switcher
  shows). Other enabled accounts are not prewarmed, to spare providers
  and the TV.
- **When:** a few seconds after Home settles. It pauses when playback
  starts and resumes from the saved cursor when playback stops, so it
  never competes with video for network or CPU.
- **How much:** the first prewarm runs to completion; the 60 s
  per-run limit stays for Search's foreground fetch only, where someone
  is waiting. It keeps the existing one-category-at-a-time pacing and
  cursor, so an interrupted prewarm continues instead of restarting.
  Later runs refresh only expired categories.
- **Indicator:** a static line on Home near the account avatar, such as
  "Updating catalog · 12 of 48", updated once per category and removed
  when done. No spinner: on webOS 4 one looping animation keeps the
  compositor drawing every frame.
- **Clearing:** no remote key. Settings keeps **Clear cache** (with its
  confirmation) and gains **Refresh catalog**, which re-runs the prewarm
  for the picked source without deleting other caches.
- **Category counts:** the Movies/Series "All categories" grid shows a
  category's title count only where it is already known. A complete
  prewarm makes every count known, with no extra work in the grid.

## Part A: disk cache through the bundled service

Waits for device checks.

When IndexedDB refuses a cache write, send cache records to the bundled service,
which stores them as ordinary files under a size cap (about 64 MB,
least recently used first out) and serves them back over the keyed
loopback HTTP route at startup.

Checks to run on real TVs before building it:

- Whether a Content Store install's service can write to
  `/media/internal`, or only to its own directory.
- How long an 8–20 MB catalog takes to read back and parse on webOS 4.
- How much free storage the low-storage sets really have, to settle the
  size cap.

### Device results: LG 55UK6300PVB, 2026-11-12

webOS 4 (platform 05.50.70), Chrome 53, 864 MB RAM, developer-mode
install. Each test used a synthetic Xtream VOD list of about 350 bytes
per title.

**Storage.** `/media/internal` and the developer app directory share one
550 MB eMMC partition with **257 MB free**.

**IndexedDB fills after about 3 MiB.** The temporary-storage quota
reads 18.7 MB and usage reads 0 (the 1 GiB system reserve in
[storage-and-data.md](storage-and-data.md#when-indexeddb-refuses-writes)).
A fresh test database took a 100 KB write and then three 1 MiB writes
before the fourth failed with `QuotaExceededError`. That doc reports
that every write fails, even 10 bytes, so the failure point varies
within a session. Either way, the app's `catalog-cache`,
`playlist-cache`, `epg-cache` and `search-index-cache` were all empty on
this TV, and user data had already moved to the `iptv_fb_*`
localStorage fallback.

**The service can write to `/media/internal`.** The developer-mode
service (its own uid, not the SSH user) created
`/media/internal/iptv-uploads`. The SSH shell sees that mount as
read-only, so the test has to run in the service. A Content Store
install is still unverified until the store build is live.

**Read-back is cheap; parsing is the cost.**

| Size | Titles | Flash write | Flash read (warm) | `JSON.parse`, Chrome 53 | `JSON.parse`, Node 0.12 |
| --- | --- | --- | --- | --- | --- |
| 8.3 MB | 25,000 | 247 ms | 107 ms | 481 ms | 532 ms |
| 20.3 MB | 61,000 | 510 ms | 359 ms | 1,264 ms | 1,442 ms |

What follows for the design:

- The service stores and serves raw bytes and never parses them; the
  page parses once.
- Store one file per category, as `xtream-catalog` already keys it, so
  a cold start parses only what Browse shows first. Read the whole
  catalog back only when Search needs it.
- Size cap: 64 MB would be a quarter of this set's free space. Use
  `min(64 MB, free / 8)` measured when the service starts (about 32 MB
  here), and stop writing while less than 100 MB is free.

## Open questions

- How the prewarm resumes after an app restart mid-run (cursor reuse
  across sessions is expected to work, but needs a test).
- Whether a refresh of an already complete catalog should also show the
  indicator, or only the first prewarm.
