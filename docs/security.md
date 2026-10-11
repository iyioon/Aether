# Security

Aether is designed for a private home server or trusted network. It is not a
multi-user service and should not be placed directly on the public internet.

## Trust Model

- One shared password protects the app.
- Passwords are checked with Argon2id hashes.
- Sessions are stored on the server and referenced by signed cookies.
- Failed sign-ins are throttled and temporarily locked.
- Sign-in throttling stores a keyed digest of the request source, not its raw
  network address.
- Requests that change data require a CSRF token.
- Media routes require a valid session and use asset IDs instead of source paths.
- Aether resolves media paths inside configured roots and rejects symlink escapes.
- The Docker container runs without root privileges or Linux capabilities.
- Docker mounts source media read-only.

The Settings page reports whether important options are enabled, but it does not
send secrets or absolute server paths to the browser.

## Network Access

Docker binds to `127.0.0.1:3030` by default. Keep that setting and use an HTTPS
reverse proxy, or connect through a private VPN.

For an HTTPS proxy, set:

```bash
AETHER_COOKIE_SECURE=true
AETHER_TRUST_PROXY=true
```

Only trust proxy headers when every request passes through a proxy you control.
`npm run dev:lan` uses plain HTTP and is meant only for short tests on a trusted
network.

## Browser Privacy

The page title does not include media names, and media URLs use opaque asset IDs.
Search text and selected tags can appear in the page URL, so they may be kept in
browser history.

Metadata responses are marked `no-store`. Media files and generated previews
use private browser caching so the gallery remains responsive. Signing out or
deleting a source file cannot immediately revoke bytes that a browser already
cached. Downloads, browser history, restored tabs, and mobile app-switcher
screenshots are also controlled by the device, not by Aether.

Use the browser's site-data and download controls when a device must forget a
library.

## Local Data

The database, cache, internal backups, and private settings live under
`AETHER_DATA_DIR`. They are not encrypted by Aether. Protect the host account,
use encrypted storage when needed, and restrict access to the data directory.
On removable or network storage, confirm that file permissions are actually
enforced. Some volumes let every local account act as the file owner; use an
encrypted volume or enable ownership when other local accounts are not trusted.

A successful scan removes database records and generated derivatives for source
files that are confirmed missing. Deleted information may still exist in
browser storage, logs, backups, filesystem snapshots, or storage hardware. See
[Data management](data-management.md) for rebuild and wipe instructions.

## Secrets

Keep password hashes, session secrets, and media-root paths in
`aether-data/private.env`. Never commit that file or the data directory.

Rotate `AETHER_SESSION_SECRET` if it is exposed. This signs every current device
out. Change the password hash as well if the password may be known.

## Backups

`npm run backup` writes inside the Aether data directory by default. It does not
copy `private.env`. A backup created with an external `--output` path will
survive `data:wipe` and must be managed separately.

Source media is never part of an Aether database backup. Back it up with the
storage system that owns it.

## Optional AI Suggestions

AI suggestions are disabled by default. When enabled, Aether sends a resized
image, filename, and existing tags to the configured Ollama-compatible endpoint.
Keep that endpoint local unless you intend to share this information with its
operator.

## Limits

Aether does not provide per-user permissions, account recovery, device
management, public sharing, or a security audit log. Password-only access is a
deliberate fit for a small trusted deployment, not a substitute for network and
device security.
