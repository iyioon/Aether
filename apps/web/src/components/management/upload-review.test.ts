import { describe, expect, it } from "vitest";
import type { UploadLimits } from "../../api/client";
import { uploadBatchError, uploadFileError } from "./upload-review";
const limits: UploadLimits = {
  maxUploadBytes: 100,
  maxStagingBytes: 150,
  maxBatchItems: 2,
  chunkBytes: 16
};
describe("upload review", () => {
  it("rejects folder selections, empty files and unsupported extensions before submission", () => {
    expect(
      uploadFileError(
        { name: "photo.png", size: 1, webkitRelativePath: "folder/photo.png" },
        limits
      )
    ).toMatch(/individual files/);
    expect(uploadFileError({ name: "photo.png", size: 0 }, limits)).toMatch(
      /empty/
    );
    expect(uploadFileError({ name: "document.svg", size: 1 }, limits)).toMatch(
      /type is not supported/
    );
    expect(uploadFileError({ name: "photo.HEIC", size: 1 }, limits)).toBeNull();
  });
  it("uses configured file, count and staging limits and waits for limits to load", () => {
    expect(uploadFileError({ name: "photo.png", size: 101 }, limits)).toMatch(
      /per-file/
    );
    expect(uploadBatchError([{ name: "a.png", size: 1 }], null)).toMatch(
      /could not be loaded/
    );
    expect(
      uploadBatchError(
        Array.from({ length: 3 }, () => ({ name: "a.png", size: 1 })),
        limits
      )
    ).toMatch(/up to 2/);
    expect(
      uploadBatchError(
        [
          { name: "a.png", size: 100 },
          { name: "b.png", size: 51 }
        ],
        limits
      )
    ).toMatch(/unfinished upload limit/);
    expect(
      uploadBatchError(
        [
          { name: "a.png", size: 100 },
          { name: "b.png", size: 50 }
        ],
        limits
      )
    ).toBeNull();
  });
});
