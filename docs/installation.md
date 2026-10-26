# Installation

Aether can run directly with Node.js or in Docker. Docker is the simpler choice
for a long-running home server.

## Before You Start

You need:

- Node.js 24 and npm for local use
- FFmpeg 5.1 or newer, with matching ffprobe and libx264/libx265 encoders, for
  media metadata and processing
- Docker and Docker Compose for the container setup

Keep source media on a readable local or mounted filesystem. Aether never needs
write access to those folders.

## Local Setup

```bash
git clone https://github.com/iyioon/Aether.git
cd Aether
npm ci
mkdir -p aether-data
chmod 700 aether-data
cp private.env.example aether-data/private.env
chmod 600 aether-data/private.env
```

Generate a password hash:

```bash
npm run hash-password -w @aether/server
```

The command asks twice without showing the password and prints only its hash.

Generate a session secret:

```bash
openssl rand -base64 48
```

Paste both values into `aether-data/private.env`. Use `./media` for a first
run, or configure named source folders:

```bash
AETHER_MEDIA_ROOTS=photos=/mnt/photos,videos=/mnt/videos
```

Keep `photos` and `videos` unchanged if the paths move later. Escape a comma
inside a path as `\,`.

Start the development app:

```bash
npm run dev
```

The API listens on `http://127.0.0.1:3030`. The development web app listens on
`http://127.0.0.1:5173`.

To run the built app without Docker:

```bash
npm run build
NODE_ENV=production npm start
```

The server then serves both the API and built web app on
`http://127.0.0.1:3030`.

## Docker Compose

Create the private settings file as shown above, then run:

```bash
export AETHER_UID="$(id -u)"
export AETHER_GID="$(id -g)"
docker compose up --build -d
docker compose ps
```

The default setup uses:

- `./aether-data:/data` for Aether's database, cache, backups, and settings
- `./media:/media:ro` for source media
- `127.0.0.1:3030` for the web service

On Linux, the UID and GID values give the container the same access to
`./aether-data` as your account. Docker Desktop users can normally omit those
two exports and use the defaults. Never solve a permission error with a
world-writable data directory.

Change the media mount when your library is elsewhere. Keep it read-only. Do
not change the port to a public bind address unless a firewall, VPN, or HTTPS
reverse proxy protects it.

If Aether runs in Docker but Ollama runs on the host, `127.0.0.1` points to the
container, not the host. On Docker Desktop, set
`AETHER_OLLAMA_BASE_URL=http://host.docker.internal:11434`. On Linux, add this
to the `aether` service before using the same URL:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Keep Ollama reachable only from machines and containers you trust.

## HTTPS

For regular Home Screen web-app access, use a stable HTTPS address behind a
reverse proxy with a certificate trusted by every device. A VPN can restrict
access, but plain HTTP over a VPN is not a browser secure context and does not
support Secure cookies or service workers. Once HTTPS works, set:

```bash
AETHER_COOKIE_SECURE=true
AETHER_TRUST_PROXY=true
```

Only enable `AETHER_TRUST_PROXY` when requests always pass through a proxy you
control.

For example, Caddy can provide HTTPS for a local DNS name:

```caddyfile
aether.home.arpa {
  reverse_proxy 127.0.0.1:3030
}
```

For a local name, Caddy uses its local certificate authority. Install and trust
that CA certificate on the iPhone before adding Aether to the Home Screen. A
manually installed certificate may need full trust enabled in **Settings →
General → About → Certificate Trust Settings**. Use a publicly trusted
certificate instead when that is appropriate for your deployment. See
[Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https) and
[Apple certificate trust](https://support.apple.com/en-us/102390).

## Trusted LAN Preview

For temporary testing on the same trusted network:

```bash
npm run dev:lan
```

Open the network URL printed by Vite. This mode uses plain HTTP and is not meant
for a permanent deployment.

## Updating

Back up the current database, update the code, and run the checks:

```bash
npm run backup
git pull --ff-only
npm ci
npm run verify
```

For Docker:

```bash
docker compose build --pull
docker compose up -d
docker compose ps
```

See [Data management](data-management.md) for backup locations and recovery
notes.
