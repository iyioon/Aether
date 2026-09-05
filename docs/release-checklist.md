# Release Checklist

Use this checklist before tagging a public release.

## Source Hygiene

- No `.env`, `.env.local`, SQLite databases, cache files, media files, screenshots, or generated build output are staged.
- Internal planning notes remain ignored.
- README and docs describe the current behavior.
- `.env.example` contains every supported public setting without real secrets.

## Verification

```bash
npm run verify
npm run test:e2e
docker compose config -q
```

For Docker image validation:

```bash
docker compose build
```

Remove local build outputs afterward if they appear in the working tree.

## Security

- `AETHER_PASSWORD_HASH` is required for real use.
- `AETHER_SESSION_SECRET` is set and at least 32 characters in production.
- Media mounts are read-only.
- Direct LAN exposure is intentional and protected by a firewall.
- HTTPS is enabled before `AETHER_COOKIE_SECURE=true`.
- Any AI provider remains disabled unless explicitly configured by the operator.

## Tagging

```bash
git status --short
git tag v0.1.0
git push origin main --tags
```

Use semantic versioning once releases become user-facing.
