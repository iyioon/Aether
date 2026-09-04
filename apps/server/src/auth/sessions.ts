import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { AetherDatabase } from "../db/database.js";

export interface AuthSession {
  id: string;
  expiresAt: string;
}

export interface CreatedSession {
  id: string;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  expires_at: string;
}

export function createSession(
  db: AetherDatabase,
  ttlDays: number
): CreatedSession {
  const id = cryptoRandomId();
  const sessionToken = secureToken();
  const csrfToken = secureToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions
      (id, token_hash, csrf_token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    sha256(sessionToken),
    sha256(csrfToken),
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString()
  );

  return { id, sessionToken, csrfToken, expiresAt };
}

export function findSession(
  db: AetherDatabase,
  sessionToken: string | undefined
): AuthSession | null {
  if (!sessionToken) {
    return null;
  }

  const now = new Date();
  const row = db
    .prepare(
      `SELECT id, expires_at
       FROM sessions
       WHERE token_hash = ? AND expires_at > ?`
    )
    .get(sha256(sessionToken), now.toISOString()) as SessionRow | undefined;

  if (!row) {
    return null;
  }

  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
    now.toISOString(),
    row.id
  );

  return { id: row.id, expiresAt: row.expires_at };
}

export function deleteSession(
  db: AetherDatabase,
  sessionToken: string | undefined
): void {
  if (!sessionToken) {
    return;
  }

  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
    sha256(sessionToken)
  );
}

export function deleteExpiredSessions(db: AetherDatabase): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(
    new Date().toISOString()
  );
}

export function verifyCsrfToken(
  db: AetherDatabase,
  sessionId: string,
  csrfToken: string | undefined
): boolean {
  if (!csrfToken) {
    return false;
  }

  const row = db
    .prepare("SELECT csrf_token_hash FROM sessions WHERE id = ?")
    .get(sessionId) as { csrf_token_hash: string } | undefined;

  if (!row) {
    return false;
  }

  return timingSafeHexEqual(row.csrf_token_hash, sha256(csrfToken));
}

function cryptoRandomId(): string {
  return randomBytes(16).toString("hex");
}

function secureToken(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
