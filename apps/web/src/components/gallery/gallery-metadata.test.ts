import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultGalleryMetadataFields,
  readGalleryMetadataFields,
  writeGalleryMetadataFields
} from "./gallery-metadata";

describe("gallery metadata storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Feed and Ranking info hidden by default and independent from Gallery", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    expect(readGalleryMetadataFields("feed").size).toBe(0);
    expect(readGalleryMetadataFields("compare").size).toBe(0);
    writeGalleryMetadataFields(new Set(["title", "score"]), "feed");
    expect(readGalleryMetadataFields("feed")).toEqual(
      new Set(["title", "score"])
    );
    expect(readGalleryMetadataFields("compare").size).toBe(0);
    expect(readGalleryMetadataFields()).toEqual(defaultGalleryMetadataFields);
    values.set(
      "aether.feed.metadata-fields",
      '["unknown", "tags", "tags", 42]'
    );
    expect(readGalleryMetadataFields("feed")).toEqual(new Set(["tags"]));
  });

  it("keeps metadata controls usable when Safari blocks access to storage", () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      }
    });
    vi.stubGlobal("window", blockedWindow);

    expect(readGalleryMetadataFields()).toEqual(defaultGalleryMetadataFields);
    expect(() => writeGalleryMetadataFields(new Set(["score"]))).not.toThrow();
  });

  it("does not let a full storage quota interrupt a metadata preference change", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem() {
          throw new DOMException("Storage is full.", "QuotaExceededError");
        }
      }
    });

    expect(() => writeGalleryMetadataFields(new Set(["tags"]))).not.toThrow();
  });
});
