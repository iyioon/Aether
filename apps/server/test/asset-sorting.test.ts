import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createSession } from "../src/auth/sessions.js";
import { loadConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { getComparisonGeneration } from "../src/library/comparison-generation.js";
import {
  folderIdFor,
  setAssetTags,
  updateAssetScore,
  upsertAsset,
  upsertFolder,
  type AssetRecord
} from "../src/library/repository.js";

interface ListedAssets {
  items: AssetRecord[];
  page: { total: number; revision: string };
  sort: string;
  order: string;
  sortCriteria: Array<{ field: string; direction: string }>;
  tagMatch: string;
  tagStatus: string;
}

describe("ordered asset sorting and tag filters", () => {
  let directory: string;
  let app: FastifyInstance;
  let db: AetherDatabase;
  let headers: Record<string, string>;
  let folderId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aether-sort-"));
    await mkdir(path.join(directory, "media"));
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "Library=./media",
        AETHER_DATA_DIR: "./data",
        AETHER_PASSWORD_HASH: await hashPassword("sort-test-password"),
        AETHER_SESSION_SECRET: "sort-test-session-secret-is-long-enough",
        NODE_ENV: "test"
      },
      directory
    );
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
    const rootId = config.mediaRoots[0]!.id;
    folderId = folderIdFor(rootId, "");
    const now = new Date().toISOString();
    const nestedId = upsertFolder(db, {
      rootId,
      parentId: folderId,
      relativePath: "Nested",
      name: "Nested",
      seenAt: now
    });
    for (const [id, name, score, favorite, nested, tags] of [
      ["a", "Zed.jpg", 10, true, false, ["Alpha", "Zulu"]],
      ["b", "Able.jpg", 10, false, false, ["Alpha", "Beta"]],
      ["c", "Clip.mp4", 5, true, false, ["Beta"]],
      ["d", "Blank.jpg", 0, false, false, []],
      ["e", "Nested.mp4", 0, false, true, ["Alpha"]],
      ["f", "Plain.jpg", 0, true, true, []],
      ["trashed", "Trashed.jpg", 0, false, false, ["Alpha"]]
    ] as const) {
      upsertAsset(db, {
        id,
        rootId,
        folderId: nested ? nestedId : folderId,
        relativePath: nested ? `Nested/${name}` : name,
        name,
        extension: path.posix.extname(name),
        mediaType: name.endsWith(".mp4") ? "video" : "image",
        mimeType: name.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
        sizeBytes: 100,
        mtimeMs: 1000,
        fingerprint: `fixture-${id}`,
        contentSha256: "a".repeat(64),
        fsDeviceId: null,
        fsInode: null,
        fsBirthtimeNs: null,
        fsCtimeNs: null,
        seenAt: now
      });
      updateAssetScore(db, { assetId: id, score, favorite, updatedAt: now });
      setAssetTags(db, id, [...tags], now);
    }
    db.prepare(
      "UPDATE assets SET lifecycle='trashed' WHERE id='trashed'"
    ).run();
    const session = createSession(db, 1);
    headers = {
      cookie: `${config.sessionCookieName}=${encodeURIComponent(app.signCookie(session.sessionToken))}`,
      "x-csrf-token": session.csrfToken
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    db?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function list(query = "") {
    const response = await app.inject({
      url: `/api/folders/${folderId}/assets?${query}`,
      headers
    });
    expect(response.statusCode).toBe(200);
    return response.json<ListedAssets>();
  }

  it("honors explicit criterion priority, preserves legacy defaults and paginates a stable total order", async () => {
    const legacy = await list("sort=score");
    expect(legacy.items.slice(0, 2).map((asset) => asset.id)).toEqual([
      "a",
      "b"
    ]);
    expect(legacy).toMatchObject({
      sort: "score",
      order: "desc",
      sortCriteria: [{ field: "score", direction: "desc" }],
      tagMatch: "all",
      tagStatus: "all"
    });
    const query = "sortBy=score:desc&sortBy=filename:asc";
    const sorted = await list(query);
    expect(sorted.items.map((asset) => asset.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
      "e",
      "f"
    ]);
    expect(sorted.sortCriteria).toEqual([
      { field: "score", direction: "desc" },
      { field: "filename", direction: "asc" }
    ]);
    const paginated: string[] = [];
    for (let offset = 0; offset < 6; offset += 2)
      paginated.push(
        ...(
          await list(
            `${query}&limit=2&offset=${offset}&expectedRevision=${sorted.page.revision}`
          )
        ).items.map((asset) => asset.id)
      );
    expect(paginated).toEqual(sorted.items.map((asset) => asset.id));
    db.prepare(
      "UPDATE assets SET name='same.jpg' WHERE lifecycle='active'"
    ).run();
    const ties = await list("sortBy=date:asc&sortBy=filename:desc");
    expect(ties.items.map((asset) => asset.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f"
    ]);
    expect((await list("sort=oldest")).order).toBe("asc");
    expect((await list("sort=newest&order=asc")).order).toBe("desc");
    const random = await list("sort=random&seed=17");
    expect(random.sortCriteria).toEqual([]);
    expect(
      (await list("sort=random&seed=17")).items.map((asset) => asset.id)
    ).toEqual(random.items.map((asset) => asset.id));
  });

  it("rejects malformed, duplicate, random-combined and oversized sorting or filter values", async () => {
    for (const query of [
      "sortBy=",
      "sortBy=random:asc",
      "sortBy=score:down",
      "sortBy=score:asc:desc",
      "sortBy=score:desc&sortBy=score:asc",
      "sort=random&sortBy=filename:asc",
      "sortBy=date:asc&sortBy=filename:asc&sortBy=score:asc&sortBy=favorite:asc&sortBy=size:asc&sortBy=tags:asc",
      "sortBy=filename%3BDROP%20TABLE%20assets:asc",
      "tagMatch=none",
      "tagStatus=missing"
    ]) {
      const response = await app.inject({
        url: `/api/folders/${folderId}/assets?${query}`,
        headers
      });
      expect(response.statusCode, query).toBe(400);
    }
    expect(
      (
        await list(
          "sortBy=type:asc&sortBy=tags:asc&sortBy=size:desc&sortBy=duration:desc&sortBy=date:desc"
        )
      ).items
    ).toHaveLength(6);
  });

  it("uses the same any/all and tagged/untagged filters for listing, comparison and detail membership", async () => {
    for (const [tagMatch, tagStatus, tags, expected] of [
      ["all", "all", ["Alpha", "Beta"], ["b"]],
      ["any", "all", ["Alpha", "Beta"], ["a", "b", "c", "e"]],
      ["all", "tagged", [], ["a", "b", "c", "e"]],
      ["all", "untagged", [], ["d", "f"]],
      ["any", "untagged", ["Alpha"], []]
    ] as const) {
      const query = new URLSearchParams({
        tagMatch,
        tagStatus,
        sort: "filename"
      });
      for (const tag of tags) query.append("tag", tag);
      const listed = await list(query.toString());
      expect(listed.items.map((asset) => asset.id).sort()).toEqual([
        ...expected
      ]);
      const filter = {
        folderId,
        type: "all",
        recursive: true,
        search: "",
        tags,
        tagMatch,
        tagStatus,
        scoreFilter: "all"
      };
      const details = await app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        headers,
        payload: { assetIds: ["f", "e", "d", "c", "b", "a", "trashed"], filter }
      });
      expect(details.statusCode).toBe(200);
      expect(
        details.json<{ matchingAssetIds: string[] }>().matchingAssetIds
      ).toEqual(
        ["f", "e", "d", "c", "b", "a"].filter((id) =>
          (expected as readonly string[]).includes(id)
        )
      );
      const next = await app.inject({
        url: `/api/folders/${folderId}/comparisons/next?${query}`,
        headers
      });
      expect(next.statusCode).toBe(expected.length < 2 ? 404 : 200);
      if (expected.length >= 2)
        expect(
          next.json<{ progress: { candidateCount: number } }>().progress
            .candidateCount
        ).toBe(expected.length);
      const context = { ...filter, score: "all" };
      const prefetched = await app.inject({
        method: "POST",
        url: `/api/folders/${folderId}/comparisons/prefetch`,
        headers,
        payload: { ...context, count: 3 }
      });
      expect(prefetched.statusCode).toBe(200);
      const prepared = prefetched.json<{
        pairs: Array<{ left: AssetRecord; right: AssetRecord }>;
      }>().pairs;
      expect(
        prepared
          .flatMap((pair) => [pair.left.id, pair.right.id])
          .every((id) => (expected as readonly string[]).includes(id))
      ).toBe(true);
      const resumed = await app.inject({
        method: "POST",
        url: `/api/folders/${folderId}/comparisons/resume`,
        headers,
        payload: {
          ...context,
          pairAssetIds:
            expected.length >= 2 ? expected.slice(0, 2) : ["a", "b"],
          previousDecision: null
        }
      });
      expect(resumed.statusCode).toBe(200);
      const pair = resumed.json<{
        pair: {
          left: AssetRecord;
          right: AssetRecord;
          progress: { candidateCount: number };
        } | null;
      }>().pair;
      if (expected.length < 2) expect(pair).toBeNull();
      else {
        expect(pair!.progress.candidateCount).toBe(expected.length);
        expect(
          [pair!.left.id, pair!.right.id].every((id) =>
            (expected as readonly string[]).includes(id)
          )
        ).toBe(true);
      }
    }
  });

  it("reconciles score and tag changes through revision checks and canonical detail membership", async () => {
    const before = await list(
      "sortBy=tags:asc&sortBy=score:desc&tagMatch=any&tag=Alpha&tag=Beta"
    );
    const score = await app.inject({
      method: "PATCH",
      url: "/api/assets/c/score",
      headers,
      payload: { score: 30 }
    });
    expect(score.statusCode).toBe(200);
    expect(
      (await list("sortBy=score:desc&sortBy=filename:asc")).items[0]!.id
    ).toBe("c");
    const update = await app.inject({
      method: "PUT",
      url: "/api/assets/a/tags",
      headers,
      payload: { tags: [] }
    });
    expect(update.statusCode).toBe(200);
    const stale = await app.inject({
      url: `/api/folders/${folderId}/assets?sortBy=tags:asc&expectedRevision=${before.page.revision}`,
      headers
    });
    expect(stale.statusCode).toBe(409);
    const refreshed = await list(
      "sortBy=tags:asc&sortBy=score:desc&tagMatch=any&tag=Alpha&tag=Beta"
    );
    expect(refreshed.items.map((asset) => asset.id)).not.toContain("a");
    const response = await app.inject({
      method: "POST",
      url: "/api/assets/batch/details",
      headers,
      payload: {
        assetIds: ["a", "b"],
        filter: {
          folderId,
          tags: ["Alpha", "Beta"],
          tagMatch: "any",
          tagStatus: "tagged"
        }
      }
    });
    expect(
      response.json<{ matchingAssetIds: string[] }>().matchingAssetIds
    ).toEqual(["b"]);
  });

  it("applies tag matching and status to the next pair returned after an acknowledged choice", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      headers,
      payload: {
        leftAssetId: "a",
        rightAssetId: "b",
        winnerAssetId: "a",
        mutationId: randomUUID(),
        comparisonGeneration: getComparisonGeneration(db),
        nextPairAssetIds: ["c", "e"],
        pairContext: {
          folderId,
          type: "all",
          recursive: true,
          search: "",
          tags: ["Alpha", "Beta"],
          tagMatch: "any",
          tagStatus: "tagged",
          score: "all"
        }
      }
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<{
      nextPair: {
        left: AssetRecord;
        right: AssetRecord;
        progress: { candidateCount: number };
      };
    }>();
    expect([result.nextPair.left.id, result.nextPair.right.id]).toEqual([
      "c",
      "e"
    ]);
    expect(result.nextPair.progress.candidateCount).toBe(4);
  });
});
