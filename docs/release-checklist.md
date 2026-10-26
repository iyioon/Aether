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
npm audit --omit=dev
npm run verify
npm run test:e2e
docker compose config -q
docker compose build
docker build --target media-verification .
```

Review any skipped test instead of treating a partial run as a release pass.

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

- In Gallery, Feed, viewer and Comparison, open the same editor. Check that
  Cancel discards drafts, Save survives reload, Reset needs Save, and editing
  cannot vote, navigate, favorite or score accidentally.
- Use a video plus variable-delay/transparent GIF, WebP, APNG and AVIF. Save a
  highlight, speed and loop preference. Turn Play highlights only on/off,
  verify selected-start posters, source-time seeking, exact range, silent video
  bounce and retained animation transparency. Test a first-time preparation,
  failure/retry, unsupported or over-budget file, and a changed source before scan.
- Test Fit/Fill/Auto, drag, pinch, keyboard movement and zoom across card shapes,
  viewer and both orientations. Comparison aspect changes retain pair/Undo and
  temporal playback remains full/1×/repeat.
- Save from two tabs to check conflict/reload; interrupt a Save response and
  verify retry cannot overwrite newer settings. Reset only playback or framing
  and confirm other edits, scores, tags, favorites, navigation and Undo survive.
- On an actual installed iPhone PWA, check editor header/footer and input keyboard
  in portrait/short landscape, slider handles with VoiceOver, pinch without page
  navigation, hidden Feed chrome, safe-area touch targets, pause through Home/
  return, and native fullscreen section bounds. Record real-device acceptance
  separately from browser emulation.

## Security

- A strong password hash and unique session secret are set.
- Source media is mounted read-only.
- The service binds to localhost unless direct LAN exposure is deliberate.
- Trusted HTTPS supports regular Home Screen access; a VPN can restrict network access.
- Secure cookies are enabled only after HTTPS works.
- Proxy headers are trusted only from the configured reverse proxy.
- Optional tag suggestions remain disabled unless the destination is understood.
- External backups are tracked and removed separately when required.

## Release

```bash
git status --short
git tag -a v0.1.0 -m "Aether v0.1.0"
git push origin main
git push origin v0.1.0
```

Use semantic versioning for published releases. Change the example version to
the version being released.
