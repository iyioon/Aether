# Installation

Aether can run directly from Node.js for development, or through Docker Compose for a home-server deployment.

## Local Development

Requirements:

- Node.js 24 or newer.
- npm.
- FFmpeg and ffprobe available on `PATH` for video posters, preview clips, and metadata.

```bash
git clone https://github.com/iyioon/Aether.git
cd Aether
npm install
cp .env.example .env.local
```

Create a password hash:

```bash
npm run hash-password -w @aether/server -- "choose-a-strong-password"
```

Paste the printed value into `AETHER_PASSWORD_HASH` in `.env.local`.

Create a session secret:

```bash
openssl rand -base64 48
```

Paste the value into `AETHER_SESSION_SECRET`.

Use `./media` for a first run, or set `AETHER_MEDIA_ROOTS` to absolute paths:

```bash
AETHER_MEDIA_ROOTS=/mnt/photos,/mnt/videos
```

Start the app:

```bash
npm run dev
```

The API runs on `http://127.0.0.1:3030`. The web app runs on `http://127.0.0.1:5173`.

## Trusted LAN Preview

For temporary phone or tablet testing on the same trusted network:

```bash
npm run dev:lan
```

Open the network URL printed by Vite. Do not use this as a long-lived deployment mode.

## Docker Compose

```bash
cp .env.example .env
# Fill AETHER_PASSWORD_HASH and AETHER_SESSION_SECRET
docker compose up --build
```

The default Compose setup mounts:

- `./media` as read-only source media.
- `./config` for SQLite and local configuration state.
- `./cache` for generated thumbnails, posters, and preview clips.

The service listens on `127.0.0.1:3030` by default. Put a reverse proxy in front of it for HTTPS or remote access.

## Updating

```bash
git pull
npm install
npm run verify
```

For Docker:

```bash
docker compose build
docker compose up -d
```

Back up `./config` before upgrading a long-lived library.
