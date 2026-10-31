# Changelog

Notable changes to Aether are recorded here.

## Unreleased

### Added

- HEIC/HEIF photo thumbnails, full-resolution browser display and framing,
  retaining orientation, alpha and color profiles with original downloads.

- Saved media presentation with source-time highlights, speed, Repeat/Bounce,
  independent aspect frames, Fit/Fill, position and zoom. Support controlled
  GIF, WebP, APNG and AVIF playback, selected-start posters, and separate
  playback/framing resets.
- Shared Feed and viewer controls for playback, seeking, sound and fullscreen,
  with reachable touch targets and iPhone safe-area spacing.
- Slim loading bars above media in Gallery, Feed, Compare and the viewer,
  including while saved Bounce playback is being prepared.
- Gallery context actions for Info, Edit media and Download with right-click,
  keyboard or touch hold. Edit and Download also remain in the viewer toolbar.
- Offline interface recovery, while private media and metadata remain online.

### Changed

- Reuse prepared Bounce video and timing metadata without repeating source-frame
  analysis, prioritize active Feed playback over bounded next-item preparation,
  and show the slim loading bar during video buffering.
- Use compact, themed media notices with specific preparation and playback
  errors, and add sound controls to editor previews.
- Add editor-wide Framing arrows and zoom shortcuts, with Shift for precise
  adjustments. Editor timelines use 100 ms arrow steps, 1 ms with Shift and
  one-second Page steps while preserving focused controls.
- Switch User guide topics with tabs and simplify the instructions for desktop
  and phone layouts.
- Group filters, sorting and layout in View options with a phone bottom sheet.
  Keep Gallery search and buttons on one row and show active-filter counts.
- Keep Feed in a portrait frame with attached controls/details, saved Portrait
  framing, floating phone controls, an inline favorite indicator and consistent
  up-arrow score icons. Gallery
  and Ranking remember independent shapes and card details; Ranking initially
  uses Original proportions.
- Make Edit media fullscreen with Playback/Framing tabs, one persistent preview
  and timeline, explicit Save/Cancel, and independent drafts for each aspect.
  Offer Fit/Fill only while retaining older Auto settings.
- Let the viewer apply saved framing through View options. Remember its on/off
  choice in this browser through navigation, reopen, reload and sign-out,
  without changing playback or saved edits. Comparison can play highlights
  while keeping normal-speed forward repeat.

### Fixed

- Recover editor previews when saved settings are reloaded, show current input
  errors before earlier save failures, and stop closed editors from starting
  another save. Reject mixed media versions during loading and save recovery.
- Coordinate presentation publication, saves and resets with cache cleanup so
  overlapping changes cannot remove a current rendition. Detect physical source
  replacements in shared validation and in-memory media caches.
- Drain processing from disconnected requests before shutdown releases the
  database, temporary work and runtime lock.
- Show newly saved Bounce sections immediately, preserve the view preference
  for framing-only edits, and keep save errors visible beside Save. Reconcile
  delayed saves before retrying and close the editor only after confirmation.
- Prepare Bounce with FFmpeg 9 using the current filter-file option while
  retaining older FFmpeg compatibility.
- Enable Bounce for supported full-range SDR MOV recordings while preserving
  decoded pixels, color range and timing in both playback codecs.
- Retain viewer thumbnails through capability checks, original-image loading
  and retries. Show selected highlight posters until playback is ready and
  prevent previous media from appearing during navigation.
- Use the same exact file timestamp for scanning, editing and media access to
  prevent false source-change warnings on files with nanosecond timestamps.
- Prepare video Bounce sections up to 30 seconds with bounded processing memory
  and private temporary storage, preserving source frames and timing.
- Disable automatic GitHub checks; retain the workflow for optional manual use.
- Keep native temporary work under the data directory, prune obsolete previews
  and scan/authentication history, and guard interrupted restore recovery.
- Verify source, cached and public static file descriptors before streaming;
  revalidate private media, clear private in-memory media state on sign-out, and
  request browser cache clearing on secure logout.

- Keep thumbnails/posters sharp and consistently framed until the source is
  ready; missing posters no longer block supported video playback. Repeat
  highlights use original video with a complete compatibility fallback.
- Preserve supported video frames and timing in cached, silent lossless Bounce
  output, with explicit format, browser and processing limits. Retain rotation
  through FFmpeg 6 display-matrix handling and reject sheared source matrices.
- Preserve explicit pause, keep Info from interrupting playback, and hide
  controls together when media is tapped. Prevent audible playback from
  restarting after backgrounding.
- Restore navigation, scrolling, Settings tabs, viewer items, comparison pairs
  and Undo after returning. Retry interrupted comparison choices without
  duplicate changes and prepare upcoming media within connection/resource limits.
- Update Fastify, Zod, URI parsing, Vite and Vitest to patched releases.

## 0.1.0 - 2026-10-11

### Added

- Private photo and video browsing with gallery, feed, fullscreen, and
  comparison views.
- Search, filters, tags, favorites, scores, batch editing, and pairwise ranking.
- Authenticated media streaming, video seeking, downloads, image thumbnails,
  video posters, and browser-friendly previews.
- Stable media identity that keeps metadata when a uniquely matched file or
  named media root moves.
- One Aether data directory with backup, status, rebuild, and guarded wipe
  commands.
- Password authentication, server-side sessions, CSRF protection, sign-in
  throttling, path containment checks, and hardened container defaults.
- Optional local Ollama-compatible tag suggestions, disabled by default.
- Unit, integration, browser, formatting, lint, type, build, and container
  checks.
