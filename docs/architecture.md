# Architecture

Aether is a TypeScript workspace with two applications:

- **apps/server**: Fastify API, SQLite database, scanner, authentication, and
  media processing
- **apps/web**: React and Vite browser interface

```text
read-only media folders
          |
          v
 scanner and identity matching
          |
          +----> SQLite metadata
          |
          +----> generated media cache
                         |
                         v
               authenticated Fastify API
                         |
                         v
                    React web app
```

## Server

The server owns all filesystem and database access.

- **auth** handles password checks, sessions, CSRF, and failed-sign-in limits.
- **config** resolves environment settings, the data directory, and media roots.
- **db** creates SQLite tables and applies migrations.
- **library** scans files, stores metadata, runs searches, updates annotations,
  produces previews, and serves media.
- **security** checks that resolved files stay inside an allowed media root.

HTTP route modules validate requests and turn known failures into clear
responses. Repository modules own database queries and transactions. Media
processors receive an already validated source record; they never accept a raw
path from the browser.

## Media Identity

Each named media root has a stable identity that does not depend on its current
path. Files also receive a content digest. During a complete scan, Aether uses
the digest and the known paths to match renamed or moved files to existing asset
records.

When the match is safe, the asset keeps its ID, scores, favorites, tags, and
comparison history. Duplicate files are kept as separate assets and use their
known locations to avoid swapping metadata. A file that no longer has a match
is removed along with its Aether-managed metadata and generated derivatives.

Reconciliation happens only after every configured root has been read
successfully. If a root is disconnected or unreadable, the scan fails without
treating that entire library as deleted.

## Database

SQLite stores:

- media roots, folders, names, relative paths, and technical metadata
- content digests and scan state
- scores, favorites, tags, and search text
- comparison decisions and calculated rankings
- sessions and failed-sign-in records
- generated-derivative records

Source files are not copied into SQLite. Changes that affect several records use
a transaction so a partial update is not left behind.

Search uses SQLite FTS5. A small CJK substring index supports partial filename
search for Korean and similar writing systems.

## Generated Media

The cache contains data that Aether can recreate from source files:

- WebP image thumbnails
- JPEG video posters
- short browser-friendly video previews

Concurrent requests for the same preview share one generation job. When a scan
removes an asset, its generated files are removed. A startup sweep also clears
cache entries that no longer belong to a database asset.

## Web App

The browser application is split by feature:

- **gallery**: virtualized media grid and card details
- **feed**: one-item vertical browsing
- **compare**: leaderboard and pairwise ranking
- **media**: previews, fullscreen viewing, and annotations
- **folders**: folder tree and navigation
- **toolbar**: sorting, layout, search, and filters
- **settings**: appearance, status, and selective database resets

The server remains authoritative for library data. The browser cancels obsolete
reads and uses records returned by the server after a change. Scroll position
and appearance choices are browser-local conveniences, not part of the library
database.

The web app saves the page, library query, comparison workspace, Settings tab
and optional viewer asset ID. Explicit links take precedence; Home Screen
launches resume the saved location. Scroll positions use bounded localStorage
records, with migration from older sessionStorage records. Foreground refreshes
preserve loaded depth and anchors; `visibilitychange` and `pagehide` save pending
position changes when the page is hidden.

Ranking saves ordered asset IDs, the last choice that can be undone, and IDs for
requests with an unknown result. The server validates resumed IDs against
current filters and uses request IDs to apply each vote or Undo once. Resetting
comparisons invalidates older pending requests. Server records remain authoritative.

Production builds emit a service worker with a cache name derived from the
build's public assets. It precaches only the static application shell and lazy
chunks, bypasses all private API requests, and provides navigation recovery when
the network fails. Worker updates wait for previous clients to close; they do
not force a running session to reload. Development runs do not register it.

## Video Playback Controls

Feed and the expanded viewer share an event-driven playback observer and control
bar. The media element owns current time, duration, buffered/seekable ranges,
pause, and mute state. Commands run in the originating user gesture, and stale
play requests and detached element listeners cannot update a replacement source.
Preview and viewer keep their existing source selection and poster-to-first-frame
behavior. Feed keyboard commands use registered playback commands.

Explicit pause intent is separate from temporary hold, background, and panel
pauses. Lifecycle events pause media synchronously; foreground autoplay is
limited to muted media and preserves explicit pause. The viewer uses container fullscreen where
available, native iPhone video fullscreen otherwise, and native controls if a
fullscreen request fails.

The shared transport owns its bottom safe-area spacing. Feed metadata and viewer
media reserve its height; short landscape screens use a single control row.
Safe-area tokens follow [WebKit's guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/),
and native presentation capabilities are detected at runtime.

## Pairwise Ranking

Aether keeps the latest active choice for each pair while retaining reversible
decision events. A regularized Bradley-Terry model turns the active comparison
graph into relative scores. Direct score edits are stored separately so they do
not disappear when comparisons change.

The ranking session keeps a lookahead of up to three distinct pairs in memory.
A bounded, authenticated prefetch request excludes the visible pair and pairs
already queued. Selection still follows the server's ranking policy. After a
choice, the vote request offers the next prepared pair; the server validates it
against the updated filters and comparison generation before accepting it.
Invalid candidates fall back to a new server-selected pair. The client waits
for the vote acknowledgement, uses the returned records and progress, and
refills the queue. It never displays an unconfirmed vote as saved.

Preparation loads the sources used by comparison cards: thumbnails for still
images and video posters, original animated images, and a request for at most
the first 512 KiB of a video. This does not guarantee immediate video playback.
Original-image preparation requires known dimensions and file size. Each file
is limited to 8 MiB and 4 million pixels, with a queue budget of 16 MiB and
8 million pixels. Larger or unknown originals load when displayed, using the
prepared thumbnail while they load.
When the browser reports data-saving mode, a 2G connection, or an estimated
downlink below 1 Mb/s, only the first queued pair's thumbnails are prepared;
original images and video bytes are not requested. Hidden pages cancel preparation.
Changing filters, undoing, resetting comparisons, or restoring the session
discards outdated candidates. Prefetched records and media are not persisted
in ranking checkpoints or the service worker's public cache; media uses the
existing authenticated private browser cache.

The lifecycle and loading behavior follows the browser guidance for
[hidden pages](https://developer.chrome.com/docs/web-platform/page-lifecycle-api),
[image decoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode),
and [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

Zero is the only unranked score. Positive scores are ranked.

## Data Directory

**AETHER_DATA_DIR** contains the database, generated cache, internal backups,
private settings, and a safety marker. Docker mounts the same directory at
**/data**. Source media remains on separate read-only mounts.

See [Data management](data-management.md) for backup, rebuild, and wipe
behavior.

## Deliberate Limits

Aether does not include multi-user accounts, public sharing links, cloud sync,
source-file editing, or automatic cloud analysis.
