# Development

## Repository Layout

```text
apps/server   Fastify API, SQLite, scanner, media processing
apps/web      React/Vite interface
tests/e2e     Playwright browser tests
config        local SQLite state, ignored except .gitkeep
cache         generated derivatives, ignored except .gitkeep
media         local source media mount, ignored except .gitkeep
```

## Commands

```bash
npm install
npm run dev
npm run check
npm run build
npm run verify
npm run test:e2e
```

`npm run check` runs workspace type checks and unit tests. `npm run verify` adds production builds. `npm run test:e2e` starts isolated local API and web servers and writes temporary fixture media under `.e2e/`.

## Code Style

- Keep original media read-only.
- Keep all filesystem access behind configured media roots.
- Prefer small components and focused hooks over large UI files.
- Validate request input at the API boundary.
- Use argument arrays for subprocess calls.
- Add or update tests for auth, path handling, metadata writes, search, and media streaming.
- Keep generated artifacts, local databases, cache files, and private notes out of source control.

## Browser Checks

For UI changes, run the app locally and check both desktop and mobile-width layouts. Feed mode, fullscreen media sizing, toolbar overflow, and sidebar scrolling are the highest-risk areas.

## E2E Requirements

The Playwright suite expects a local Chrome channel by default. On machines without Chrome, install a compatible browser or adjust `playwright.config.ts` for the available channel.

FFmpeg and ffprobe should be available when testing video metadata, posters, and preview clips.
