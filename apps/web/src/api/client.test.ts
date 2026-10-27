import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_REQUEST_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  ApiTimeoutError,
  getAiAssetTagSuggestions,
  getTree,
  getMe,
  inspectVideoPlaybackFailure,
  notifyUnauthorized,
  subscribeToUnauthorized,
  logout
} from "./client";

describe("video playback failure diagnostics", () => {
  const source = "/api/assets/video-1/playback?variant=bounce&v=abc";
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses authenticated HEAD without reading the video body", async () => {
    const response = new Response("unused video bytes");
    const json = vi.spyOn(response, "json");
    const text = vi.spyOn(response, "text");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(response)
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(inspectVideoPlaybackFailure(source)).resolves.toEqual({
      kind: "browser",
      code: "browser_playback_unsupported",
      status: 200
    });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe(source);
    expect(call[1]).toMatchObject({
      method: "HEAD",
      credentials: "include",
      cache: "no-store"
    });
    expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    ["bounce_hevc_encoder_unavailable", 503, "preparation"],
    ["bounce_h264_encoder_unavailable", 503, "preparation"],
    ["media_tool_unavailable", 503, "preparation"],
    ["processing_busy", 503, "busy"],
    ["presentation_limit_exceeded", 422, "limit"],
    ["stale_rendition", 409, "source"],
    ["incomplete_rendition", 422, "preparation"]
  ])("retains a safe server reason: %s", async (code, status, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(null, {
            status,
            headers: { "x-aether-media-error": code }
          })
        )
      )
    );
    await expect(inspectVideoPlaybackFailure(source)).resolves.toEqual({
      code,
      status,
      kind
    });
  });

  it("does not expose unknown response headers or private response content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("private diagnostic details", {
            status: 415,
            headers: { "x-aether-media-error": "/private/path" }
          })
        )
      )
    );
    await expect(inspectVideoPlaybackFailure(source)).resolves.toEqual({
      code: "media_preparation_failed",
      kind: "preparation",
      status: 415
    });
  });

  it("uses the existing session-expiry notification once", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 })))
    );
    try {
      await expect(inspectVideoPlaybackFailure(source)).resolves.toEqual({
        code: "unauthorized",
        kind: "session",
        status: 401
      });
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it("bounds a stalled diagnostic with the ordinary API deadline", async () => {
    vi.useFakeTimers();
    const { fetchMock, getSignal } = abortableNeverResolvingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const request = inspectVideoPlaybackFailure(source);
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;
    expect(getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation without reporting expiry", async () => {
    const { fetchMock, getSignal } = abortableNeverResolvingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = inspectVideoPlaybackFailure(source, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(getSignal()?.aborted).toBe(true);
  });

  it("ignores a late response after cancellation, including a 401", async () => {
    let resolve!: (response: Response) => void;
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((yes) => (resolve = yes)))
    );
    const controller = new AbortController();
    try {
      const request = inspectVideoPlaybackFailure(source, controller.signal);
      controller.abort();
      resolve(new Response(null, { status: 401 }));
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it.each([
    "https://elsewhere.test/api/assets/video-1/playback",
    "//elsewhere.test/api/assets/video-1/playback",
    "/api/admin/settings",
    "/api/assets/video-1/download"
  ])("does not request arbitrary paths: %s", async (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(inspectVideoPlaybackFailure(path)).resolves.toEqual({
      code: "media_preparation_failed",
      kind: "preparation"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("API request deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts and rejects a fetch that never resolves", async () => {
    vi.useFakeTimers();
    const { fetchMock, getSignal } = abortableNeverResolvingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const request = getTree();
    const rejection = expect(request).rejects.toMatchObject({
      code: "request_timeout",
      name: "ApiTimeoutError",
      timeoutMs: API_REQUEST_TIMEOUT_MS
    });

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;

    expect(getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards a caller abort without reporting a timeout", async () => {
    vi.useFakeTimers();
    const { fetchMock } = abortableNeverResolvingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by caller.", "AbortError");

    const request = getTree(controller.signal);
    controller.abort(reason);

    await expect(request).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows local AI inference to use its longer server-compatible deadline", async () => {
    vi.useFakeTimers();
    const { fetchMock, getSignal } = abortableNeverResolvingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const request = getAiAssetTagSuggestions("asset-1");
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    expect(getSignal()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(
      AI_REQUEST_TIMEOUT_MS - API_REQUEST_TIMEOUT_MS
    );
    await rejection;
    expect(getSignal()?.aborted).toBe(true);
  });
});

describe("CSRF cookie selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers the secure host cookie when HTTP and HTTPS cookies coexist", async () => {
    const fetchMock = successfulAuthFetch();
    vi.stubGlobal("document", {
      cookie: "aether_csrf=http-token; __Host-aether_csrf=https-token"
    });
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(requestHeaders(fetchMock).get("x-csrf-token")).toBe("https-token");
  });

  it("falls back to the legacy cookie when no secure host cookie exists", async () => {
    const fetchMock = successfulAuthFetch();
    vi.stubGlobal("document", { cookie: "aether_csrf=http-token" });
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(requestHeaders(fetchMock).get("x-csrf-token")).toBe("http-token");
  });
});

describe("session expiry notification", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the same expiry path for JSON API and streamed media requests", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401
            })
          )
        )
      );
      await expect(getTree()).rejects.toMatchObject({ status: 401 });
      expect(listener).toHaveBeenCalledTimes(1);
      notifyUnauthorized();
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
      notifyUnauthorized();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });
  it("does not report network failures or initial signed-out checks as expiry", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new TypeError("Offline")))
      );
      await expect(getTree()).rejects.toThrow("Offline");
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response("{}", { status: 401 })))
      );
      await expect(getMe()).rejects.toMatchObject({ status: 401 });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

function abortableNeverResolvingFetch() {
  let signal: AbortSignal | null = null;
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      signal = init?.signal ?? null;

      return new Promise((_resolve, reject) => {
        const rejectFromAbort = () => {
          const reason: unknown = signal?.reason;
          reject(
            reason instanceof Error
              ? reason
              : new DOMException("The request was aborted.", "AbortError")
          );
        };

        if (signal?.aborted) {
          rejectFromAbort();
        } else {
          signal?.addEventListener("abort", rejectFromAbort, { once: true });
        }
      });
    }
  );

  return {
    fetchMock,
    getSignal: () => signal
  };
}

function successfulAuthFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(
        new Response(
          JSON.stringify({ authenticated: false, expiresAt: null }),
          {
            headers: { "content-type": "application/json" },
            status: 200
          }
        )
      )
  );
}

function requestHeaders(fetchMock: ReturnType<typeof successfulAuthFetch>) {
  return new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
}
