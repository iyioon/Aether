import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiTimeoutError,
  createUploadHttpStack,
  subscribeToUnauthorized,
  UPLOAD_CHUNK_BYTES
} from "./client";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("authenticated tus transport", () => {
  function setup(response: Response) {
    vi.stubGlobal("window", { location: { origin: "https://aether.test" } });
    vi.stubGlobal("document", { cookie: "aether_csrf=csrf-token" });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  it("keeps credentials and CSRF on binary transfers without a JSON content type", async () => {
    const fetch = setup(
      new Response(null, { status: 204, headers: { "Upload-Offset": "3" } })
    );
    const request = createUploadHttpStack().createRequest(
      "PATCH",
      "/api/uploads/abc-123"
    );
    request.setHeader("Content-Type", "application/offset+octet-stream");
    await request.send(new Uint8Array([1, 2, 3]));
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/offset+octet-stream"
    );
  });
  it("reads only the selected chunk and sends its exact bytes from memory", async () => {
    const fetch = setup(new Response(null, { status: 204 }));
    const source = new File(
      [new Uint8Array([8, 9, 1, 2, 3, 4, 5])],
      "photo.png"
    );
    const chunk = source.slice(2, 6);
    const readSource = vi.spyOn(source, "arrayBuffer");
    const readChunk = vi.spyOn(chunk, "arrayBuffer");
    const request = createUploadHttpStack().createRequest(
      "PATCH",
      "/api/uploads/abc-123"
    );
    request.setHeader("Content-Type", "application/offset+octet-stream");
    await request.send(chunk);
    expect(readSource).not.toHaveBeenCalled();
    expect(readChunk).toHaveBeenCalledOnce();
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([1, 2, 3, 4]);
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/offset+octet-stream"
    );
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(init.credentials).toBe("include");
  });
  it("rejects an oversized Blob before reading it or sending a request", async () => {
    const fetch = setup(new Response(null, { status: 204 }));
    const chunk = new Blob([new Uint8Array([1])]);
    vi.spyOn(chunk, "size", "get").mockReturnValue(UPLOAD_CHUNK_BYTES + 1);
    const read = vi.spyOn(chunk, "arrayBuffer");
    const request = createUploadHttpStack().createRequest(
      "PATCH",
      "/api/uploads/abc-123"
    );
    await expect(request.send(chunk)).rejects.toMatchObject({
      status: 413,
      code: "chunk_too_large"
    });
    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("enforces the same bound on buffered upload bodies", async () => {
    const fetch = setup(new Response(null, { status: 204 }));
    const bytes = new ArrayBuffer(UPLOAD_CHUNK_BYTES + 1);
    for (const body of [bytes, new Uint8Array(bytes)]) {
      const request = createUploadHttpStack().createRequest(
        "PATCH",
        "/api/uploads/abc-123"
      );
      await expect(request.send(body)).rejects.toMatchObject({
        status: 413,
        code: "chunk_too_large"
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stops an aborted file read promptly and never sends late bytes", async () => {
    const fetch = setup(new Response(null, { status: 204 }));
    const chunk = new Blob([new Uint8Array([1, 2, 3])]);
    let finishRead!: (bytes: ArrayBuffer) => void;
    vi.spyOn(chunk, "arrayBuffer").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    const request = createUploadHttpStack().createRequest(
      "PATCH",
      "/api/uploads/abc-123"
    );
    const rejected = expect(request.send(chunk)).rejects.toMatchObject({
      name: "AbortError"
    });
    await request.abort();
    await rejected;
    finishRead(new Uint8Array([1, 2, 3]).buffer);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not start reading or fetching after an earlier abort", async () => {
    const fetch = setup(new Response(null, { status: 204 }));
    const chunk = new Blob([new Uint8Array([1, 2, 3])]);
    const read = vi.spyOn(chunk, "arrayBuffer");
    const request = createUploadHttpStack().createRequest(
      "PATCH",
      "/api/uploads/abc-123"
    );
    await request.abort();
    await expect(request.send(chunk)).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("includes the file read in the request deadline", async () => {
    vi.useFakeTimers();
    const fetch = setup(new Response(null, { status: 204 }));
    const chunk = new Blob([new Uint8Array([1])]);
    let finishRead!: (bytes: ArrayBuffer) => void;
    vi.spyOn(chunk, "arrayBuffer").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    const request = createUploadHttpStack().createRequest(
      "PATCH",
      "/api/uploads/abc-123"
    );
    const rejected = expect(request.send(chunk)).rejects.toBeInstanceOf(
      ApiTimeoutError
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    finishRead(new Uint8Array([1]).buffer);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps unreadable and truncated file errors controlled without a request", async () => {
    const fetch = setup(new Response(null, { status: 204 }));
    for (const result of [
      () =>
        Promise.reject(new Error("Could not read /private/picker/photo.png")),
      () => Promise.resolve(new ArrayBuffer(0))
    ]) {
      const chunk = new Blob([new Uint8Array([1, 2, 3])]);
      vi.spyOn(chunk, "arrayBuffer").mockImplementation(result);
      const request = createUploadHttpStack().createRequest(
        "PATCH",
        "/api/uploads/abc-123"
      );
      await expect(request.send(chunk)).rejects.toMatchObject({
        status: 0,
        code: "upload_read_failed",
        message: "upload_read_failed"
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an offset that changed after retained-prefix verification", async () => {
    setup(
      new Response(null, { status: 200, headers: { "Upload-Offset": "8" } })
    );
    const request = createUploadHttpStack(7).createRequest(
      "HEAD",
      "/api/uploads/abc-123"
    );
    await expect(request.send(null)).rejects.toMatchObject({
      code: "upload_changed",
      status: 409
    });
  });
  it("notifies session expiry and rejects off-origin upload locations", async () => {
    setup(new Response(null, { status: 401 }));
    const onUnauthorized = vi.fn();
    const unsubscribe = subscribeToUnauthorized(onUnauthorized);
    try {
      await createUploadHttpStack()
        .createRequest("HEAD", "/api/uploads/abc-123")
        .send(null);
      expect(onUnauthorized).toHaveBeenCalledOnce();
      expect(() =>
        createUploadHttpStack().createRequest(
          "PATCH",
          "https://other.test/api/uploads/abc-123"
        )
      ).toThrow("Invalid upload location.");
    } finally {
      unsubscribe();
    }
  });
});
