import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../api/client";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { MediaCardInfo } from "./MediaCardInfo";

const asset: AssetRecord = {
  id: "asset",
  folderId: "folder",
  name: "photo.png",
  extension: ".png",
  mediaType: "image",
  mimeType: "image/png",
  sizeBytes: 4096,
  mtimeMs: 0,
  width: 800,
  height: 600,
  durationMs: null,
  codec: null,
  status: "ready",
  error: null,
  score: 0,
  ranking: null,
  favorite: true,
  tags: [
    {
      id: "tag",
      normalizedName: "travel",
      displayName: "Travel",
      usageCount: 1
    }
  ]
};
const fields = new Set<GalleryMetadataField>([
  "title",
  "mediaType",
  "size",
  "score",
  "favorite",
  "tags"
]);

describe("shared media card information", () => {
  it("keeps compact values labelled and zero scores visible, with an icon-only favorite", () => {
    const markup = renderToStaticMarkup(
      createElement(MediaCardInfo, { asset, fields, compact: true })
    );
    expect(markup).toContain("media-card-info-row");
    expect(markup).toContain('title="Type: image"');
    expect(markup).toContain('title="File size: 4.0 KB"');
    expect(markup).toContain('title="Score: 0"');
    expect(markup).toContain("lucide-arrow-up");
    expect(markup).not.toContain("lucide-star");
    expect(markup).toContain('title="Tags: Travel"');
    expect(markup).toContain('role="img" aria-label="Favorite"');
    expect(markup.replace(/<[^>]*>/g, "")).not.toContain("Favorite");
  });

  it("uses duration for videos and omits unselected fields and inactive favorites", () => {
    const markup = renderToStaticMarkup(
      createElement(MediaCardInfo, {
        asset: {
          ...asset,
          mediaType: "video",
          durationMs: 65000,
          favorite: false
        },
        fields: new Set<GalleryMetadataField>(["size", "favorite"]),
        compact: true
      })
    );
    expect(markup).toContain('title="Duration: 1:05"');
    expect(markup).not.toContain("File size");
    expect(markup).not.toContain("photo.png");
    expect(markup).not.toContain("Favorite");
    expect(markup).not.toContain("Score");
    expect(markup).not.toContain("Travel");
  });

  it("does not duplicate the comparison score and keeps the default metadata layout", () => {
    const markup = renderToStaticMarkup(
      createElement(MediaCardInfo, { asset, fields, includeScore: false })
    );
    expect(markup).toContain("image · 4.0 KB");
    expect(markup).toContain("Favorite</span>");
    expect(markup).not.toContain("Score ");
    expect(markup).not.toContain("media-card-info-row");
  });

  it("does not leave an empty compact row when no metadata is selected", () => {
    const markup = renderToStaticMarkup(
      createElement(MediaCardInfo, {
        asset,
        fields: new Set<GalleryMetadataField>(),
        compact: true
      })
    );
    expect(markup).not.toContain("media-card-info-row");
    expect(markup).not.toContain("<svg");
  });
});
