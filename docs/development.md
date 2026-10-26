# Development

## Repository Layout

```text
apps/server       Fastify API, SQLite access, scanner, and media processing
apps/web          React and Vite interface
tests/e2e         Playwright browser tests
docs              user, operator, and contributor documentation
aether-data       local runtime data; ignored by Git
media             optional local source-media folder; ignored by Git
```

Generated build output, databases, cache files, local media, test results, and
private environment files do not belong in Git.

## Set Up A Local Checkout

```bash
npm install
mkdir -p aether-data
chmod 700 aether-data
cp private.env.example aether-data/private.env
chmod 600 aether-data/private.env
npm run dev
```

Use a small, disposable media folder for development whenever possible. The
scanner reads source files but should never modify them.

## Commands

```bash
npm run dev             # API and web development servers
npm run dev:lan         # temporary trusted-LAN testing
npm run lint            # ESLint
npm run format:check    # verify Prettier formatting
npm run format          # apply Prettier formatting
npm run typecheck       # TypeScript checks
npm run test            # unit and integration tests
npm run build           # production builds
npm start               # run the built server and web app
npm run verify          # all normal checks and builds
npm run test:e2e        # Playwright browser tests
npm run data:status     # inspect the local data directory
```

The end-to-end suite starts isolated servers and creates disposable files under
**.e2e**. It expects a local Chrome installation. FFmpeg 5.1 or newer and its
matching ffprobe must be available for media tests.

Run `npm run build` before the browser suite. Phone layout and offline checks
use the production web build.

Run `docker build --target media-verification .` to verify presentation media
decoding with the container's Debian FFmpeg version. CI runs this target as well
as the production image build and health check; the target does not add test
dependencies or fixtures to the runtime image.

## Working Rules

- Keep source media read-only.
- Resolve every source file through a configured media root.
- Validate request input at the API boundary.
- Pass subprocess arguments as arrays; never build a shell command from input.
- Keep route handling, database work, and media processing in their existing
  layers.
- Add tests for changes to authentication, paths, scans, data writes, search,
  media delivery, or destructive maintenance.
- Use existing UI primitives and keep keyboard and screen-reader behavior
  intact.
- Preserve unrelated working-tree changes.

See [Engineering standards](engineering.md) for the detailed code rules.

## Browser Checks

For interface changes, test both desktop and phone-sized layouts. Pay particular
attention to:

- gallery and folder scrolling
- feed navigation and video playback
- fullscreen media sizing
- comparison controls and keyboard shortcuts
- toolbar overflow
- sign-in, sign-out, and restored-page behavior

Run the Playwright suite for changes that affect a complete user flow.
