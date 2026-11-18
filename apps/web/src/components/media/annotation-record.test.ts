import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../api/client";
import {
  mergeAnnotationRecord,
  sameAnnotationSource
} from "./annotation-record";
import { defaultPresentationValues } from "./presentation-model";

function asset(): AssetRecord {
  return {
    id: "source",
    sourceVersion: "source-v1",
    folderId: "folder",
    name: "recording.mp4",
    extension: ".mp4",
    mediaType: "video",
    mimeType: "video/mp4",
    sizeBytes: 1000,
    mtimeMs: 1000,
    width: null,
    height: null,
    durationMs: null,
    codec: null,
    status: "indexed",
    error: null,
    score: 2,
    ranking: null,
    favorite: false,
    tags: []
  };
}

describe("annotation metadata hydration", () => {
  it("adds lazily discovered technical metadata without replacing current curation", () => {
    const current = { ...asset(), score: 5, favorite: true };
    const detail = {
      ...asset(),
      width: 1920,
      height: 1080,
      durationMs: 9000,
      codec: "h264"
    };
    expect(mergeAnnotationRecord(current, detail)).toMatchObject({
      width: 1920,
      height: 1080,
      durationMs: 9000,
      codec: "h264",
      score: 5,
      favorite: true,
      tags: current.tags
    });
  });

  it("retains known fields when the detail response has no metadata yet", () => {
    const current = { ...asset(), width: 1280, height: 720, durationMs: 8000 };
    expect(mergeAnnotationRecord(current, asset())).toEqual(current);
    expect(mergeAnnotationRecord(current, null)).toBe(current);
  });

  it("rejects a changed source rendition while allowing ordinary presentation edits", () => {
    const current = {
      ...asset(),
      presentation: {
        ...defaultPresentationValues(),
        highlights: [],
        revision: 2,
        renditionKeys: { full: "source", highlight: "main", bounce: "main" }
      }
    };
    const changedPresentation = {
      ...current,
      presentation: {
        ...current.presentation,
        revision: 3,
        renditionKeys: { full: "source", highlight: "new", bounce: "new" }
      }
    };
    expect(sameAnnotationSource(current, changedPresentation)).toBe(true);
    const changedSource = {
      ...current,
      presentation: {
        ...current.presentation,
        renditionKeys: { full: "replaced", highlight: "main", bounce: "main" }
      }
    };
    expect(sameAnnotationSource(current, changedSource)).toBe(false);
  });

  it.each([
    { id: "different" },
    { sourceVersion: "source-v2" },
    { folderId: "other-folder" },
    { name: "renamed.mp4" },
    { sizeBytes: 2000 },
    { mtimeMs: 2000 }
  ])("rejects details for a changed source: %o", (change) => {
    const current = asset();
    const detail = { ...current, ...change, width: 1920 };
    expect(sameAnnotationSource(current, detail)).toBe(false);
    expect(mergeAnnotationRecord(current, detail)).toBe(current);
  });
});
