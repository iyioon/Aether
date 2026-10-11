# Contributing

Aether handles private media. Changes must preserve that boundary and keep
source folders read-only.

## Local Setup

```bash
npm install
mkdir -p aether-data
chmod 700 aether-data
cp private.env.example aether-data/private.env
chmod 600 aether-data/private.env
npm run hash-password -w @aether/server
npm run dev
```

Use disposable media and data for development. Do not point destructive tests at
a real library.

## Before Opening A Pull Request

```bash
npm run verify
npm run test:e2e
```

Run the browser suite for changes to user flows, authentication, scanning, media
delivery, or data maintenance. If a required check cannot run, explain why.

## Expectations

- Keep each change focused and reviewable.
- Add tests for new behavior and fixed failures.
- Do not commit media, local databases, cache files, backups, build output,
  private paths, or environment files.
- Keep network services and AI analysis opt-in.
- Update public docs when behavior or configuration changes.
- Preserve keyboard access, visible focus, and reduced-motion support.
- Follow [Engineering standards](docs/engineering.md).

Security problems should be reported through the process in
[SECURITY.md](SECURITY.md), not a public issue with exploit details.
