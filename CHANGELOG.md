# Changelog

Notable changes to Aether are recorded here.

## Unreleased

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
