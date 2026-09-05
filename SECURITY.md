# Security Policy

Aether protects private local media, so security reports are taken seriously.

## Supported Versions

The `main` branch is the only supported line until versioned releases begin.

## Reporting A Vulnerability

If GitHub private vulnerability reporting is enabled for the repository, use it. Otherwise, open a short issue asking for a secure contact path and do not include exploit details or private media paths in the issue.

## Scope

Useful reports include authentication bypasses, CSRF issues, path traversal, symlink escapes, media route exposure, unsafe Docker defaults, and leakage of secrets or filesystem paths.

## Deployment Reminder

Aether is intended for a home server or trusted LAN. Do not expose it directly to the public internet. Use a VPN or HTTPS reverse proxy, set strong secrets, and keep media mounts read-only.
