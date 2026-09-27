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
- `media`: preview rendering, fullscreen viewer, annotation drawer, and media actions.
- `batch`: multi-select annotation actions.

## Data Storage

SQLite stores indexed folders, assets, derivatives, tags, ratings, sessions, login attempts, and search text. Source media remains in the configured folders and is not copied into the database.

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
