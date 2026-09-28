import { describe, expect, it } from "vitest";
import {
  estimateGalleryRowHeight,
  galleryTileChromeHeight
} from "./gallery-layout";

describe("galleryTileChromeHeight", () => {
  it("matches the rendered metadata row heights and gaps", () => {
    expect(
      galleryTileChromeHeight(
        new Set(["title", "mediaType", "size", "score", "favorite", "tags"])
      )
    ).toBe(90);
  });

  it("does not reserve metadata chrome when every field is hidden", () => {
    expect(galleryTileChromeHeight(new Set())).toBe(0);
  });

  it("accounts for the card border when estimating media height", () => {
    expect(
      estimateGalleryRowHeight({
        aspect: "Landscape",
        columnCount: 1,
        containerWidth: 180,
        metadataFields: new Set(),
        minTileWidth: 180
      })
    ).toBeCloseTo(113.25);
  });
});
