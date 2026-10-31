export const VIDEO_RANGE_BYTES = 512 * 1_024;

export async function preloadVideoRange(
  source: string,
  signal: AbortSignal
): Promise<boolean> {
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<boolean>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const loading = (async () => {
    const response = await fetch(source, {
      credentials: "same-origin",
      headers: { Range: `bytes=0-${VIDEO_RANGE_BYTES - 1}` },
      priority: "low",
      redirect: "error",
      signal
    });
    const contentRange = /^bytes 0-(\d+)\/(\d+)$/.exec(
      response.headers.get("content-range") ?? ""
    );
    const rangeEnd = Number(contentRange?.[1]);
    const totalBytes = Number(contentRange?.[2]);
    const expectedBytes = rangeEnd + 1;
    if (
      signal.aborted ||
      response.status !== 206 ||
      !/^(?:video\/[^;]+|application\/octet-stream)(?:;|$)/i.test(
        response.headers.get("content-type") ?? ""
      ) ||
      !contentRange ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > VIDEO_RANGE_BYTES ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes < expectedBytes ||
      !response.body
    ) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }

    const reader = response.body.getReader();
    const cancelRead = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancelRead, { once: true });
    let receivedBytes = 0;
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          return receivedBytes === expectedBytes;
        }
        receivedBytes += value.byteLength;
        if (
          receivedBytes > expectedBytes ||
          receivedBytes > VIDEO_RANGE_BYTES
        ) {
          await reader.cancel();
          return false;
        }
      }
      return false;
    } finally {
      signal.removeEventListener("abort", cancelRead);
      reader.releaseLock();
    }
  })();

  try {
    return await Promise.race([loading.catch(() => false), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
