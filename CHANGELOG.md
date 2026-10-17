# Changelog

Notable changes to Aether are recorded here.

## Unreleased

- Align View options typography with selection controls and tighten its spacing.
  Keep Gallery search and buttons on one row, using a compact view menu on
  narrow screens. Preserve leaderboard position when opening Settings changes
  the header height.
- Add View options to mobile Feed and hide both top controls with details and
  playback controls when the media is tapped.
- Combine sorting, filters, and Gallery layout in one View options panel, with
  a phone bottom sheet, active-filter count, and immediate changes.
- Compact Feed and viewer video controls into one row, with time labels above
  the timeline, full-size touch targets, and preserved iPhone safe-area spacing.
- Replace the mobile Feed header with a floating view selector at the top right,
  keeping media full height and navigation within the safe area.
- Let expanded Feed media extend behind the iPhone Home Screen status bar where
  iOS permits, with a readability gradient and safe-area spacing for controls.
- Blend Feed titles and playback controls over one continuous gradient, and
  overlay viewer controls so tall media can use the full available height.
- Hide and reveal Feed playback controls together with details when tapping the
  media, while preserving playback and pause state.
- Keep portrait video previews inside gallery cards so cropped layouts play
  correctly and center the media.
- Remove failed video posters from the viewer and previews while allowing
  supported videos to keep playing.
- Add shared Feed and viewer video controls with seeking, buffered progress,
  sound, fullscreen, and iPhone safe-area spacing. Preserve explicit pause and
  prevent audible playback from restarting after backgrounding.
- Prepare upcoming comparison pairs and media in the background, limit requests
  on slow connections, and check each transition on the server.
- Restore navigation, comparison pairs and Undo, Settings tabs, fullscreen items,
  and scroll positions after reopening the app.
- Recover interrupted comparison requests without duplicate changes, and clear
  saved state after sign-out or comparison resets.
- Add offline interface recovery and improve phone layouts, safe areas, and
  touch controls.

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
