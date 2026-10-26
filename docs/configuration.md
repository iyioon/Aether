# Configuration

Aether keeps values supplied by the shell. It then reads `.env` followed by
`.env.local`, so `.env.local` wins when both files set the same value. After it
finds `AETHER_DATA_DIR`, it fills in any remaining settings from `private.env`
in that directory. Keep secrets in `private.env`; it is part of the
one-directory reset model and is ignored by Git.

Changes take effect after Aether restarts. The Settings page shows a safe
summary without returning secrets or absolute paths to the browser.

## Main Settings

| Variable                | Default         | Purpose                                                        |
| ----------------------- | --------------- | -------------------------------------------------------------- |
| `AETHER_DATA_DIR`       | `./aether-data` | Database, cache, backups, private settings, and runtime files. |
| `AETHER_MEDIA_ROOTS`    | empty           | Comma-separated named media folders.                           |
| `AETHER_HOST`           | `127.0.0.1`     | Server bind address. Use `0.0.0.0` only for a protected setup. |
| `AETHER_PORT`           | `3030`          | Server port.                                                   |
| `AETHER_WEB_HOST`       | `127.0.0.1`     | Vite development server host.                                  |
| `AETHER_API_PROXY_HOST` | `127.0.0.1`     | API host used by the Vite development proxy.                   |
| `AETHER_WEB_DIST`       | `apps/web/dist` | Built web app served in production.                            |

The data directory has this layout:

```text
aether-data/
  .aether-data.json
  private.env
  config/
  cache/
  backups/
  tmp/          # private process work, cleaned after use
  runtime.lock  # present only while Aether is running
```

The marker file identifies a valid Aether data directory. The data maintenance
commands refuse unsafe or unmarked targets. Do not place the data directory
inside a media root, or a media root inside the data directory.

The first server start creates the marker and managed subdirectories. A new
directory may contain `private.env` before that first start, but no unrelated
files.

To use another location, copy `.env.example` to `.env.local` and change its
single `AETHER_DATA_DIR` value. Create `private.env` inside the selected
directory from `private.env.example`. Keep `.env.local` free of media paths and
secrets.

## Media Roots

Give every root a short, stable name:

```bash
AETHER_MEDIA_ROOTS=archive=/Volumes/MediaArchive,photos=/mnt/photos
```

The name lets Aether recognize the same library after a mount point or folder
path changes. Keep the name unchanged and edit only the path. Multiple roots
are separated with commas. Escape a comma that is part of a folder name:

```bash
AETHER_MEDIA_ROOTS=documents=/mnt/archive/exam\,papers
```

Root names may contain letters, numbers, periods, underscores, and hyphens.

## Sign-In And Sessions

| Variable                       | Default                                  | Purpose                                                      |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| `AETHER_PASSWORD_HASH`         | empty                                    | Argon2id password hash. Required for normal use.             |
| `AETHER_SESSION_SECRET`        | development-only fallback                | Cookie secret. Must be at least 32 characters in production. |
| `AETHER_SESSION_TTL_DAYS`      | `14`                                     | Session lifetime, from 1 to 90 days.                         |
| `AETHER_COOKIE_SECURE`         | production: `true`, development: `false` | Sends cookies only over HTTPS when enabled.                  |
| `AETHER_TRUST_PROXY`           | `false`                                  | Trusts proxy headers. Use only behind your own proxy.        |
| `AETHER_LOGIN_MAX_ATTEMPTS`    | `10`                                     | Failed attempts allowed during the counting window.          |
| `AETHER_LOGIN_WINDOW_MINUTES`  | `15`                                     | Failed-attempt counting window.                              |
| `AETHER_LOGIN_LOCKOUT_MINUTES` | `15`                                     | Lockout duration.                                            |

Generate the two required values:

```bash
npm run hash-password -w @aether/server
openssl rand -base64 48
```

The password command uses a hidden prompt. For automation, send the password
through standard input with `--stdin`; never put it on the command line.

## File Watching

| Variable                   | Default              | Purpose                                      |
| -------------------------- | -------------------- | -------------------------------------------- |
| `AETHER_WATCH_ENABLED`     | `true` outside tests | Starts a new scan after source files change. |
| `AETHER_WATCH_DEBOUNCE_MS` | `2000`               | Wait before a watcher-triggered scan.        |

Set `AETHER_WATCH_ENABLED=false` for unreliable network mounts or very large
trees. Manual scanning remains available.

## Backup Location

Backups go to `AETHER_DATA_DIR/backups` by default. `AETHER_BACKUP_DIR` can set
another default for the backup command, and `--output` can override it for one
run. Either option may place copies outside the one-directory wipe. See
[Data management](data-management.md) before using an external location.

## Optional Tag Suggestions

| Variable                     | Default                  | Purpose                                          |
| ---------------------------- | ------------------------ | ------------------------------------------------ |
| `AETHER_AI_PROVIDER`         | `disabled`               | Set to `ollama` to enable image tag suggestions. |
| `AETHER_OLLAMA_BASE_URL`     | `http://127.0.0.1:11434` | Ollama-compatible endpoint.                      |
| `AETHER_OLLAMA_VISION_MODEL` | `llava:latest`           | Vision model name.                               |
| `AETHER_AI_TIMEOUT_MS`       | `45000`                  | Request timeout.                                 |

Suggestions are never saved until the user applies them. Aether sends a resized
image, its filename, and existing tags to the configured endpoint, so keep that
endpoint local unless you intend to share those details.

When Aether runs in Docker and Ollama runs on the host, use
`http://host.docker.internal:11434` instead of `127.0.0.1`. Docker Desktop
provides that hostname. On Linux, add
`host.docker.internal:host-gateway` under the Compose service's `extra_hosts`.
