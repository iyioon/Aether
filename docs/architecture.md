# Architecture

Aether is a TypeScript monorepo with a Fastify API server and a React/Vite web app.

```text
media roots (read-only)
        |
        v
scanner and derivative generation
        |
        v
SQLite metadata + local cache
        |
        v
Fastify API and authenticated media routes
        |
        v
React gallery, feed, and viewer UI
```

## Server

The server owns configuration, authentication, scanning, metadata, derivative generation, and media delivery.

Key areas:

- `auth`: password hashing, sessions, CSRF, and login throttling.
- `config`: environment parsing and runtime path resolution.
- `db`: SQLite schema, migrations, and custom search helpers.
- `library`: folder indexing, asset queries, routes, tags, thumbnails, video previews, and watcher logic.
- `security`: filesystem path safety checks.

## Web App

The web app is organized around reusable UI surfaces:

- `toolbar`: sort, layout, filter, and action menus.
- `sidebar`: library navigation shell.
- `folders`: folder tree model, DOM helpers, and navigation hooks.
- `gallery`: virtualized grid, metadata display, sizing, and aspect-ratio behavior.
- `feed`: vertical feed item rendering and navigation.
- `compare`: pairwise ranking session state and responsive comparison UI.
- `media`: preview rendering, fullscreen viewer, annotation drawer, and media actions.
- `batch`: multi-select annotation actions.

## Data Storage

SQLite stores indexed folders, assets, derivatives, tags, ratings, pairwise ranking history, sessions, login attempts, and search text. Source media remains in the configured folders and is not copied into the database.

## Pairwise Ranking

Ranking uses a regularized Bradley–Terry model over the current winner for each unordered asset pair. Every choice and undo is appended to `comparison_events`, while `pair_preferences` materializes the active decision for efficient refitting. Changing a choice replaces that pair's active preference instead of counting both opinions; undo restores its previous decision.

`asset_rankings` stores fitted skill, a display score, comparison coverage, and a manual adjustment. Direct score edits therefore remain separate from the statistical projection. Pair selection favors under-compared assets and similarly skilled opponents, avoids the immediately previous pair when possible, and reserves some random exploration to prevent a narrow comparison loop.

The cache directory stores generated derivatives. It can be rebuilt from source media, but keeping it improves startup and browsing performance after a reinstall.

## Media Strategy

Gallery tiles avoid loading originals whenever possible. Images use cached WebP thumbnails, while videos use poster frames and short MP4 preview clips. Animated image formats switch to the authenticated original stream when a visible tile needs animation.

The feed uses a progressive image path: it displays the cached thumbnail first, requests the authenticated original concurrently, waits for browser decoding, and then crossfades to the full-resolution image. A failed or unsupported original leaves the thumbnail in place.

Feed videos request the original authenticated stream first and use HTTP range requests for full-duration seeking. If the browser cannot play the source, the client falls back to the cached browser-compatible preview. The poster remains visible until playback produces a frame, preventing an empty surface during startup.

The fullscreen viewer uses authenticated originals and the same poster fallback for videos. Source filesystem paths are never exposed to the browser.

## Search

Aether uses SQLite FTS5 for indexed filename and path search. It also stores CJK n-grams so Korean and similar filenames can be found by partial substrings.

## Non-Goals

The current design does not include multi-user access control, cloud sync, public sharing links, destructive media editing, or automatic cloud analysis.
