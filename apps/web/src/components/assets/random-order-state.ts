const STORAGE_KEY = "aether.random-order.v1";

export function randomSeedForQuery(contextKey: string): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed =
      raw && raw.length < 8192 ? (JSON.parse(raw) as unknown) : null;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === 1 &&
      "contextKey" in parsed &&
      parsed.contextKey === contextKey &&
      "seed" in parsed &&
      typeof parsed.seed === "number" &&
      Number.isInteger(parsed.seed) &&
      parsed.seed >= 0 &&
      parsed.seed <= 0xffffffff
    )
      return parsed.seed;
  } catch {
    /* Use an in-memory order when persistence is unavailable. */
  }
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  const seed = values[0] ?? 0;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, contextKey, seed })
    );
  } catch {
    /* Storage is optional. */
  }
  return seed;
}

export function clearRandomOrderState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Storage is optional. */
  }
}
