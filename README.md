# Aether

Aether is a private, self-hosted media sanctuary for local folders. It is intended to run on your machine or home server, with source media mounted read-only and all metadata stored locally.

## Current Status

The repository is in the foundation phase. It includes:

- Local TypeScript workspace scaffold.
- Fastify backend foundation.
- SQLite schema and migrations.
- Password/session auth foundation.
- Persistent SQLite-backed failed-login throttling and lockouts.
- Baseline browser hardening with CSP, frame denial, API no-store defaults, request body limits, and sanitized malformed URL errors.
- Local media-root scanner.
- Debounced local file watching for media-root refreshes.
- Scan-time image dimension indexing for accurate Original aspect tiles.
- Keyboard-accessible collapsible folder tree with expand/collapse controls.
- Mobile folder drawer and compact phone layout.
- Contained sidebar, gallery, and feed scroll regions so one panel does not move the whole app.
- Authenticated media streaming with HTTP range support.
- Authenticated media downloads.
- Lazy image thumbnail generation into the local cache.
- Lazy video poster generation and duration/codec metadata extraction.
- Lazy video preview clip generation for gallery/feed playback.
- Visible animated image previews for GIF, animated WebP, animated AVIF, and APNG-style files.
- Fullscreen image/video viewer.
- Rating, favorite, tag, and tag-suggestion APIs.
- Privacy-first local tag suggestions from filenames, folders, and existing tag vocabulary.
- Disabled-by-default local Ollama vision tag suggestions for reviewed, opt-in AI tagging.
- Transactional batch rating and batch tagging APIs.
- Viewer controls for ratings, favorites, tags, and reviewed tag suggestions.
- Indexed filename/path search.
- Gallery filters for media type, favorites, rated/unrated state, and tags.
- URL-backed library view, folder, search, and filter state.
- Incremental gallery/feed page loading with scroll-container-scoped auto-load sentinels.
- Virtualized gallery rows for large loaded result sets.
- Gallery size controls from Tiny through Huge.
- Device-local gallery metadata display settings for title, type, size, rating, tags, and favorite state.
- Original aspect mode using indexed or browser-measured media dimensions.
- Multi-select gallery controls with batch rating, favorite, and add/replace/clear tag actions.
- TikTok-style vertical scroll-snap feed mode using the same filtered collection.
- Keyboard, wheel, touch-swipe, and desktop up/down controls for feed browsing.
- Fullscreen number-key rating shortcuts.
- Frontend unit tests for URL state and gallery page-loading guards.
- Local Playwright e2e test coverage for login, scanning, folder collapse/expand, animated GIF/WebP/APNG/AVIF source behavior, selection, batch annotations, reviewed tag suggestions, fullscreen viewing, and feed mode.
- React/Vite frontend shell.
- Local-only Docker Compose setup with loopback binding, read-only source media, and hardened container defaults.
- Trusted-LAN dev preview script for phone/tablet testing.
- SQLite backup CLI for local metadata snapshots.

Broader model/provider support and fuller public documentation are planned next phases.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run hash-password -w @aether/server -- "choose-a-password"
npm run dev
```

Put local test media under `./media`, or set `AETHER_MEDIA_ROOTS` to one or more comma-separated folders.

After signing in, use the scan button in the folder sidebar to index the configured media roots. The folder tree can be expanded/collapsed from each disclosure button or with the expand/collapse-all actions. The scanner stores metadata in local SQLite and does not copy or mutate original media files.

Aether watches configured media roots by default and schedules a debounced rescan when files or folders change. Set `AETHER_WATCH_ENABLED=false` for unstable network mounts or very large trees where native file-watch handles are limited; the manual scan button remains available.

Images are displayed through authenticated cached WebP thumbnails. Animated image formats such as GIF, WebP, AVIF, and APNG switch to the authenticated original stream only while their tile is visible, so animation is preserved without loading every animated file at once. Videos use authenticated poster frames before loading cached muted MP4 preview clips while visible, falling back to the original stream if preview generation fails. Original media is served only through asset-ID routes, and downloads use the authenticated download endpoint.

Library URLs preserve the selected folder, view mode, search, sort, grid size, aspect mode, media type, rating filter, and tag filter. Session tokens and passwords are never stored in URLs.

Failed login attempts are throttled persistently in SQLite. The defaults allow 10 failed attempts in 15 minutes, then lock that source for 15 minutes. Tune with `AETHER_LOGIN_MAX_ATTEMPTS`, `AETHER_LOGIN_WINDOW_MINUTES`, and `AETHER_LOGIN_LOCKOUT_MINUTES`.

AI tag suggestions are disabled unless `AETHER_AI_PROVIDER=ollama` is set. When enabled, Aether sends a resized image preview to the configured Ollama-compatible local endpoint and returns reviewed suggestion chips; no suggestion is saved until you click it. The app does not configure or require a cloud AI provider.

The dev app uses:

- API: `http://127.0.0.1:3030`
- Web: `http://127.0.0.1:5173`

For temporary phone or tablet testing on the same trusted LAN, run:

```bash
npm run dev:lan
```

Then open the `Network` URL printed by Vite, such as `http://<your-lan-ip>:5173/`. Keep this for trusted local networks only; use the Docker/reverse-proxy path for a longer-lived home-server setup.

## Verification

```bash
npm run check
npm run build
npm run test:e2e
```

The e2e suite starts an isolated local API and Vite server on separate ports. It writes temporary fixture media under `.e2e/` and does not scan or modify the normal `./media`, `./config`, or `./cache` folders.

The Playwright config uses the local Chrome channel. On a headless home server, install a compatible Playwright browser or adjust `playwright.config.ts` for the browser available on that host.

## Backups

```bash
npm run backup -- --output ./backups
```

The backup command creates a timestamped folder containing a consistent `aether.sqlite` snapshot and `manifest.json`. Add `--include-cache` if you also want to copy generated thumbnails, posters, and preview clips. Add `--keep 14` to retain only the newest 14 Aether backup folders in the output directory. Source media remains outside the backup and should use its own backup process.

## Local Docker

```bash
docker compose up --build
```

Generate and provide `AETHER_PASSWORD_HASH` and `AETHER_SESSION_SECRET` before running a long-lived container. The included Compose file binds the service to `127.0.0.1:3030` by default so it can sit behind a local reverse proxy without directly exposing the app to the LAN.

The compose file mounts:

- `./media` as read-only media input.
- `./config` as local writable configuration/database storage.
- `./cache` as local writable derivative cache.

No remote hosting is configured.

For HTTPS through a trusted local reverse proxy, set `AETHER_COOKIE_SECURE=true` and `AETHER_TRUST_PROXY=true`. Keep direct LAN exposure behind a firewall, use strong credentials, and rotate `AETHER_SESSION_SECRET` if it is ever exposed.

For Docker plus a host-running Ollama instance, set `AETHER_AI_PROVIDER=ollama` and point `AETHER_OLLAMA_BASE_URL` at the address reachable from the container, such as `http://host.docker.internal:11434` on Docker Desktop.
