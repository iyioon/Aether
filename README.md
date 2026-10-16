# Aether

Aether is a private, self-hosted gallery for photo and video folders you already
own. It indexes media in place, then provides a browser interface for browsing,
searching, tagging, scoring, comparing, and downloading it.

Aether does not include a hosted upload service and does not modify source
files. Optional tag suggestions send a resized preview only to the endpoint you
configure. Aether is intended for a home server or another trusted machine, not
as a public media service.

## Highlights

- Gallery, vertical feed, fullscreen viewer, and pairwise comparison views.
- Search, tags, favorites, scores, filters, and batch editing.
- Authenticated image and video delivery with video seeking.
- Cached thumbnails, posters, and browser-friendly video previews.
- One password, server-side sessions, login throttling, and CSRF protection.
- Multiple named media roots that can move without losing their identity.
- One local data directory for the database, cache, backups, and private settings.
- Optional Ollama-compatible image tag suggestions, disabled by default.
- Local Node.js development and a hardened Docker Compose setup.

## Requirements

- Node.js 24 or newer
- npm
- FFmpeg and ffprobe
- Docker and Docker Compose, if you prefer a container

## Quick Start

```bash
git clone https://github.com/iyioon/Aether.git
cd Aether
npm install
mkdir -p aether-data
chmod 700 aether-data
cp private.env.example aether-data/private.env
chmod 600 aether-data/private.env
npm run hash-password -w @aether/server
openssl rand -base64 48
```

Put the password hash and session secret into
`aether-data/private.env`. Add media under `./media`, or set one or more named
folders:

```bash
AETHER_MEDIA_ROOTS=photos=/mnt/photos,videos=/mnt/videos
```

Keep each name stable if the folder moves. Escape a comma inside a path as
`\,`.

Start Aether:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`, sign in, and start a library scan from the
sidebar.

For short-lived testing from a phone or tablet on the same trusted network, use
`npm run dev:lan`. Use trusted HTTPS for regular Home Screen access. A private
VPN can restrict network access to your server.

## Docker

```bash
mkdir -p aether-data
chmod 700 aether-data
cp private.env.example aether-data/private.env
chmod 600 aether-data/private.env
# Fill in the password hash and session secret.
export AETHER_UID="$(id -u)"
export AETHER_GID="$(id -g)"
docker compose up --build -d
```

The default Compose service listens only on `127.0.0.1:3030`. Its single
`./aether-data:/data` mount contains all Aether-managed server data. Source
media is mounted separately and read-only.

The UID and GID settings let the container write to `./aether-data` without
making it broadly writable. Docker Desktop users can usually omit them and use
the Compose defaults. See [Installation](docs/installation.md) for Ollama and
Linux notes.

## Resetting Aether

Inspect the current data directory at any time:

```bash
npm run data:status
```

Stop Aether before rebuilding or wiping it:

```bash
npm run data:rebuild -- --confirm-rebuild
npm run data:wipe -- --confirm-wipe
```

`data:rebuild` clears the index and generated cache but keeps private settings.
`data:wipe` removes the entire Aether data directory. Neither command deletes
source media. See [Data management](docs/data-management.md) before wiping a
library.

## Documentation

- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [User guide](docs/user-guide.md)
- [Data management](docs/data-management.md)
- [Security](docs/security.md)
- [Development](docs/development.md)
- [Architecture](docs/architecture.md)
- [Release checklist](docs/release-checklist.md)

## Verification

```bash
npm run verify
npm run test:e2e
docker compose config -q
```

`npm run verify` runs formatting checks, linting, type checks, tests, and
production builds.

## Contributing And Security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Report security
issues through the private process in [SECURITY.md](SECURITY.md).

## License

MIT
