# Aether Repository Guide

This guidance applies throughout the repository. Check for additional guidance
in any directory you change.

## Before Making Changes

1. Read [Engineering standards](docs/engineering.md),
   [Architecture](docs/architecture.md), and
   [Development](docs/development.md). Use the
   [documentation index](docs/README.md) for the relevant operator and user docs.
2. Check `git status` and preserve unrelated work. Trace the affected flow
   through its UI, API, repository, and tests before choosing where to change it.
3. Keep the change focused. Extend the existing feature modules and shared
   helpers before introducing new abstractions, dependencies, or documents.

## Product And Data Boundaries

Aether is a private, self-hosted gallery that indexes existing photo and video
folders in place. It uses one shared password and server-side sessions. Public
sharing, multi-user accounts, cloud sync, uploads, and source-file editing are
outside the current product scope.

- Source media is read-only. Never modify it or use a real library for
  destructive tests.
- Managed server state belongs under `AETHER_DATA_DIR`: database, generated
  cache, internal backups, private settings, and ownership marker. Keep real
  secrets and private media-root paths out of tracked files, examples, logs, and
  browser responses; use generic paths in examples.
- Preserve path validation, symlink escape protection, runtime locks, and
  maintenance guards. Rebuild, restore, and wipe operate offline; test them only
  against disposable data. Follow [Data management](docs/data-management.md).
- Keep optional network services opt-in. Tag suggestions remain disabled by
  default and must not save suggested tags without user selection.
- Preserve authenticated API and media access, CSRF protection for unsafe
  methods, login throttling, and safe settings summaries. Metadata uses
  `no-store`; media uses authenticated private browser caching. See
  [Security](docs/security.md).

## Repository Map

| Area                          | Entry points and responsibility                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Server startup                | `apps/server/src/index.ts`, `http/app.ts`: configuration, authentication, application lifecycle, and production web serving          |
| Server features               | `apps/server/src/library`: routes, schemas, repository modules, scanning, ranking, and media processing                              |
| Persistence and maintenance   | `apps/server/src/db/database.ts`, `maintenance`, `cli`, `security`: migrations, backup/restore, runtime ownership, and path safety   |
| Web application               | `apps/web/src/App.tsx`, `components/AppShell.tsx`, `api/client.ts`: authentication, feature composition, and API transport/contracts |
| Web features and presentation | `apps/web/src/components`, `hooks`, `lib`, `styles`: feature hooks, shared media/UI components, lifecycle helpers, and CSS           |
| Tests                         | `apps/server/test`, colocated web `*.test.ts`, `tests/e2e`: API/repository tests, pure/helper tests, and complete browser flows      |
| Packaging                     | `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`: runtime, deployment defaults, and CI                                 |

Paths within a map entry are relative to that entry's application source
directory unless written from the repository root.

## Environment And Commands

