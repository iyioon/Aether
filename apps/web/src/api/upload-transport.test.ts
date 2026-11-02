import { afterEach, describe, expect, it, vi } from "vitest";
import { createUploadHttpStack, subscribeToUnauthorized } from "./client";
afterEach(() => vi.unstubAllGlobals());
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
