# Changelog

## Unreleased

- Added a responsive score leaderboard as the main comparison workspace, with filtered pagination, fullscreen inspection, and a direct path into and back from pairwise ranking.
- Smoothed iPhone video startup, replay, and comparison changes by retaining decoded posters until Safari presents a video frame and preloading the next comparison posters before swapping pairs.
- Improved comparison performance with poster-only leaderboard media, display-sized row thumbnails, canceled stale requests, paused hidden playback, a single-request decision pipeline, and allocation-efficient ranking calculations.
- Improved application-wide efficiency with abortable stale reads, ordered and coalesced score mutations, memoized media and folder rows, constant-time feed position lookup, and batched scroll-state persistence.
- Reduced server work with unchanged-file scan fast paths, set-based batch annotation hydration, lightweight media-source queries, bounded session activity writes, concurrent thumbnail deduplication, and shared video metadata probes.
- Refactored ranking math, asset filtering, comparison UI, score details, and route registration into focused modules with shared rules and deterministic tests.
- Added repository-wide ESLint and Prettier quality gates plus documented engineering, accessibility, state-management, and shadcn composition standards.
- Split major web workspaces and media overlays into on-demand bundles, removing the production chunk-size warning while keeping a shared accessible loading state.

- Added a concise in-app User Guide covering setup, browsing views, ranking, organization, keyboard controls, and source-file privacy.
- Preserved existing and newly adjusted manual scores when comparison ranking starts, changes, or is fully undone, without adding an arbitrary score cap.
- Unified score terminology across the API, interface state, repository model, and database while preserving existing annotations and ranking data during migration.
- Standardized zero as the default unranked score across storage, APIs, controls, and filters, migrating earlier null values safely.
- Added an explicit score breakdown with actions to remove a manual adjustment or reset an item's active comparisons after confirmation.
- Added a protected Database settings tab for transactionally resetting selected scores, favorites, tags, or comparison history without touching indexed media or source files.
- Added a dedicated comparison workspace with responsive pair cards, keyboard choices, skips, undo, coverage feedback, and filtered candidate selection.
- Added reversible pairwise decision history and regularized Bradley–Terry ranking projections that feed into media scores without discarding manual score adjustments.

- Refined the vertical feed with minimal overlay controls, consistent navigation and action styling, press-and-hold video pause, and a bottom-edge seek timeline.
- Added thumbnail-first progressive loading that crossfades feed images to their decoded full-resolution originals.
- Changed feed videos to prefer the original authenticated stream, with poster-first startup and a browser-compatible preview fallback.
- Fixed odd-dimension video preview generation and improved poster behavior during refresh and playback startup.
- Unified shared button hover, active, and translucent overlay states across gallery, viewer, selection, and feed surfaces.
- Kept active favorite hearts consistently red across individual and batch controls.
- Polished gallery loading placeholders with restrained breathing and sweep motion, including reduced-motion support.
- Improved narrow-screen path-bar layout so the sidebar trigger and library controls remain accessible.
- Prepared public README and documentation set.
- Added release metadata, security policy, contribution guide, and CI workflow.
- Documented local development, Docker, configuration, security, architecture, and release checks.
