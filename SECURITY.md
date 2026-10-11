# Security Policy

## Supported Versions

Until versioned releases begin, only the current **main** branch receives
security fixes.

## Report A Vulnerability

Use GitHub's private vulnerability reporting for this repository when it is
available. Otherwise, open a short issue asking the maintainer for a private
contact method.

Do not put exploit details, secrets, media names, screenshots, or filesystem
paths in a public issue.

Useful reports include:

- authentication or CSRF bypasses
- path traversal and symlink escapes
- unauthenticated media access
- unsafe scan, rebuild, or wipe behavior
- secret, filename, path, or media-content leaks
- unsafe container or reverse-proxy defaults

Include the affected version, a minimal reproduction, and the expected result.
Use synthetic files wherever possible.

## Deployment Boundary

Aether is meant for a home server or trusted network. Do not expose it directly
to the public internet. Use a firewall, private VPN, or HTTPS reverse proxy; keep
source media read-only; and protect the Aether data directory.

See [Security](docs/security.md) for the full deployment and privacy model.
