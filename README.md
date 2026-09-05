# Aether

Aether is a self-hosted media gallery for private photo and video libraries. It reads one or more local folders, indexes the media inside them, and gives you a fast browser UI for browsing, searching, rating, tagging, downloading, and rediscovering your collection.

It is built for a home server or trusted local network. Aether does not require cloud storage, public hosting, or an external account.

## Features

- Password-protected web interface with server-side sessions and CSRF protection.
- Folder tree that mirrors the configured media roots.
- Virtualized gallery grid for large folders, with size, aspect-ratio, and sort direction controls.
- Vertical feed mode for one-item-at-a-time browsing.
- Fullscreen viewer for images and videos.
- Ratings, favorites, tags, tag suggestions, and batch annotation tools.
- Filename/path search, including CJK substring matching for Korean and similar scripts.
- Authenticated media streaming with HTTP range support for video seeking.
- Lazy thumbnails, video posters, and short preview clips stored in a local cache.
- Animated image support for GIF, animated WebP, AVIF, and APNG-style files.
- Settings page for browser-local appearance preferences, library controls, and read-only server/security status.
- Optional local Ollama vision tag suggestions, disabled by default.
- Docker Compose setup with read-only media mounts and local SQLite storage.

## Requirements

- Node.js 24 or newer.
- npm.
- FFmpeg and ffprobe for video metadata, posters, and preview clips.
- Docker, if you want the containerized home-server setup.

## Quick Start

```bash
git clone https://github.com/iyioon/Aether.git
cd Aether
npm install
cp .env.example .env.local
npm run hash-password -w @aether/server -- "choose-a-strong-password"
```

Copy the printed hash into `AETHER_PASSWORD_HASH` in `.env.local`, then create a session secret:

```bash
openssl rand -base64 48
```

Put that value into `AETHER_SESSION_SECRET`. Add media files under `./media`, or set `AETHER_MEDIA_ROOTS` to one or more comma-separated folders.

Start the development app:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`, sign in, then use the scan button in the sidebar to index the configured folders.

## Docker

```bash
cp .env.example .env
# Fill AETHER_PASSWORD_HASH and AETHER_SESSION_SECRET in .env
docker compose up --build
```

The default Compose file binds Aether to `127.0.0.1:3030`. That keeps it local to the host and ready for a reverse proxy. Change the port binding only when you understand the network exposure.

## Documentation

- [Installation](docs/installation.md)
- [User guide](docs/user-guide.md)
- [Configuration](docs/configuration.md)
- [Security](docs/security.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Release checklist](docs/release-checklist.md)

## Verification

```bash
npm run verify
npm run test:e2e
```

`npm run verify` runs type checks, unit tests, and production builds. The e2e suite starts isolated local servers and writes temporary fixture media under `.e2e/`.

## License

MIT
