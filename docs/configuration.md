# Configuration

Aether reads environment variables from the shell, `.env`, and `.env.local`. Local files are intentionally ignored by Git.

## Core Settings

| Variable | Default | Description |
| --- | --- | --- |
| `AETHER_HOST` | `127.0.0.1` | API bind address. Use `0.0.0.0` only for trusted LAN or container use. |
| `AETHER_PORT` | `3030` | API port. |
| `AETHER_WEB_HOST` | `127.0.0.1` | Vite development server host. |
| `AETHER_API_PROXY_HOST` | `127.0.0.1` | API host used by the Vite dev proxy. |
| `AETHER_MEDIA_ROOTS` | empty | Comma-separated media folders. Escape literal commas as `\,`. |
| `AETHER_CONFIG_DIR` | `./config` | SQLite database and persistent app state. |
| `AETHER_CACHE_DIR` | `./cache` | Generated thumbnails, posters, and preview clips. |
| `AETHER_WEB_DIST` | `apps/web/dist` | Built web app directory served by the production server. |

## Auth Settings

| Variable | Default | Description |
| --- | --- | --- |
| `AETHER_PASSWORD_HASH` | empty | Argon2id password hash. Required to use protected routes. |
| `AETHER_SESSION_SECRET` | dev-only fallback | Cookie signing secret. Required in production and must be at least 32 characters. |
| `AETHER_SESSION_TTL_DAYS` | `14` | Session lifetime, from 1 to 90 days. |
| `AETHER_COOKIE_SECURE` | production: `true`, development: `false` | Set `true` only behind HTTPS. |
| `AETHER_TRUST_PROXY` | `false` | Set `true` only behind a trusted reverse proxy. |
| `AETHER_LOGIN_MAX_ATTEMPTS` | `10` | Failed login attempts before lockout. |
| `AETHER_LOGIN_WINDOW_MINUTES` | `15` | Failed login counting window. |
| `AETHER_LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration. |

Generate a password hash:

```bash
npm run hash-password -w @aether/server -- "choose-a-strong-password"
```

Generate a session secret:

```bash
openssl rand -base64 48
```

## Watcher Settings

| Variable | Default | Description |
| --- | --- | --- |
| `AETHER_WATCH_ENABLED` | `true` outside tests | Watches media roots and schedules debounced scans after changes. |
| `AETHER_WATCH_DEBOUNCE_MS` | `2000` | Delay before a watcher-triggered scan. |

Disable watching for unstable network mounts or extremely large trees:

```bash
AETHER_WATCH_ENABLED=false
```

Manual scans remain available from the sidebar.

## Local AI Tag Suggestions

| Variable | Default | Description |
| --- | --- | --- |
| `AETHER_AI_PROVIDER` | `disabled` | Set to `ollama` to enable local vision suggestions. |
| `AETHER_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama-compatible endpoint. |
| `AETHER_OLLAMA_VISION_MODEL` | `llava:latest` | Vision model name. |
| `AETHER_AI_TIMEOUT_MS` | `45000` | Request timeout. |

AI suggestions are opt-in and local-provider only. A suggestion is not saved until the user applies it.
