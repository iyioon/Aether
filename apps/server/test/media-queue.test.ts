import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import {
  resolveAssetFile,
  type ResolvedAssetFile
} from "../src/library/media-serving.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
import { registerLibraryRoutes } from "../src/library/routes.js";
import { LibraryScanner, scanLibrary } from "../src/library/scanner.js";
import { ensureImageThumbnail } from "../src/library/thumbnails.js";
import {
  ensureVideoPoster,
  ensureVideoPreview
} from "../src/library/video-derivatives.js";
import * as processing from "../src/library/video-processing.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("media request admission", () => {
  let directory: string;
  let config: AppConfig;
  let db: AetherDatabase;
  let app: FastifyInstance;
  let videos: ResolvedAssetFile[];
  let images: ResolvedAssetFile[];
  const gates: Array<ReturnType<typeof gate>> = [];
  const pending: Promise<unknown>[] = [];

  function track<T>(promise: Promise<T>): Promise<T> {
    pending.push(promise);
    void promise.catch(() => undefined);
    return promise;
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aether-media-queue-"));
    const media = path.join(directory, "media");
    await mkdir(media);
    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./data",
        AETHER_PASSWORD_HASH: await hashPassword("media-queue-test"),
        AETHER_SESSION_SECRET: "media-queue-test-secret-long-enough"
      },
      directory
    );
    const seed = path.join(media, "00.mp4");
    await processing.runMediaCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=96x64:rate=6:duration=0.5",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-y",
        seed
      ],
      10_000
    );
    await Promise.all(
      Array.from({ length: 33 }, (_, index) =>
        copyFile(
          seed,
          path.join(media, `${String(index + 1).padStart(2, "0")}.mp4`)
        )
      )
    );
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#123456" }
    })
      .png()
      .toFile(path.join(media, "image-0.png"));
    await copyFile(
      path.join(media, "image-0.png"),
      path.join(media, "image-1.png")
    );
    db = openDatabase(config.configDir);
    await scanLibrary(db, config.mediaRoots);
    const assets = listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 100,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items;
    const files = await Promise.all(
      assets.map((asset) => resolveAssetFile(db, asset.id))
    );
    videos = files.filter(
      (file): file is ResolvedAssetFile => file?.asset.mediaType === "video"
    );
    images = files.filter(
      (file): file is ResolvedAssetFile => file?.asset.mediaType === "image"
    );
    app = fastify();
    await registerLibraryRoutes(
      app,
      config,
      db,
      new LibraryScanner(db, config.mediaRoots, config.cacheDir)
    );
  });

  afterEach(async () => {
    gates.splice(0).forEach((held) => held.release());
    await Promise.allSettled(pending.splice(0));
    vi.restoreAllMocks();
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["poster", "preview"] as const)(
    "bounds distinct %s work without blocking cached/coalesced requests and recovers after failures",
    async (kind) => {
      const ensure = (file: ResolvedAssetFile) =>
        kind === "poster"
          ? ensureVideoPoster({ db, config, file, size: 160 })
          : ensureVideoPreview({
              db,
              config,
              file,
              size: 160,
              durationSeconds: 1
            });
      const ready = await ensure(videos[33]!);
      const held = gate();
      gates.push(held);
      track(processing.withVideoProcessingSlot(() => held.promise));
      track(processing.withVideoProcessingSlot(() => held.promise));
      const slots = vi.spyOn(processing, "withVideoProcessingSlot");
      const jobs = videos.slice(0, 32).map((file) => track(ensure(file)));
      await vi.waitFor(() => expect(slots).toHaveBeenCalledTimes(32));
      const duplicate = track(ensure(videos[0]!));
      const overflow = videos[32]!;
      const response = await app.inject(
        `/api/assets/${overflow.asset.id}/${kind === "poster" ? "thumbnail?size=160" : "preview?size=160&duration=1"}`
      );
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "processing_busy" });
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers["x-aether-media-error"]).toBe("processing_busy");
      expect(
        await lstat(
          path.join(
            config.cacheDir,
            kind === "poster" ? "posters" : "previews",
            overflow.asset.id
          )
        ).catch(() => null)
      ).toBeNull();
      await expect(ensure(videos[33]!)).resolves.toEqual(ready);
      expect(slots).toHaveBeenCalledTimes(32);

      // Queued source loss must release admission without invoking a decoder.
      await Promise.all(videos.slice(1, 32).map((file) => rm(file.sourcePath)));
      held.release();
      const settled = await Promise.allSettled(jobs);
      expect(settled[0]?.status).toBe("fulfilled");
      expect(
        settled.slice(1).every((result) => result.status === "rejected")
      ).toBe(true);
      await expect(duplicate).resolves.toEqual(
        (
          settled[0] as PromiseFulfilledResult<{
            path: string;
            contentType: string;
          }>
        ).value
      );
      await expect(ensure(overflow)).resolves.toMatchObject({
        contentType: kind === "poster" ? "image/jpeg" : "video/mp4"
      });
      expect(slots).toHaveBeenCalledTimes(33);
      const retry = await app.inject(
        `/api/assets/${overflow.asset.id}/${kind === "poster" ? "thumbnail?size=160" : "preview?size=160&duration=1"}`
      );
      expect(retry.statusCode).toBe(200);
    },
    20_000
  );

  it("preserves transient image-thumbnail overload status and retry guidance", async () => {
    const held = gate();
    gates.push(held);
    track(processing.withVideoProcessingSlot(() => held.promise));
    track(processing.withVideoProcessingSlot(() => held.promise));
    const slots = vi.spyOn(processing, "withVideoProcessingSlot");
    const jobs = Array.from({ length: 32 }, (_, index) =>
      track(
        ensureImageThumbnail({
          db,
          config,
          file: images[0]!,
          size: 160 + index
        })
      )
    );
    await vi.waitFor(() => expect(slots).toHaveBeenCalledTimes(32));
    const response = await app.inject(
      `/api/assets/${images[1]!.asset.id}/thumbnail?size=160`
    );
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "processing_busy" });
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.headers["x-aether-media-error"]).toBe("processing_busy");
    held.release();
    await Promise.all(jobs);
    const retry = await app.inject(
      `/api/assets/${images[1]!.asset.id}/thumbnail?size=160`
    );
    expect(retry.statusCode).toBe(200);
  });
});
