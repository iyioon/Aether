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
npm ci
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

Use Node.js 24, matching `.nvmrc`, CI and Docker. The end-to-end suite starts
isolated servers and recreates disposable files under **.e2e**, using one worker.
It expects a local Chrome installation. Do not run competing browser suites or
reuse a live server/data directory for these tests. FFmpeg 5.1 or newer and its
matching ffprobe must be available for media tests. HEIC tests also require
`heif-info`, `heif-convert` and `heif-enc`, with libde265 and x265 plugins. On
Ubuntu/Debian, install `libheif-examples libheif-plugin-libde265
libheif-plugin-x265` from updated distribution packages. See
[HEIC tools](installation.md#heic-tools).

Run the required checks locally before pushing. The GitHub workflow is disabled
and has no automatic push or pull-request triggers. It is retained for optional
manual checks after re-enabling it in Actions.

The optional workflow uses Ubuntu 26.04 for the native decoder tools and
separately verifies the Debian Trixie production image. Keep both toolchains
covered when changing media processing; an OS package upgrade can change codec
metadata or fixture timing.

Presentation video processing needs the libx264 and libx265 encoders. Synthetic
animated AVIF fixtures also need libaom-av1. Use disposable fixtures to verify
the installed build and the production container; codec support can differ
between local FFmpeg and the runtime package.

Run `npm run build` before the browser suite. Phone layout and offline checks
use the production web build.

For media or scrolling performance changes, also run the opt-in mixed-library
check after building:

```bash
AETHER_E2E_LOAD_TESTS=1 npm run test:e2e -- tests/e2e/library-load.spec.ts
```

It creates 1,024 disposable items, including 12-megapixel JPEGs, 1080p video,
animated WebP and genuine HEIC. Desktop and phone runs exercise pagination,
repeated Gallery traversal, Feed playback and background cleanup. The test
reports first-frame timing, transfers, mounted media, retained JavaScript heap
and DOM counts; Linux also reports the test browser's resident memory. Timing
and resident memory are observations rather than hardware-independent pass
limits. Assertions cover bounded mounted media and repeated-pass heap growth.
It uses the same exclusive `.e2e` directory and ports as the normal suite.
Remove `.e2e`, `test-results` and `playwright-report` after test servers stop.

Run `docker build --target media-verification .` to verify presentation media
decoding and real HEVC-backed HEIC pixel conversion with the container's
FFmpeg/libheif versions. The optional workflow runs this target as well
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
