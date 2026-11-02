const KEY = "aether.uploads.v1";
export function readUploadCheckpoints(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value: unknown = raw && raw.length <= 16_384 ? JSON.parse(raw) : null;
    return Array.isArray(value)
      ? value
          .filter(
            (id): id is string =>
              typeof id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(id)
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export function saveUploadCheckpoint(id: string): void {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(
        [...new Set([id, ...readUploadCheckpoints()])].slice(0, 100)
      )
    );
  } catch {
    /* Optional recovery state must not stop a transfer. */
  }
}
export function clearUploadCheckpoints(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}
