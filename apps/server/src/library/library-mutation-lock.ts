import type { AetherDatabase } from "../db/database.js";

const tails = new WeakMap<AetherDatabase, Promise<unknown>>();

/** Serializes complete scans with filesystem changes and their database commits. */
export async function withLibraryMutationLock<T>(
  db: AetherDatabase,
  work: () => Promise<T>
): Promise<T> {
  const previous = tails.get(db) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  tails.set(db, current);
  try {
    return await current;
  } finally {
    if (tails.get(db) === current) tails.delete(db);
  }
}
