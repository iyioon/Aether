# Security

Aether is designed for a private home server or trusted LAN. It should not be exposed directly to the public internet.

## Security Model

- One password protects the application.
- Passwords are verified with Argon2id hashes.
- Failed login attempts are throttled and locked out separately from normal browsing.
- Authenticated library and media browsing is not globally request-limited, so large galleries and video range requests can load normally on a trusted LAN.
- Sessions are stored server-side and referenced by signed cookies.
- Mutating API routes require a CSRF token.
- API responses default to `Cache-Control: no-store`.
- Browser hardening headers include CSP, frame denial, and no-sniff behavior.
- Source media is served by opaque asset IDs, not by raw filesystem paths.
- Media roots are resolved to canonical paths and checked against symlink escapes.
- The Settings page only exposes sanitized configuration status, never secrets or absolute filesystem paths.

## Deployment Defaults

The Compose file binds to `127.0.0.1:3030` by default. This keeps Aether reachable from the host and from a reverse proxy on that host, but not directly from other machines.

The container runs as the non-root `node` user, drops Linux capabilities, sets `no-new-privileges`, uses a read-only root filesystem, and mounts source media read-only.

## HTTPS And Proxies

When Aether is reachable beyond the host machine, place it behind HTTPS and set:

```bash
AETHER_COOKIE_SECURE=true
AETHER_TRUST_PROXY=true
```

Example Caddy config:

```caddyfile
aether.home.arpa {
  reverse_proxy 127.0.0.1:3030
}
```

## Secrets

Never commit `.env`, `.env.local`, `config`, `cache`, or media folders. Rotate `AETHER_SESSION_SECRET` if it is exposed. Existing sessions become invalid after rotation.

## Backups

Back up `AETHER_CONFIG_DIR`; it contains SQLite state for library metadata, ratings, favorites, tags, sessions, and derivative records.

```bash
npm run backup -- --output ./backups
```

Use `--include-cache` to include generated thumbnails, posters, and preview clips. Source media should have its own backup policy.

## AI Privacy

AI tag suggestions are disabled by default. When enabled, Aether sends a resized image preview to the configured local Ollama-compatible endpoint. Do not point that endpoint at an external model service unless you are comfortable sending private media-derived previews there.

## Limitations

Password-only access is intentionally simple. It does not provide per-user permissions, audit logs, device management, or account recovery. Use a VPN, firewall, and HTTPS reverse proxy before any remote access.
