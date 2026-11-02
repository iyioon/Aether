import { sha256 } from "@noble/hashes/sha2.js";

self.onmessage = async (
  event: MessageEvent<{ file: File; offset: number }>
) => {
  const { file, offset } = event.data;
  try {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size)
      throw new Error("invalid_prefix");
    const hash = sha256.create();
    for (let start = 0; start < offset; start += 1024 * 1024) {
      hash.update(
        new Uint8Array(
          await file
            .slice(start, Math.min(offset, start + 1024 * 1024))
            .arrayBuffer()
        )
      );
    }
    self.postMessage({
      sha256: Array.from(hash.digest(), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    });
  } catch {
    self.postMessage({ error: "The selected file could not be checked." });
  }
};
