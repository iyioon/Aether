# Release Checklist

Use this list before a public release or a production update.

## Repository

- The working tree contains only the intended change.
- No database, media, cache, backup, build output, private environment file, or
  test artifact is tracked.
- Examples use generic names and paths.
- Current files and reachable Git history contain no private filenames, paths,
  secrets, or personal data.
- The README, configuration template, and docs match the current behavior.
- New dependencies and generated lockfile changes have been reviewed.

## Verification

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run verify
npm run test:e2e
docker compose config -q
docker compose build
docker build --target media-verification .
```

Review any skipped test instead of treating a partial run as a release pass.
GitHub checks are disabled; run these checks locally. The retained workflow has
manual dispatch only and can be used after re-enabling it in Actions.

## Fresh-Install Test

1. Start from a clean checkout.
2. Copy **private.env.example** to **aether-data/private.env**.
3. Configure a disposable media folder.
4. Start Aether and confirm the health check.
5. Sign in, scan, browse an image and video, edit metadata, and sign out.
6. Restart Aether and confirm the library and metadata return.
7. Confirm **data:status**, **data:rebuild**, and **data:wipe** against disposable
   data.

Never test rebuild or wipe against the only copy of a real library database.

## Phone And PWA Checks

- Verify exact ranking pair and Undo restoration through Settings, reload,
  fresh launch, backgrounding, and sign-in after session expiry.
- Check Gallery, Feed, folder-tree and leaderboard scroll positions, including
  many loaded items, random sorting, and rotation.
- Verify explicit links, Settings tabs, fullscreen restoration and browser
  history.
- Test portrait and short landscape layouts, safe areas, keyboard entry and
  zoom on an actual iPhone Home Screen installation.
- Open View options, switch tabs, add and remove tags with the keyboard open,
  and clear filters. Confirm Gallery search and controls fit one row and the
  compact view menu switches views. Confirm the sheet stays above the Home
  indicator, its header remains reachable while scrolling, and settings survive
  reopening.
- Test both an existing Home Screen icon after closing and reopening the app
  for an update, and a fresh installation. Open Feed on a later item: media
  should fill the viewport iOS exposes, with a readable clock, and retain the
  item through rotation. Check that the top-right view selector and View options
  hide and return with details on a media tap. Change filters and sorting directly
  in Feed, including recovery from an empty result. Switch views and confirm
  filters and browsing position are retained. Check header, sidebar, viewer,
  sign-in, and offline recovery in both themes. Record the iOS version if the
  system still reserves a top strip; do not treat desktop emulation as proof of
  iPhone status-bar behavior.
- Check the single-row video controls above the Home indicator and landscape
  side insets, including readable time labels and scrubbing near slider edges.
  Seek without navigating, changing scores, or hiding focused controls; verify
  browser/native fullscreen exit and explicit pause after Home/return. Confirm
  that audible video waits for Play after returning from the background.
- Check offline shell recovery and reconnection; confirm Cache Storage contains
  no private API or media responses.
- Verify that vote/Undo retries do not create duplicate changes, and comparison
  resets invalidate pending requests from other tabs or devices.
- Check prepared comparison transitions, skipped pairs, Undo, filter changes,
  small libraries, and lost vote responses. Verify bounded background requests,
  data-saving behavior, cancellation while hidden, and video loading on a slow
  connection.

## Presentation Acceptance

- Check the portrait Feed on desktop and phones: centered desktop media,
  controls/details attached to that frame, safe phone controls and an inline
  heart-only favorite indicator. Confirm no aspect selector in Feed, old layout links still
  restore the same item, and Edit starts on the saved Portrait frame.
- Keep a video and animation playing while switching editor tabs; seek in either
  tab, check invalid time entries survive switching, and check loading/Retry/Cancel
  use the same reachable shell. Inspect phone portrait and short landscape.
- In Gallery, verify that hovering a card shows no Edit or Download action;
  right-click, Shift+F10 or touch-hold the preview for Info/Edit/Download. Check
  focus return, scroll cancellation, score/heart holds, download and selection mode. Feed and viewer use a pencil
  for Edit; Comparison cards have no Edit icon. Open the fullscreen editor on
  desktop, phone portrait and short landscape. Check that
  Cancel discards drafts, Save survives reload, Reset needs Save, and editing
  cannot vote, navigate, favorite or score accidentally.
- Use a video plus variable-delay/transparent GIF, WebP, APNG and AVIF. Save a
  highlight, speed and loop preference. Turn Play highlights only on/off,
  verify selected-start posters, source-time seeking, exact range, original-stream
  repeat highlights in Feed/viewer/Comparison and explicit codec fallback. Check
  sharp, consistently framed thumbnail handoff, original-size animation frames, silent video
  bounce and retained animation transparency. Test a first-time preparation,
  failure/retry, unsupported or over-budget file, and a changed source before scan.
- Verify native lossless Bounce with eligible 8/10-bit SDR sources and variable
  frame timing: decoded-frame hashes, timestamps, coded dimensions, SAR, color
  metadata and rotation must match the selected source frames. Confirm no
  repeated endpoints, no audio, cache reuse, and a 30-second selected-section
  limit. Check frame order, bounded working memory, temporary-disk/output
  rejection and cleanup after success, timeout and failure. HDR, Dolby Vision,
  interlaced, odd-sized, nonzero timestamp-origin
  and unsupported inputs must offer Repeat without blocking source playback.
  Validate actual HEVC playback
  and native fullscreen on an iPhone 16 Home Screen installation; record this
  separately from browser codec detection and desktop tests.
- Revisit prepared Bounce files after a server restart. Check cached video and
  timing reuse, source replacement and reset cleanup. In Feed, confirm next-item
  preparation is bounded and yields to current playback. Under a slow connection,
  buffering should show the slim bar over the current frame and resume without
  a reload; an explicit pause must remain paused.
- Check full-range SDR MOV screen recordings in Edit media, Gallery, Feed and
  the viewer. Both Bounce codecs must preserve native decoded frame hashes,
  color range and timing; retain the original download and existing limits.
- Test Fit/Fill, drag, pinch, keyboard movement and zoom across shapes and
  orientations. The grid stays visible in both modes. Legacy Auto displays the
  matching Fit/Fill choice: Original Ranking uses Fit, other card frames use
  Fill. Opening/Cancel must not write assets or change revisions.
- Switch aspects before saving. Independent drafts must survive switching,
  one Save and reload. Gallery/Ranking use the matching saved frame; Feed uses
  Portrait. Check still images, videos and animations.
- Open the viewer from each aspect with no stored preference. Use saved framing
  starts off; enabling it applies the invoking frame without changing time or
  pause. Verify both on and off persist through previous/next, close/reopen,
  reload and sign-out/sign-in. Other browsers keep their own choice; unavailable
  storage must not break viewing. The stored preference contains only a boolean,
  and toggling does not edit saved frames. Native iPhone video fullscreen keeps
  original proportions and system controls.
- Gallery/Ranking remember shape and each view remembers card info. Feed stays
  Portrait; Ranking starts with Original, and both initially hide info.
  Comparison layout changes retain pair/Undo and 1×/repeat while toggling full
  source/highlights.
- Click/tap viewer media to hide/show controls, check idle hiding and keyboard
  focus, and keep video/animation playing while opening and closing Info. Use the
  viewer View options menu with mouse, keyboard and touch, including browser
  fullscreen and phone safe areas. Toggle Play highlights only and confirm the
  library preference agrees. Items without a saved section disable the option
  without clearing it. Keep controls visible while the menu is open; check
  Escape, outside dismissal and focus return without closing the viewer.
- Save from two tabs to check conflict/reload; interrupt a Save response and
  verify retry cannot overwrite newer settings. Also retry after the response
  fails before the first write completes: a matching commit must close the editor
  without another write. Save errors must stay visible beside Save on phones.
  With highlights off, save a Bounce section and check immediate Bounce playback;
  framing-only edits must preserve a deliberately disabled highlight preference.
- After a failed Save, enter an invalid time and confirm its correction message
  appears beside Save. Correct it and retry. Reload after a preview failure and
  concurrent edit; the refreshed image/video must load, while tab and aspect
  switches keep playback available. Closing the editor during retry must not
  start another write or close a subsequently opened editor.
- Use overlapping windows to change a section away and back while its cache is
  being retired; the current rendition must survive. Repeat with a playback
  reset during preparation, and verify that obsolete output is discarded.
- Disconnect a request during preparation and shut down the server. Processing
  must settle before the database, temporary work and runtime lock are released;
  a fresh start must find no partial rendition or stale active ownership.
- Reset only playback or framing and confirm other edits, scores, tags,
  favorites, navigation and Undo survive.
- On an actual installed iPhone PWA, check editor header/footer and input keyboard
  in portrait/short landscape, slider handles with VoiceOver, pinch without page
  navigation, hidden Feed chrome, safe-area touch targets, pause through Home/
  return, and native fullscreen section bounds. Record real-device acceptance
  separately from browser emulation.

## HEIC Acceptance

- Index genuine 8-bit and10-bit SDR HEIC/HEIF photos, including rotated photos,
  transparency, wide-gamut profiles and a48MP iPhone photo.
- Check thumbnails, Feed, Compare, fullscreen viewing and saved framing on
  desktop and an actual iPhone. Confirm original download hashes match sources.
- Restart, replace or remove a source and scan; confirm retired display files and
  thumbnails disappear without changing unrelated settings or source files.
- Check unsupported HDR, corrupt files and decoder/resource limits fail safely.
  Native setup must include the decoder; container checks use the runtime tools.

## Security

- A strong password hash and unique session secret are set.
- Source media is mounted read-only.
- The service binds to localhost unless direct LAN exposure is deliberate.
- Trusted HTTPS supports regular Home Screen access; a VPN can restrict network access.
- Secure cookies are enabled only after HTTPS works.
- Proxy headers are trusted only from the configured reverse proxy.
- Optional tag suggestions remain disabled unless the destination is understood.
- External backups are tracked and removed separately when required.
- Server state and native temporary files remain inside the data directory.
  Check interrupted jobs and a container restart for abandoned-work cleanup.
- Cached private media revalidates authentication after logout; secure logout
  requests browser cache clearing. Browser downloads/history and older caches
  remain device-managed and require separate removal when needed.
- Interrupted restore recovery is inspected before restarting or deleting files;
  maintenance refuses concurrent backup work.

## Release

```bash
git status --short
git tag -a v0.1.0 -m "Aether v0.1.0"
git push origin main
git push origin v0.1.0
```

Use semantic versioning for published releases. Change the example version to
the version being released.
