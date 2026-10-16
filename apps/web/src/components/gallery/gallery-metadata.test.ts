import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultGalleryMetadataFields,
  readGalleryMetadataFields,
  writeGalleryMetadataFields
} from "./gallery-metadata";

describe("gallery metadata storage", () => {
  afterEach(() => vi.unstubAllGlobals());

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
