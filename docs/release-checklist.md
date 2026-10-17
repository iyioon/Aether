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
- Test both an existing Home Screen icon after closing and reopening the app
  for an update, and a fresh installation. Expand Feed on a later item: media
  should fill the viewport iOS exposes, with a readable clock, and retain the
  item through rotation. Reveal controls and check header, sidebar, viewer,
  sign-in, and offline recovery in both themes. Record the iOS version if the
  system still reserves a top strip; do not treat desktop emulation as proof of
  iPhone status-bar behavior.
- Check video controls above the Home indicator and landscape side insets.
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