Use Node.js 24, matching `.nvmrc`, Docker, and CI. The project uses npm
workspaces, TypeScript, and ES modules. FFmpeg 5.1 or newer, matching ffprobe,
and the libx264/libx265 encoders are required for media processing and tests.
HEIC processing requires updated libheif CLI tools with the libde265 decoder;
HEIC tests also require `heif-enc` and the x265 plugin. See
[HEIC tools](docs/installation.md#heic-tools). Browser tests require Chrome; Docker checks require Docker Compose.

Use `npm ci` for a clean checkout. Follow the [setup instructions](README.md)
with disposable media and data; preserve existing local environment files.
Development normally uses API port 3030 and web port 5173.

| Command                                             | Purpose                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev`                                       | Start the API and Vite development server                                                   |
| `npm run verify`                                    | Required gate: lint, formatting, type checks, unit/integration tests, and production builds |
| `npm run test -w @aether/server`                    | Run server tests during development                                                         |
| `npm run test -w @aether/web`                       | Run web helper tests during development                                                     |
| `npm run test:e2e`                                  | Run browser scenarios after a production build                                              |
| `npm audit --omit=dev --audit-level=high`           | Check production dependencies as CI does                                                    |
| `docker compose config -q` / `docker compose build` | Validate packaging and build the container                                                  |
| `docker build --target media-verification .`        | Verify media decoders with the container's FFmpeg/libheif versions                          |

Run commands from the repository root. `npm run verify` includes a build;
otherwise run `npm run build` before browser tests. Phone and PWA scenarios use
the built application, so Vite development behavior alone is insufficient.

The browser suite owns and recreates `.e2e`, uses one worker, and starts its own
servers on ports 3130 and 4173 by default. Do not run competing browser suites
against the shared fixture directory or reuse a live server/data directory.

## Implementation Rules

### Server And Database

Paths in this section are relative to `apps/server/src`.

- Keep request validation in Zod route schemas. Routes translate transport and
  domain errors; `library/repository-*.ts` modules own SQLite queries and transactions;
  pure domain modules own calculations. `library/repository.ts` is the facade.
- Keep server TypeScript relative imports compatible with NodeNext by using
  `.js` suffixes. Follow the existing strict types, type-only imports, ESLint,
  and Prettier configuration rather than adding local style exceptions.
- Keep filters and final-score calculations in `library/asset-query.ts`.
  Zero is the sole unranked score. Ranking calculations must remain
  deterministic for active preferences; pair-selection randomness is injectable
  for tests.
- Use transactions for related writes. Batch paths must validate and hydrate
  records with bounded set-based queries, reuse prepared statements, and
  preserve requested order.
- Append versioned migrations in `db/database.ts`; do not rewrite applied
  migrations. Update latest-schema validation when necessary, and cover fresh
  databases, upgrades, and restore compatibility.
- Reconcile missing assets only after all configured roots have been read
  successfully. Preserve IDs and metadata on safe moves/renames; ambiguous
  duplicates must not exchange metadata.
- Resolve source files through the shared path-safety layer. Media processors
  receive validated records, not browser-supplied paths. Preserve authenticated
  HEAD/range behavior, shared derivative jobs, cleanup, and bounded processing.
  Spawn subprocesses with argument arrays, never assembled shell commands.

### Web State And Media

Paths in this section are relative to `apps/web/src`.

- `App.tsx` owns authentication; `components/AppShell.tsx` composes focused hooks and lazy
  views. Keep API types, credentials, CSRF, deadlines, and unauthorized handling
  in `api/client.ts`. Update server and client contracts together.
- The server owns library records and rankings. Use returned records after
  mutations. Abort obsolete reads and reject stale results after query changes
  or unmount; serialize or coalesce repeated mutations for the same record.
- Reuse `components/app-location-state.ts`, `components/library-state.ts`,
  `components/scroll-restoration.ts`, `components/assets/random-order-state.ts`,
  and `components/compare/ranking-resume-state.ts`. Explicit links take
  precedence over saved state; Home Screen launches resume the saved location.
  Validate and bound persisted data, and tolerate unavailable storage.
- Flush checkpoints on `visibilitychange` and `pagehide`; mobile suspension can
  prevent timers from running. Foreground refresh must preserve loaded depth,
  scroll anchors, the viewer asset, ordered comparison pair, and Undo.
- Preserve comparison mutation IDs, idempotent retries, and server generation
  checks. An unknown outcome retries the original request ID. Advance after
  server acknowledgement; prepared pairs remain advisory and must be
  revalidated. Invalidate stale preparation after context changes or resets.
- Distinguish network failure from session expiry. Expiry retains resumable
  state for sign-in; explicit logout clears private checkpoints after child
  cleanup has flushed them.
- Reuse shared media components and URL/cache helpers. Keep speculative media
  bounded by concurrency, connection, bytes, and dimensions; cancel work while
  hidden or obsolete. Retain a thumbnail until the current original decodes,
  and preserve video first-frame and fallback behavior.

### Interface And PWA

Component and style paths below are relative to `apps/web/src`; PWA entry points
use full repository-relative paths.

- Reuse `components/ui` primitives and shared viewer, annotation, and curation
  controls. Feature CSS owns layout; shared appearance belongs in existing
  theme/foundation tokens. Use the shared keyboard and motion helpers.
- Preserve accessible names, visible focus, keyboard-layer guards, destructive
  confirmation dialogs, and reduced-motion support. Do not add decorative glow
  effects or disable browser zoom.
- Keep `hooks/use-mobile.ts` and the compact-layout queries in `styles/responsive.css`
  aligned, including coarse-pointer landscape screens. Preserve safe areas,
  dynamic viewport sizing, reachable touch controls, and phone input sizing.
- PWA sources are `apps/web/pwa/service-worker.js`, `apps/web/vite.config.ts`,
  `apps/web/src/lib/register-service-worker.ts`, `apps/web/index.html`, and
  `apps/web/public/manifest.json`.
  Cache only the public application shell; bypass private API/media requests.
  Updates must not force a running session to reload. Edit sources, not `dist`.

## Tests And Accompanying Updates

Add regression coverage for changed behavior at the lowest useful level:
pure/helper tests, repository/API integration tests, or browser flows. Include
relevant failure, cancellation, stale-response, and data-safety cases. Avoid
tests that merely restate the implementation or unrelated test expansion.

Run `npm run verify` before completing a change. Run browser tests for changes
to user flows, authentication, scanning, media delivery, restoration, or data
maintenance. Test desktop and phone layouts for interface changes, and use the
[release checklist](docs/release-checklist.md) for container and release checks.
Browser emulation does not establish actual iPhone Home Screen behavior; report
device verification separately.

Maintain only the documentation and supporting files affected by the change:

| Change                                       | Accompanying updates                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User-visible behavior                        | `docs/user-guide.md`, the embedded `apps/web/src/components/guide/UserGuidePage.tsx` when applicable, `CHANGELOG.md`, and relevant browser coverage                            |
| Configuration or defaults                    | Config parsing/validation and tests, the appropriate `.env.example` or `private.env.example`, `docs/configuration.md`; installation, README, or Compose settings when affected |
| Schema, identity, backup, or reset behavior  | Migration/schema validation and compatibility tests; `docs/architecture.md` and `docs/data-management.md` when the contract changes                                            |
| Authentication, paths, caching, or privacy   | Failure/privacy tests and `docs/security.md`; `SECURITY.md` only when the vulnerability-reporting policy changes                                                               |
| Navigation, lifecycle, media, or PWA         | Restoration/media/browser tests and `docs/architecture.md`; security and release checks when storage or deployment behavior changes                                            |
| Dependencies, scripts, runtime, or packaging | Relevant workspace manifests and root lockfile; Docker/Compose/CI and development/installation docs when affected                                                              |
| Module structure or conventions              | Architecture or engineering docs and this file                                                                                                                                 |
| Documentation added or moved                 | `docs/README.md` and incoming links                                                                                                                                            |

## Completion And Maintenance

- Remove obsolete code and keep the final diff focused. Keep mechanical
  formatting separate from behavior changes when practical.
- Do not track media, databases, caches, backups, secrets, private paths, build
  output, `.e2e`, test artifacts, or temporary audit reports. Keep comments,
  documentation, and commit messages factual; omit session narratives,
  tool/session credits, and generated-by notices. Preserve required copyright
  and license notices.
- Review `git diff --check` and the final working-tree status. Report what
  changed, which checks actually ran, and any unavailable checks or remaining
  limitations. Do not describe skipped checks as passing.
- Keep this guide current when commands, entry points, conventions, or required
  checks change. Link to the detailed docs rather than duplicating them. Do not
  add session history, temporary machine paths, or hard-coded test totals here.
