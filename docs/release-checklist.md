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

## Security

- A strong password hash and unique session secret are set.
- Source media is mounted read-only.
- The service binds to localhost unless direct LAN exposure is deliberate.
- HTTPS or a VPN protects regular access from other devices.
- Secure cookies are enabled only after HTTPS works.
- Proxy headers are trusted only from the configured reverse proxy.
- Optional AI suggestions remain disabled unless the destination is understood.
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
