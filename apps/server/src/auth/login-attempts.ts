import { createHmac } from "node:crypto";
import type { AetherDatabase } from "../db/database.js";

export interface LoginThrottlePolicy {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

export interface LoginThrottleState {
  locked: boolean;
  failedCount: number;
  remainingAttempts: number;
  lockedUntil: Date | null;
  retryAfterSeconds: number | null;
}

interface LoginAttemptRow {
  key: string;
  failed_count: number;
  first_failed_at: string;
  last_failed_at: string;
  locked_until: string | null;
}

export function loginAttemptKey(source: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(normalizeSource(source))
    .digest("hex");
}

export function getLoginThrottleState(
  db: AetherDatabase,
  key: string,
  policy: LoginThrottlePolicy,
  now = new Date()
): LoginThrottleState {
  const row = findLoginAttempt(db, key);
  return stateForRow(row, policy, now);
}

export function recordFailedLogin(
  db: AetherDatabase,
  key: string,
  policy: LoginThrottlePolicy,
  now = new Date()
): LoginThrottleState {
  const row = findLoginAttempt(db, key);
  const shouldReset =
    !row ||
    isExpiredLock(row, now) ||
    isOutsideWindow(row.first_failed_at, policy, now);
  const failedCount = shouldReset ? 1 : row.failed_count + 1;
  const firstFailedAt = shouldReset ? now.toISOString() : row.first_failed_at;
  const lockedUntil =
    failedCount >= policy.maxFailures
      ? new Date(now.getTime() + policy.lockoutMs)
      : null;

  db.prepare(
    `INSERT INTO login_attempts
      (key, failed_count, first_failed_at, last_failed_at, locked_until)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        failed_count = excluded.failed_count,
        first_failed_at = excluded.first_failed_at,
        last_failed_at = excluded.last_failed_at,
        locked_until = excluded.locked_until`
  ).run(
    key,
    failedCount,
    firstFailedAt,
    now.toISOString(),
    lockedUntil?.toISOString() ?? null
  );

  return stateForParts(failedCount, lockedUntil, policy, now);
}

export function clearLoginAttempts(db: AetherDatabase, key: string): void {
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
}

export function pruneLoginAttempts(
  db: AetherDatabase,
  policy: LoginThrottlePolicy,
  now = new Date()
): void {
  const retentionMs = Math.max(policy.windowMs, policy.lockoutMs) * 2;
  const staleBefore = new Date(now.getTime() - retentionMs).toISOString();

  db.prepare(
    `DELETE FROM login_attempts
     WHERE last_failed_at <= ?
       AND (locked_until IS NULL OR locked_until <= ?)`
  ).run(staleBefore, now.toISOString());
}

function findLoginAttempt(
  db: AetherDatabase,
  key: string
): LoginAttemptRow | null {
  return (
    (db
      .prepare(
        `SELECT key, failed_count, first_failed_at, last_failed_at, locked_until
         FROM login_attempts
         WHERE key = ?`
      )
      .get(key) as LoginAttemptRow | undefined) ?? null
  );
}

function stateForRow(
  row: LoginAttemptRow | null,
  policy: LoginThrottlePolicy,
  now: Date
): LoginThrottleState {
  if (!row || isExpiredLock(row, now) || isOutsideWindow(row.first_failed_at, policy, now)) {
    return stateForParts(0, null, policy, now);
  }

  return stateForParts(row.failed_count, dateOrNull(row.locked_until), policy, now);
}

function stateForParts(
  failedCount: number,
  lockedUntil: Date | null,
  policy: LoginThrottlePolicy,
  now: Date
): LoginThrottleState {
  const locked = lockedUntil !== null && lockedUntil.getTime() > now.getTime();
  const retryAfterSeconds = locked
    ? Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000))
    : null;

  return {
    locked,
    failedCount,
    remainingAttempts: Math.max(0, policy.maxFailures - failedCount),
    lockedUntil: locked ? lockedUntil : null,
    retryAfterSeconds
  };
}

function isExpiredLock(row: LoginAttemptRow, now: Date): boolean {
  const lockedUntil = dateOrNull(row.locked_until);
  return lockedUntil !== null && lockedUntil.getTime() <= now.getTime();
}

function isOutsideWindow(
  firstFailedAt: string,
  policy: LoginThrottlePolicy,
  now: Date
): boolean {
  const firstFailedTime = new Date(firstFailedAt).getTime();

  if (!Number.isFinite(firstFailedTime)) {
    return true;
  }

  return now.getTime() - firstFailedTime > policy.windowMs;
}

function dateOrNull(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeSource(source: string): string {
  return source.trim().toLocaleLowerCase("en-US") || "unknown";
}
