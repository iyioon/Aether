import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_REQUEST_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  ApiTimeoutError,
  getAiAssetTagSuggestions,
  getTree,
  getMe,
  notifyUnauthorized,
  subscribeToUnauthorized,
  logout
} from "./client";

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
