import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuid } from "./uuid";

describe("UUID creation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates request IDs when HTTP LAN origins do not expose randomUUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(255);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    expect(createUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("uses fresh randomness for each RFC 4122 version 4 ID", () => {
    const ids = Array.from({ length: 100 }, createUuid);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
      );
  });
});
