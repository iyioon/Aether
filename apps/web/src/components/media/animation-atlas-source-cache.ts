/** Keeps encoded atlas Blobs in memory without fetching or persisting media. */
export class AnimationAtlasSourceCache {
  private readonly entries = new Map<string, Blob>();
  private bytes = 0;

  constructor(
    private readonly maximumBytes = 32 * 1024 * 1024,
    private readonly maximumEntries = 32
  ) {
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 0 ||
      !Number.isSafeInteger(maximumEntries) ||
      maximumEntries < 0
    )
      throw new RangeError("Invalid animation source cache limits.");
  }

  get(url: string): Blob | undefined {
    const blob = this.entries.get(url);
    if (!blob) return undefined;
    this.entries.delete(url);
    this.entries.set(url, blob);
    return blob;
  }

  set(url: string, blob: Blob): void {
    this.delete(url);
    if (
      this.maximumBytes === 0 ||
      this.maximumEntries === 0 ||
      blob.size > this.maximumBytes
    )
      return;
    this.entries.set(url, blob);
    this.bytes += blob.size;
    while (
      this.bytes > this.maximumBytes ||
      this.entries.size > this.maximumEntries
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  delete(url: string): void {
    const previous = this.entries.get(url);
    if (!previous) return;
    this.bytes -= previous.size;
    this.entries.delete(url);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
