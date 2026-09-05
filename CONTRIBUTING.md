# Contributing

Aether is built for private local media libraries. Changes should preserve that boundary.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run hash-password -w @aether/server -- "choose-a-password"
npm run dev
```

## Before Opening A Change

```bash
npm run verify
```

Run `npm run test:e2e` for UI flows, media serving changes, auth changes, scanner changes, and release candidates.

## Expectations

- Keep changes focused and reviewable.
- Do not commit media, local databases, cache output, build output, or private environment files.
- Add tests for security-sensitive behavior and data writes.
- Keep docs direct and current.
- Do not add cloud services or external media analysis without an explicit opt-in design.
