import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { scanLibrary } from "../src/library/scanner.js";
import {
  folderIdFor,
  getAsset,
  listAssets
} from "../src/library/repository.js";
import { registerPresentationMediaRoutes } from "../src/library/routes-presentation-media.js";
import {
  removeAssetDerivativeCache,
  sweepDerivativeCache
} from "../src/library/derivative-cache.js";
import { resetLibraryData } from "../src/library/repository-reset.js";
import * as processing from "../src/library/video-processing.js";
import * as bounce from "../src/library/presentation-bounce.js";
import { ensurePresentationDerivative } from "../src/library/presentation-cache.js";
import { resolveAssetFile } from "../src/library/media-serving.js";
import { readBounceCache } from "../src/library/presentation-bounce-cache.js";
import * as privateCache from "../src/security/private-cache-file.js";

let directory: string;
let config: AppConfig;
let db: AetherDatabase;
let app: FastifyInstance;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aether-bounce-cache-"));
  await mkdir(path.join(directory, "media"));
  config = await loadConfig(
    {
      AETHER_MEDIA_ROOTS: "./media",
      AETHER_DATA_DIR: "./data",
      AETHER_PASSWORD_HASH: await hashPassword("bounce-cache-test"),
      AETHER_SESSION_SECRET: "bounce-cache-test-secret-long-enough"
    },
    directory
  );
  db = openDatabase(config.configDir);
  app = fastify();
  registerPresentationMediaRoutes(app, config, db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  db.close();
  await rm(directory, { recursive: true, force: true });
});
async function restart() {
  await app.close();
  db.close();
  db = openDatabase(config.configDir);
  app = fastify();
  registerPresentationMediaRoutes(app, config, db);
}
async function prepare(rate = 24, codec = "h264") {
  const sourcePath = path.join(directory, "media", "clip.mp4");
  await processing.runMediaCommand(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=48x32:rate=${rate}:duration=1`,
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-color_range",
      "tv",
      "-y",
      sourcePath
    ],
    10_000
  );
  await scanLibrary(db, config.mediaRoots);
  const indexed = listAssets(db, {
    folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
    offset: 0,
    limit: 1,
    sort: "filename",
    type: "all",
    recursive: true
  })!.items[0]!;
  db.prepare(
    "INSERT INTO asset_presentations (asset_id, revision, highlight_start_ms, highlight_end_ms, fit, focal_x, focal_y, zoom, playback_rate, loop_mode, updated_at) VALUES (?,1,100,600,'auto',0.5,0.5,1,1,'bounce','2026-01-01T00:00:00.000Z')"
  ).run(indexed.id);
  const asset = getAsset(db, indexed.id)!;
  const url = `/api/assets/${asset.id}/playback?variant=bounce&v=${asset.presentation.renditionKeys.bounce}&codec=${codec}`;
  const response = await app.inject(url);
  expect(response.statusCode).toBe(200);
  const destination = path.join(
    config.cacheDir,
    "presentations",
    asset.id,
    `${asset.presentation.renditionKeys.bounce}-${codec === "h264" ? "h264.mp4" : "mp4"}`
  );
  return {
    asset,
    sourcePath,
    url,
    destination,
    metadataPath: `${destination}.json`,
    bytes: response.rawPayload,
    capabilitiesUrl: `/api/assets/${asset.id}/presentation-media`
  };
}

describe("persistent Bounce startup cache", () => {
  it("does not treat a failed rendition fingerprint check as missing optional metadata", async () => {
    const prepared = await prepare();
    const file = (await resolveAssetFile(db, prepared.asset.id))!;
    const originalOpen = privateCache.openPrivateCacheFile;
    vi.spyOn(privateCache, "openPrivateCacheFile").mockImplementation(
      async (filePath, cacheDir) => {
        if (filePath === prepared.destination)
          throw Object.assign(new Error("Cache file became unavailable."), {
            code: "EIO"
          });
        return originalOpen(filePath, cacheDir);
      }
    );
    expect(
      await readBounceCache(
        db,
        config,
        file,
        prepared.asset.presentation.renditionKeys.bounce,
        "h264"
      )
    ).toEqual({ validFile: false, metadata: null });
  });

  it("coalesces preparation without holding the encoding slots needed by other preparations", async () => {
    const prepared = await prepare();
    const file = (await resolveAssetFile(db, prepared.asset.id))!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let starts = 0;
    const preparation = vi.fn(() =>
      processing.withVideoProcessingSlot(async () => {
        starts++;
        if (starts === 2) ready();
        await blocked;
      })
    );
    const generate = async (temporary: string) => {
      await writeFile(temporary, "prepared derivative");
      return "video/mp4";
    };
    const request = (suffix: string) =>
      ensurePresentationDerivative(
        db,
        config,
        file,
        "bounce",
        prepared.asset.presentation.renditionKeys.bounce,
        suffix,
        generate,
        undefined,
        { prepare: preparation }
      );
    const first = request("first.mp4");
    const same = request("first.mp4");
    const second = request("second.mp4");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        bothReady,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "A preparation held an encoding slot while waiting for another slot."
                )
              ),
            3000
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
      release();
      await Promise.all([first, same, second]);
    }
    expect(preparation).toHaveBeenCalledTimes(2);
    expect((await first).path).toBe((await same).path);
  });

  it("serves playback, ranges, HEAD and source timeline after reopening the database without media commands", async () => {
    const prepared = await prepare();
    const expected = (await app.inject(prepared.capabilitiesUrl)).json();
    expect(expected.bounceTimeline.sourceTimesMs.length).toBeGreaterThan(1);
    const content = await readFile(prepared.metadataPath, "utf8");
    expect(content).not.toContain(directory);
    expect((await stat(prepared.metadataPath)).mode & 0o777).toBe(0o600);
    await restart();
    await sweepDerivativeCache(db, config.cacheDir, { pruneStaleFiles: true });
    expect((await stat(prepared.metadataPath)).isFile()).toBe(true);
    const command = vi
      .spyOn(processing, "runMediaCommand")
      .mockRejectedValue(
        new Error("A cache hit must not start a media process.")
      );
    const playback = await app.inject(prepared.url);
    expect(playback.statusCode, playback.payload).toBe(200);
    expect(playback.rawPayload).toEqual(prepared.bytes);
    const range = await app.inject({
      url: prepared.url,
      headers: { range: "bytes=0-31" }
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(prepared.bytes.subarray(0, 32));
    const head = await app.inject({ method: "HEAD", url: prepared.url });
    expect(head.statusCode).toBe(200);
    expect(head.payload).toBe("");
    const capabilities = await app.inject(prepared.capabilitiesUrl);
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toEqual(expected);
    expect(command).not.toHaveBeenCalled();
  });

  it("retains the source frame-rate limit in cached capabilities", async () => {
    const prepared = await prepare(240);
    await restart();
    const command = vi
      .spyOn(processing, "runMediaCommand")
      .mockRejectedValue(new Error("Unexpected process"));
    const capabilities = await app.inject(prepared.capabilitiesUrl);
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().maxBounceDurationMs).toBe(15_000);
    expect(command).not.toHaveBeenCalled();
  });

  it("backfills an older registered MP4 after one normal analysis and reuses it on the next restart", async () => {
    const prepared = await prepare();
    db.prepare("DELETE FROM derivatives WHERE path = ?").run(
      prepared.metadataPath
    );
    await rm(prepared.metadataPath);
    await restart();
    const command = vi.spyOn(processing, "runMediaCommand");
    const playback = await app.inject(prepared.url);
    expect(playback.statusCode).toBe(200);
    expect(playback.rawPayload).toEqual(prepared.bytes);
    expect(command).not.toHaveBeenCalled();
    expect((await app.inject(prepared.capabilitiesUrl)).statusCode).toBe(200);
    expect(command.mock.calls.some(([name]) => name === "ffprobe")).toBe(true);
    expect(command.mock.calls.some(([name]) => name === "ffmpeg")).toBe(false);
    expect((await stat(prepared.metadataPath)).isFile()).toBe(true);
    await restart();
    command.mockClear();
    expect((await app.inject(prepared.capabilitiesUrl)).statusCode).toBe(200);
    expect((await app.inject(prepared.url)).rawPayload).toEqual(prepared.bytes);
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["malformed", "oversized", "timeline", "key", "codec"])(
    "ignores %s optional metadata without blocking a valid cached MP4",
    async (kind) => {
      const prepared = await prepare();
      const metadata = JSON.parse(
        await readFile(prepared.metadataPath, "utf8")
      );
      if (kind === "timeline") metadata.timeline.durationsMs[0] = -1;
      if (kind === "key") metadata.key = "0".repeat(32);
      if (kind === "codec") metadata.codec = "hevc";
      await writeFile(
        prepared.metadataPath,
        kind === "malformed"
          ? "{"
          : kind === "oversized"
            ? " ".repeat(256 * 1024 + 1)
            : JSON.stringify(metadata)
      );
      await restart();
      const command = vi.spyOn(processing, "runMediaCommand");
      expect((await app.inject(prepared.url)).rawPayload).toEqual(
        prepared.bytes
      );
      expect(command).not.toHaveBeenCalled();
      const capabilities = await app.inject(prepared.capabilitiesUrl);
      expect(capabilities.statusCode).toBe(200);
      expect(
        capabilities
          .json()
          .bounceTimeline.durationsMs.every((time: number) => time > 0)
      ).toBe(true);
      expect(command.mock.calls.some(([name]) => name === "ffprobe")).toBe(
        true
      );
      expect(command.mock.calls.some(([name]) => name === "ffmpeg")).toBe(
        false
      );
    }
  );

  it("regenerates a changed same-size rendition instead of streaming its altered bytes", async () => {
    const prepared = await prepare();
    const info = await stat(prepared.destination);
    const corrupt = Buffer.alloc(prepared.bytes.length, 9);
    await writeFile(prepared.destination, corrupt);
    await utimes(prepared.destination, info.atime, info.mtime);
    await restart();
    const generate = vi.spyOn(bounce, "generateLosslessBounce");
    const response = await app.inject(prepared.url);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(prepared.bytes);
    expect(generate).toHaveBeenCalledOnce();
    expect((await app.inject(prepared.capabilitiesUrl)).statusCode).toBe(200);
    expect(
      (await readdir(path.dirname(prepared.destination))).some((name) =>
        name.endsWith(".tmp")
      )
    ).toBe(false);
  });

  it("rejects a stale source/key before serving cached bytes", async () => {
    const prepared = await prepare();
    const info = await stat(prepared.sourcePath);
    await utimes(
      prepared.sourcePath,
      info.atime,
      new Date(info.mtimeMs + 5000)
    );
    await restart();
    const command = vi.spyOn(processing, "runMediaCommand");
    const response = await app.inject(prepared.url);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("stale_rendition");
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["symlink", "hardlink"])(
    "never follows %s metadata outside the private cache",
    async (kind) => {
      const prepared = await prepare();
      const outside = path.join(directory, "external.json");
      const original = await readFile(prepared.metadataPath);
      await writeFile(outside, original);
      await rm(prepared.metadataPath);
      if (kind === "symlink") await symlink(outside, prepared.metadataPath);
      else await link(outside, prepared.metadataPath);
      await restart();
      const command = vi.spyOn(processing, "runMediaCommand");
      expect((await app.inject(prepared.capabilitiesUrl)).statusCode).toBe(200);
      expect(command).toHaveBeenCalled();
      expect(await readFile(outside)).toEqual(original);
      expect((await app.inject(prepared.url)).rawPayload).toEqual(
        prepared.bytes
      );
    }
  );

  it("retires sidecars with changed ranges, playback resets and removed assets", async () => {
    const prepared = await prepare();
    resetLibraryData(
      db,
      {
        scores: false,
        favorites: false,
        tags: false,
        comparisons: false,
        presentationPlayback: true
      },
      "2026-10-31T00:00:00.000Z"
    );
    await sweepDerivativeCache(db, config.cacheDir, { pruneStaleFiles: true });
    await expect(stat(prepared.metadataPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(stat(prepared.destination)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await app.inject(prepared.url)).statusCode).toBe(409);
    await removeAssetDerivativeCache(config.cacheDir, [prepared.asset.id]);
    await expect(
      stat(path.dirname(prepared.destination))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
