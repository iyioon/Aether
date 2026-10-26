import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { getComparisonGeneration } from "../src/library/comparison-generation.js";
import {
  defaultPresentationValues,
  getPresentationRenditionKeys
} from "../src/library/presentation.js";
import { getPresentationsByAssetId } from "../src/library/repository-presentation.js";
import {
  folderIdFor,
  getAsset,
  getAssetsByIds,
  listAssets,
  recordComparisonDecision,
  resetLibraryData,
  getAssetSource,
  upsertAsset,
  upsertDerivative,
  saveAssetPresentation,
  setAssetTags,
  updateAssetScore
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";

describe("saved media presentation", () => {
  let cwd: string;
  let config: AppConfig;
  let db: AetherDatabase;
  let app: FastifyInstance;
  let auth: {
    cookies: Record<string, string>;
    headers: Record<string, string>;
  };
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "aether-presentation-"));
    await mkdir(path.join(cwd, "media"));
    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: await hashPassword("presentation-password"),
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "presentation-password" }
    });
    auth = {
      cookies: {
        aether_session: login.cookies.find(
          (cookie) => cookie.name === "aether_session"
        )!.value
      },
      headers: {
        "x-csrf-token": login.cookies.find(
          (cookie) => cookie.name === "aether_csrf"
        )!.value
      }
    };
  });
  afterEach(async () => {
    await app.close();
    db.close();
    await rm(cwd, { recursive: true, force: true });
  });

  it("protects edits with authentication and CSRF, persists framing and returns authoritative records", async () => {
    const asset = await image("one.jpg");
    const original = await readFile(path.join(cwd, "media", "one.jpg"));
    const payload = {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      fit: "cover",
      focalX: 0.2,
      focalY: 0.8,
      zoom: 2
    };
    expect(
      (await app.inject({ method: "PUT", url: url(asset.id), payload }))
        .statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: url(asset.id),
          cookies: auth.cookies,
          payload
        })
      ).statusCode
    ).toBe(403);
    const response = await put(asset.id, payload);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().asset.presentation).toMatchObject({
      fit: "cover",
      focalX: 0.2,
      focalY: 0.8,
      zoom: 2,
      revision: 1
    });
    expect(JSON.stringify(response.json())).not.toContain(cwd);
    expect(getAsset(db, asset.id)?.presentation).toEqual(
      response.json().asset.presentation
    );
    expect(list()[0]?.presentation).toEqual(response.json().asset.presentation);
    expect(getAssetsByIds(db, [asset.id])[0]?.presentation).toEqual(
      response.json().asset.presentation
    );
    expect(await readFile(path.join(cwd, "media", "one.jpg"))).toEqual(
      original
    );
  });

  it("allows only one concurrent expected revision and preserves the winning edit", async () => {
    const asset = await image("one.jpg");
    const responses = await Promise.all([
      put(asset.id, {
        ...defaultPresentationValues(),
        expectedRevision: 0,
        zoom: 2
      }),
      put(asset.id, {
        ...defaultPresentationValues(),
        expectedRevision: 0,
        zoom: 3
      })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409
    ]);
    const winner = responses
      .find((response) => response.statusCode === 200)!
      .json().asset;
    expect(
      responses.find((response) => response.statusCode === 409)!.json()
    ).toEqual({ error: "presentation_conflict", asset: winner });
    expect(getAsset(db, asset.id)).toEqual(winner);
  });

  it("rejects unknown fields, invalid bounds and timing edits on still images", async () => {
    const asset = await image("one.jpg");
    for (const edit of [
      { zoom: 0.9 },
      { zoom: 4.1 },
      { focalX: -0.1 },
      { focalY: 1.1 },
      { playbackRate: 1.3 },
      { expectedRevision: -1 },
      { expectedRevision: undefined },
      { path: "/private/source" }
    ]) {
      expect(
        (
          await put(asset.id, {
            ...defaultPresentationValues(),
            expectedRevision: 0,
            ...edit
          })
        ).statusCode
      ).toBe(400);
    }
    for (const edit of [
      { highlight: { startMs: 0, endMs: 500 } },
      { playbackRate: 2 },
      { loopMode: "bounce" }
    ]) {
      const response = await put(asset.id, {
        ...defaultPresentationValues(),
        expectedRevision: 0,
        ...edit
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("presentation_timing_not_supported");
    }
    expect(getAsset(db, asset.id)?.presentation.revision).toBe(0);
  });

  it("validates real video duration and accepts highlight, speed and bounded bounce", async () => {
    const asset = await video("clip.mp4");
    db.prepare("UPDATE assets SET duration_ms = 100000 WHERE id = ?").run(
      asset.id
    );
    for (const highlight of [
      { startMs: 500, endMs: 500 },
      { startMs: 500, endMs: 550 },
      { startMs: 500, endMs: 400 },
      { startMs: 0, endMs: 3000 }
    ]) {
      expect(
        (
          await put(asset.id, {
            ...defaultPresentationValues(),
            expectedRevision: 0,
            highlight
          })
        ).json().error
      ).toBe("invalid_highlight");
    }
    const response = await put(asset.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      highlight: { startMs: 200, endMs: 1200 },
      playbackRate: 1.5,
      loopMode: "bounce"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().asset.presentation).toMatchObject({
      revision: 1,
      highlight: { startMs: 200, endMs: 1200 },
      playbackRate: 1.5,
      loopMode: "bounce"
    });
  });

  it("bounds bounce duration and permits a short section of a longer video", async () => {
    const asset = await video("long.mp4", 12);
    const full = await put(asset.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      loopMode: "bounce"
    });
    expect(full.statusCode).toBe(400);
    expect(full.json().error).toBe("bounce_duration_exceeded");
    expect(
      (
        await put(asset.id, {
          ...defaultPresentationValues(),
          expectedRevision: 0,
          loopMode: "bounce",
          highlight: { startMs: 1000, endMs: 2000 }
        })
      ).statusCode
    ).toBe(200);
  });

  it("rejects changed source identity and symlink escapes without leaking paths", async () => {
    const asset = await image("one.jpg");
    await writeFile(path.join(cwd, "media", "one.jpg"), "replacement");
    const changed = await put(asset.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      zoom: 2
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toEqual({ error: "source_changed" });
    await rm(path.join(cwd, "media", "one.jpg"));
    await writeFile(path.join(cwd, "outside.jpg"), "private");
    await symlink(
      path.join(cwd, "outside.jpg"),
      path.join(cwd, "media", "one.jpg")
    );
    const escaped = await put(asset.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0
    });
    expect(escaped.statusCode).toBe(403);
    expect(escaped.body).not.toContain(cwd);
    expect(getAsset(db, asset.id)?.presentation.revision).toBe(0);
  });

  it("selectively resets playback and framing without changing annotations, comparison generation or undo", async () => {
    const first = await image("one.jpg");
    const second = await image("two.jpg");
    updateAssetScore(db, {
      assetId: first.id,
      score: 75,
      favorite: true,
      updatedAt: now()
    });
    setAssetTags(db, first.id, ["Keep"]);
    recordComparisonDecision(db, {
      leftAssetId: first.id,
      rightAssetId: second.id,
      winnerAssetId: first.id,
      createdAt: now()
    });
    const generation = getComparisonGeneration(db);
    saveAssetPresentation(db, {
      assetId: first.id,
      expectedRevision: 0,
      values: {
        ...defaultPresentationValues(),
        zoom: 2,
        playbackRate: 2,
        highlight: { startMs: 100, endMs: 500 },
        loopMode: "bounce"
      },
      sourceMtimeMs: first.mtimeMs,
      sourceSizeBytes: first.sizeBytes,
      updatedAt: now()
    });
    const reset = await app.inject({
      method: "POST",
      url: "/api/admin/database/reset",
      ...auth,
      payload: { confirmation: "RESET", presentationPlayback: true }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      playbackReset: 1,
      framingReset: 0,
      comparisonEventsRemoved: 0
    });
    expect(getAsset(db, first.id)).toMatchObject({
      score: 75,
      favorite: true,
      tags: [{ displayName: "Keep" }],
      presentation: {
        zoom: 2,
        playbackRate: 1,
        highlight: null,
        loopMode: "repeat",
        revision: 2
      }
    });
    expect(getComparisonGeneration(db)).toBe(generation);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM comparison_events").get()
    ).toEqual({ count: 1 });
    expect(
      (
        await put(first.id, {
          ...defaultPresentationValues(),
          expectedRevision: 1
        })
      ).statusCode
    ).toBe(409);
    const result = resetLibraryData(
      db,
      {
        scores: false,
        favorites: false,
        tags: false,
        comparisons: false,
        presentationFraming: true
      },
      now()
    );
    expect(result).toMatchObject({ playbackReset: 0, framingReset: 1 });
    expect(getAsset(db, first.id)?.presentation).toMatchObject({
      revision: 3,
      ...defaultPresentationValues()
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/admin/settings",
          cookies: auth.cookies
        })
      ).json().library.presentationEdits
    ).toEqual({ playback: 0, framing: 0 });
  });

  it("removes only obsolete playback files during reset and retains source-independent derivatives", async () => {
    const asset = await image("one.jpg");
    saveAssetPresentation(db, {
      assetId: asset.id,
      expectedRevision: 0,
      values: { ...defaultPresentationValues(), playbackRate: 2 },
      sourceMtimeMs: asset.mtimeMs,
      sourceSizeBytes: asset.sizeBytes,
      updatedAt: now()
    });
    const directory = path.join(config.cacheDir, "presentations", asset.id);
    await mkdir(directory, { recursive: true });
    for (const [id, kind] of [
      ["old-highlight", "presentation:highlight-mp4:key:0"],
      ["old-bounce", "presentation:bounce-mp4:key:0"],
      ["full", "presentation:full-mp4:key:0"],
      ["animation", "presentation:animation:key:0"]
    ]) {
      const cachedPath = path.join(directory, `${id}.bin`);
      await writeFile(cachedPath, id!);
      upsertDerivative(db, {
        id: id!,
        assetId: asset.id,
        kind: kind!,
        width: 32,
        height: 24,
        path: cachedPath,
        sourceMtimeMs: asset.mtimeMs,
        status: "ready",
        error: null,
        createdAt: now()
      });
    }
    const reset = await app.inject({
      method: "POST",
      url: "/api/admin/database/reset",
      ...auth,
      payload: { confirmation: "RESET", presentationPlayback: true }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().playbackReset).toBe(1);
    for (const id of ["old-highlight", "old-bounce"])
      await expect(
        readFile(path.join(directory, `${id}.bin`))
      ).rejects.toThrow();
    for (const id of ["full", "animation"])
      expect(await readFile(path.join(directory, `${id}.bin`), "utf8")).toBe(
        id
      );
    expect(db.prepare("SELECT id FROM derivatives ORDER BY id").all()).toEqual([
      { id: "animation" },
      { id: "full" }
    ]);
  });

  it("retires obsolete range renditions on save while retaining bytes for framing and speed changes", async () => {
    const asset = await video("edits.mp4");
    const values = {
      ...defaultPresentationValues(),
      highlight: { startMs: 0, endMs: 1000 }
    };
    const first = await put(asset.id, { ...values, expectedRevision: 0 });
    expect(first.statusCode).toBe(200);
    const keys = first.json().asset.presentation.renditionKeys;
    const directory = path.join(config.cacheDir, "presentations", asset.id);
    await mkdir(directory, { recursive: true });
    for (const [id, kind] of [
      ["highlight", `presentation:highlight-mp4:${keys.highlight}:0`],
      ["bounce", `presentation:bounce-mp4:${keys.bounce}:0`],
      ["full", `presentation:full-mp4:${keys.full}:0`]
    ]) {
      const cachedPath = path.join(directory, `${id}.mp4`);
      await writeFile(cachedPath, id!);
      upsertDerivative(db, {
        id: id!,
        assetId: asset.id,
        kind: kind!,
        width: 32,
        height: 24,
        path: cachedPath,
        sourceMtimeMs: asset.mtimeMs,
        status: "ready",
        error: null,
        createdAt: now()
      });
    }
    expect(
      (
        await put(asset.id, {
          ...values,
          expectedRevision: 1,
          playbackRate: 2,
          zoom: 2
        })
      ).statusCode
    ).toBe(200);
    expect(await readFile(path.join(directory, "highlight.mp4"), "utf8")).toBe(
      "highlight"
    );
    expect(await readFile(path.join(directory, "bounce.mp4"), "utf8")).toBe(
      "bounce"
    );
    expect(
      (await put(asset.id, { ...values, expectedRevision: 2, highlight: null }))
        .statusCode
    ).toBe(200);
    for (const id of ["highlight", "bounce"])
      await expect(
        readFile(path.join(directory, `${id}.mp4`))
      ).rejects.toThrow();
    expect(await readFile(path.join(directory, "full.mp4"), "utf8")).toBe(
      "full"
    );
    expect(db.prepare("SELECT id FROM derivatives").all()).toEqual([
      { id: "full" }
    ]);
  });

  it("hydrates presentations in bounded batches and preserves requested order", async () => {
    const asset = await image("one.jpg");
    const assets = Array.from({ length: 901 }, (_, index) => ({
      ...asset,
      id: `not-indexed-${index}`
    }));
    const prepare = vi.spyOn(db, "prepare");
    const hydrated = getPresentationsByAssetId(db, assets);
    expect(hydrated.size).toBe(901);
    expect(prepare.mock.calls).toHaveLength(3);
    prepare.mockRestore();
    const second = await image("two.jpg");
    expect(
      getAssetsByIds(db, [second.id, asset.id]).map((record) => record.id)
    ).toEqual([second.id, asset.id]);
  });

  it("hydrates presentation in score, batch and comparison responses", async () => {
    const first = await image("one.jpg");
    const second = await image("two.jpg");
    const saved = await put(first.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      zoom: 2
    });
    const presentation = saved.json().asset.presentation;
    const score = await app.inject({
      method: "PATCH",
      url: `/api/assets/${first.id}/score`,
      ...auth,
      payload: { favorite: true }
    });
    expect(score.json().asset.presentation).toEqual(presentation);
    const batch = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/scores",
      ...auth,
      payload: { assetIds: [second.id, first.id], score: 5 }
    });
    expect(batch.json().assets[1].presentation).toEqual(presentation);
    const vote = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      ...auth,
      payload: {
        leftAssetId: first.id,
        rightAssetId: second.id,
        winnerAssetId: first.id
      }
    });
    expect(vote.statusCode).toBe(200);
    expect(
      vote.json().assets.find((asset: { id: string }) => asset.id === first.id)
        .presentation
    ).toEqual(presentation);
    const undone = await app.inject({
      method: "POST",
      url: `/api/comparisons/${vote.json().eventId}/undo`,
      ...auth,
      payload: {}
    });
    expect(undone.statusCode).toBe(200);
    expect(
      undone
        .json()
        .assets.find((asset: { id: string }) => asset.id === first.id)
        .presentation
    ).toEqual(presentation);
  });

  it("preserves presentation after a metadata-only touch and clears it when source bytes change", async () => {
    const asset = await image("one.jpg");
    await put(asset.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      zoom: 2
    });
    const sourcePath = path.join(cwd, "media", "one.jpg");
    const before = await stat(sourcePath);
    await utimes(sourcePath, before.atime, new Date(before.mtimeMs + 5000));
    await scanLibrary(db, config.mediaRoots);
    expect(getAsset(db, asset.id)?.presentation).toMatchObject({
      revision: 1,
      zoom: 2
    });
    await sharp({
      create: { width: 32, height: 24, channels: 3, background: "blue" }
    })
      .jpeg()
      .toFile(sourcePath);
    await scanLibrary(db, config.mediaRoots);
    const indexed = list().find((item) => item.name === "one.jpg")!;
    expect(indexed.presentation.zoom).toBe(1);
    if (indexed.id === asset.id) expect(indexed.presentation.revision).toBe(2);
    else expect(getAsset(db, asset.id)).toBeNull();
  });

  it("invalidates earlier revisions if repository upsert replaces source bytes", async () => {
    const asset = await image("one.jpg");
    await put(asset.id, {
      ...defaultPresentationValues(),
      expectedRevision: 0,
      zoom: 2
    });
    const source = getAssetSource(db, asset.id)!;
    const identity = db
      .prepare("SELECT content_sha256, fingerprint FROM assets WHERE id = ?")
      .get(asset.id) as { content_sha256: string; fingerprint: string };
    const input = {
      id: asset.id,
      rootId: source.rootId,
      folderId: source.folderId!,
      relativePath: source.relativePath,
      name: source.name,
      extension: source.extension,
      mediaType: source.mediaType,
      mimeType: source.mimeType!,
      sizeBytes: source.sizeBytes,
      mtimeMs: source.mtimeMs + 5000,
      fingerprint: identity.fingerprint,
      contentSha256: identity.content_sha256,
      fsDeviceId: null,
      fsInode: null,
      fsBirthtimeNs: null,
      fsCtimeNs: null,
      seenAt: now()
    };
    upsertAsset(db, input);
    expect(getAsset(db, asset.id)?.presentation).toMatchObject({
      revision: 1,
      zoom: 2
    });
    upsertAsset(db, {
      ...input,
      contentSha256: "f".repeat(64),
      mtimeMs: source.mtimeMs + 10000
    });
    expect(getAsset(db, asset.id)?.presentation).toMatchObject({
      revision: 2,
      zoom: 1
    });
    db.prepare("DELETE FROM asset_presentations WHERE asset_id = ?").run(
      asset.id
    );
    upsertAsset(db, {
      ...input,
      contentSha256: "a".repeat(64),
      mtimeMs: source.mtimeMs + 15000
    });
    expect(getAsset(db, asset.id)?.presentation).toMatchObject({
      revision: 1,
      zoom: 1
    });
  });

  it("keeps byte keys stable for framing and speed while range and source changes invalidate relevant renditions", () => {
    const asset = { id: "opaque-asset", mtimeMs: 123, sizeBytes: 456 };
    const values = defaultPresentationValues();
    const base = getPresentationRenditionKeys(asset, values);
    expect(Object.values(base).every((key) => /^[a-f0-9]{32}$/.test(key))).toBe(
      true
    );
    expect(
      getPresentationRenditionKeys(asset, {
        ...values,
        fit: "cover",
        zoom: 3,
        focalX: 0,
        playbackRate: 2
      })
    ).toEqual(base);
    const highlighted = getPresentationRenditionKeys(asset, {
      ...values,
      highlight: { startMs: 100, endMs: 500 }
    });
    expect(highlighted.full).toBe(base.full);
    expect(highlighted.highlight).not.toBe(base.highlight);
    expect(highlighted.bounce).not.toBe(base.bounce);
    expect(
      getPresentationRenditionKeys({ ...asset, mtimeMs: 124 }, values).full
    ).not.toBe(base.full);
  });

  const url = (id: string) => `/api/assets/${id}/presentation`;
  const now = () => new Date().toISOString();
  const put = (id: string, payload: unknown) =>
    app.inject({
      method: "PUT",
      url: url(id),
      ...auth,
      payload: payload as Record<string, unknown>
    });
  function list() {
    return listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items;
  }
  async function image(name: string) {
    await sharp({
      create: { width: 32, height: 24, channels: 3, background: "red" }
    })
      .jpeg()
      .toFile(path.join(cwd, "media", name));
    await scanLibrary(db, config.mediaRoots);
    return list().find((asset) => asset.name === name)!;
  }
  async function video(name: string, duration = 2) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=32x24:r=10",
          "-t",
          String(duration),
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          path.join(cwd, "media", name)
        ],
        { stdio: "ignore" }
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Video fixture generation failed."))
      );
    });
    await scanLibrary(db, config.mediaRoots);
    return list().find((asset) => asset.name === name)!;
  }
});
