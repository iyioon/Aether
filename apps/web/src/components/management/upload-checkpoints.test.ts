import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUploadCheckpoints,
  readUploadCheckpoints,
  saveUploadCheckpoint
} from "./upload-checkpoints";
afterEach(() => vi.unstubAllGlobals());
describe("upload checkpoints", () => {
  it("stores only bounded opaque IDs and deduplicates retries", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });
    saveUploadCheckpoint("abc-123");
    saveUploadCheckpoint("abc-123");
    expect(readUploadCheckpoints()).toEqual(["abc-123"]);
    values.set(
      "aether.uploads.v1",
      JSON.stringify([
        "abc-123",
        "/private/photo.jpg",
        "photo name.jpg",
        ...Array.from({ length: 105 }, (_, index) => `opaque-${index}`)
      ])
    );
    const ids = readUploadCheckpoints();
    expect(ids).toHaveLength(100);
    expect(ids).not.toContain("/private/photo.jpg");
    expect(ids).not.toContain("photo name.jpg");
    clearUploadCheckpoints();
    expect(readUploadCheckpoints()).toEqual([]);
  });
  it("tolerates invalid and inaccessible browser storage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "not-json",
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        }
      }
    });
    expect(readUploadCheckpoints()).toEqual([]);
    expect(() => saveUploadCheckpoint("safe-id")).not.toThrow();
    expect(() => clearUploadCheckpoints()).not.toThrow();
  });
});
