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
- On webOS 4 with less than 1 GiB free, Chromium 53 refuses every
  IndexedDB write, so all of these caches are memory-only there and a
  cold start downloads and parses everything again.

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

When IndexedDB is read-only, send cache records to the bundled service,
which stores them as ordinary files under a size cap (about 64 MB,
least recently used first out) and serves them back over the keyed
loopback HTTP route at startup.

Checks to run on real TVs before building it:

- Whether a Content Store install's service can write to
  `/media/internal`, or only to its own directory.
- How long an 8–20 MB catalog takes to read back and parse on webOS 4.
- How much free storage the low-storage sets really have, to settle the
  size cap.

## Open questions

- How the prewarm resumes after an app restart mid-run (cursor reuse
  across sessions is expected to work, but needs a test).
- Whether a refresh of an already complete catalog should also show the
  indicator, or only the first prewarm.
