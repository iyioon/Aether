import { randomUUID } from "node:crypto";
import type { AetherDatabase } from "../db/database.js";

const COMPARISON_GENERATION_KEY = "comparison_generation";

export function getComparisonGeneration(db: AetherDatabase): string {
  const stored = db
    .prepare("SELECT value FROM security_state WHERE key = ?")
    .get(COMPARISON_GENERATION_KEY) as { value: string } | undefined;
  if (stored) return stored.value;
  db.prepare(
    `INSERT OR IGNORE INTO security_state (key, value, updated_at)
     VALUES (?, ?, ?)`
  ).run(COMPARISON_GENERATION_KEY, randomUUID(), new Date().toISOString());
  return (
    db
      .prepare("SELECT value FROM security_state WHERE key = ?")
      .get(COMPARISON_GENERATION_KEY) as { value: string }
  ).value;
}

export function advanceComparisonGeneration(
  db: AetherDatabase,
  updatedAt: string
): void {
  db.prepare(
    `INSERT INTO security_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(COMPARISON_GENERATION_KEY, randomUUID(), updatedAt);
}
