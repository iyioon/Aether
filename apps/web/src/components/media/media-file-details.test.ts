import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssetRecord, TreeResponse } from "../../api/client";
import { MediaFileDetails } from "./MediaFileDetails";
import { mediaFileDetails, mediaFolderLabel } from "./media-file-details";

const asset: AssetRecord = {
  id: "asset",
  folderId: "folder",
  name: "photo.jpg",
  extension: ".jpg",
  mediaType: "image",
  mimeType: "image/jpeg",
  sizeBytes: 4096,
  mtimeMs: Date.parse("2026-11-18T09:30:00Z"),
  width: 1920,
  height: 1080,
  durationMs: null,
  codec: null,
  status: "indexed",
  error: null,
  score: 0,
  ranking: null,
  favorite: false,
  tags: []
};

describe("media file details", () => {
  it("uses public root labels and full relative folders for file locations", () => {
    const tree: TreeResponse = {
      roots: [{ id: "root", folderId: "top", label: "Library", assetCount: 1 }],
      folders: [
        {
          id: "folder",
          rootId: "root",
          parentId: "top",
          label: "Coast",
          relativePath: "Trips/Coast",
          assetCount: 1
        }
      ]
    };
    expect(mediaFolderLabel(tree, "folder")).toBe("Library / Trips / Coast");
    expect(mediaFolderLabel(tree, "top")).toBe("Library");
    expect(mediaFolderLabel(tree, "missing")).toBeUndefined();
    expect(mediaFolderLabel(null, "folder")).toBeUndefined();
    expect(mediaFolderLabel({ ...tree, roots: [] }, "folder")).toBe("Coast");
  });
  it("labels filesystem modification time explicitly and includes its time zone", () => {
    const details = mediaFileDetails(asset, {
      locationLabel: "Library / Trips / Coast",
      locale: "en-US",
      timeZone: "Asia/Seoul"
    });
    expect(details).toEqual([
      {
        label: "Modified",
        value: "Nov 18, 2026, 6:30 PM GMT+9",
        dateTime: "2026-11-18T09:30:00.000Z"
      },
      { label: "Location", value: "Library / Trips / Coast" },
      { label: "Format", value: "JPEG" },
      { label: "File size", value: "4.0 KB" },
      { label: "Dimensions", value: "1920 × 1080 px" }
    ]);
    expect(details.map(({ label }) => label)).not.toContain("Date taken");
    expect(details.map(({ label }) => label)).not.toContain("Date added");
  });

  it("uses the correct local date across midnight and daylight-saving changes", () => {
    const details = mediaFileDetails(
      { ...asset, mtimeMs: Date.parse("2026-07-01T01:30:00Z") },
      { locale: "en-US", timeZone: "America/New_York" }
    );
    expect(details[0]).toMatchObject({
      value: "Jun 30, 2026, 9:30 PM GMT-4",
      dateTime: "2026-07-01T01:30:00.000Z"
    });
  });

  it("shows known video metadata without fabricating missing fields", () => {
    expect(
      mediaFileDetails(
        {
          ...asset,
          extension: ".mp4",
          durationMs: 65_000,
          codec: " h264 ",
          width: null,
          height: null
        },
        { timeZone: "UTC" }
      ).filter(({ label }) => label !== "Modified")
    ).toEqual([
      { label: "Format", value: "MP4" },
      { label: "File size", value: "4.0 KB" },
      { label: "Duration", value: "1:05" },
      { label: "Codec", value: "h264" }
    ]);
    expect(mediaFileDetails({ ...asset, durationMs: 140 })).toContainEqual({
      label: "Duration",
      value: "<1 s"
    });
  });

  it("omits invalid or absent optional metadata and accepts an empty file", () => {
    const invalid = {
      ...asset,
      mtimeMs: Number.NaN,
      extension: "",
      mimeType: null,
      width: 0,
      height: -1,
      sizeBytes: Number.POSITIVE_INFINITY,
      durationMs: -100,
      codec: " "
    };
    expect(mediaFileDetails(invalid, { locationLabel: " " })).toEqual([]);
    expect(mediaFileDetails({ ...invalid, sizeBytes: 0 })).toEqual([
      { label: "File size", value: "0 B" }
    ]);
    expect(
      mediaFileDetails({ ...invalid, mtimeMs: 8.65e15, width: 3.5, height: 2 })
    ).toEqual([]);
  });

  it("falls back to a known MIME type when the filename has no extension", () => {
    expect(mediaFileDetails({ ...asset, extension: "" })).toContainEqual({
      label: "Format",
      value: "image/jpeg"
    });
  });

  it("renders semantic date and detail rows and escapes location labels", () => {
    const markup = renderToStaticMarkup(
      createElement(MediaFileDetails, {
        asset,
        locationLabel: "Library / <Coast>"
      })
    );
    expect(markup).toContain('<dl class="media-file-details"');
    expect(markup).toContain("<dt>Modified</dt>");
    expect(markup).toContain('dateTime="2026-11-18T09:30:00.000Z"');
    expect(markup).toContain("Library / &lt;Coast&gt;");
    expect(markup).not.toContain("<Coast>");
  });
});
