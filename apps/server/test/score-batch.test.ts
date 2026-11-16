import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import {
  folderIdFor,
  getAsset,
  recordComparisonDecision,
  syncConfiguredRoots,
  updateAssetScore,
  updateAssetScoresBatch,
  upsertAsset
} from "../src/library/repository.js";
import { getLibraryRevision } from "../src/library/repository-management.js";

describe("batch score persistence", () => {
  let directory: string;
  let db: AetherDatabase;
  const updatedAt = "2026-01-01T00:00:00.000Z";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aether-score-batch-"));
    db = openDatabase(directory);
    syncConfiguredRoots(db, [
      {
        id: "root",
        label: "Library",
        inputPath: "./media",
        realPath: path.join(directory, "media")
      }
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    db?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function addAsset(id: string) {
    upsertAsset(db, {
      id,
      rootId: "root",
      folderId: folderIdFor("root", ""),
      relativePath: `${id}.jpg`,
      name: `${id}.jpg`,
      extension: ".jpg",
      mediaType: "image",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      mtimeMs: 1000,
      fingerprint: id,
      contentSha256: "a".repeat(64),
      fsDeviceId: null,
      fsInode: null,
      fsBirthtimeNs: null,
      fsCtimeNs: null,
      seenAt: updatedAt
    });
  }

  it("uses bounded reads for 500 items and returns canonical records in deduplicated request order", () => {
    const ids = Array.from({ length: 500 }, (_, index) => `asset-${index}`);
    db.transaction(() => ids.forEach(addAsset))();
    const prepare = db.prepare.bind(db);
    const readCounts: Array<() => number> = [];
    const prepared = vi.spyOn(db, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (/^\s*SELECT\b/i.test(sql)) {
        const get = vi.spyOn(statement, "get");
        const all = vi.spyOn(statement, "all");
        readCounts.push(() => get.mock.calls.length + all.mock.calls.length);
      }
      return statement;
    });
    const requested = [...ids].reverse();
    const result = updateAssetScoresBatch(db, {
      assetIds: [...requested, requested[0]!],
      score: 25,
      favorite: true,
      updatedAt
    });
    const reads = readCounts.reduce((sum, count) => sum + count(), 0);
    const writes = prepared.mock.calls.filter(
      ([sql]) => !/^\s*SELECT\b/i.test(sql)
    ).length;

    expect(reads).toBeLessThanOrEqual(6);
    expect(writes).toBeLessThanOrEqual(3);
    expect(result?.updated).toBe(500);
    expect(result?.assets.map((asset) => asset.id)).toEqual(requested);
    expect(
      result?.assets.every(
        (asset) =>
          asset.score === 25 &&
          asset.favorite &&
          asset.presentation.revision === 0
      )
    ).toBe(true);
  });

  it("preserves omitted scores or favorites across ranked and unranked items", () => {
    ["ranked", "peer", "plain"].forEach(addAsset);
    recordComparisonDecision(db, {
      leftAssetId: "ranked",
      rightAssetId: "peer",
      winnerAssetId: "ranked",
      createdAt: updatedAt
    });
    updateAssetScore(db, {
      assetId: "ranked",
      score: 17,
      favorite: false,
      updatedAt
    });
    updateAssetScore(db, {
      assetId: "plain",
      score: 9,
      favorite: true,
      updatedAt
    });
    db.prepare("INSERT INTO asset_manual_adjustments VALUES (?, ?, ?)").run(
      "plain",
      3,
      9
    );

    const favorites = updateAssetScoresBatch(db, {
      assetIds: ["plain", "ranked"],
      favorite: false,
      updatedAt
    });
    expect(favorites?.assets).toMatchObject([
      { id: "plain", score: 9, favorite: false },
      { id: "ranked", score: 17, favorite: false }
    ]);
    updateAssetScore(db, { assetId: "plain", favorite: true, updatedAt });
    const scores = updateAssetScoresBatch(db, {
      assetIds: ["ranked", "plain"],
      score: 0,
      updatedAt
    });
    expect(scores?.assets).toMatchObject([
      { id: "ranked", score: 0, favorite: false },
      { id: "plain", score: 0, favorite: true }
    ]);
    expect(
      db
        .prepare(
          "SELECT absolute_score FROM asset_manual_adjustments WHERE asset_id = ?"
        )
        .get("plain")
    ).toEqual({ absolute_score: 0 });
  });

  it("rolls back prior items, ranking changes and revision when a later write fails", () => {
    ["first", "second"].forEach(addAsset);
    recordComparisonDecision(db, {
      leftAssetId: "first",
      rightAssetId: "second",
      winnerAssetId: "first",
      createdAt: updatedAt
    });
    const before = [getAsset(db, "first"), getAsset(db, "second")];
    const revision = getLibraryRevision(db);
    db.exec(`CREATE TRIGGER reject_second_score
      BEFORE INSERT ON asset_annotations WHEN NEW.asset_id = 'second'
      BEGIN SELECT RAISE(ABORT, 'score rejected'); END;`);

    expect(() =>
      updateAssetScoresBatch(db, {
        assetIds: ["first", "second"],
        score: 25,
        favorite: true,
        updatedAt
      })
    ).toThrow(/score rejected/);
    expect([getAsset(db, "first"), getAsset(db, "second")]).toEqual(before);
    expect(getLibraryRevision(db)).toBe(revision);
  });

  it.each(["missing", "trashed"])(
    "does not update any item when a selected item is %s",
    (invalidId) => {
      addAsset("first");
      if (invalidId === "trashed") {
        addAsset(invalidId);
        db.prepare("UPDATE assets SET lifecycle = 'trashed' WHERE id = ?").run(
          invalidId
        );
      }
      const before = getAsset(db, "first");
      const revision = getLibraryRevision(db);

      expect(
        updateAssetScoresBatch(db, {
          assetIds: ["first", invalidId],
          score: 25,
          updatedAt
        })
      ).toBeNull();
      expect(getAsset(db, "first")).toEqual(before);
      expect(getLibraryRevision(db)).toBe(revision);
    }
  );
});
