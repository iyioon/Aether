import {
  mkdtemp,
  mkdir,
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
import { deflateSync } from "node:zlib";
import fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
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
import { resolveAssetFile } from "../src/library/media-serving.js";
import {
  getPresentationMediaCapabilities,
  PresentationMediaError
} from "../src/library/presentation-media.js";
import { ensurePresentationAnimation } from "../src/library/presentation-animation.js";
import { registerPresentationMediaRoutes } from "../src/library/routes-presentation-media.js";
import { getPresentationRenditionKeys } from "../src/library/presentation.js";
import {
  removeAssetDerivativeCache,
  sweepDerivativeCache
} from "../src/library/derivative-cache.js";
import { buildApp } from "../src/http/app.js";
import * as processing from "../src/library/video-processing.js";
import { runMediaCommand } from "../src/library/video-processing.js";

let cwd: string;
let config: AppConfig;
let db: AetherDatabase;
let app: FastifyInstance;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "aether-presentation-media-"));
  await mkdir(path.join(cwd, "media"));
  config = await loadConfig(
    {
      AETHER_MEDIA_ROOTS: "./media",
      AETHER_DATA_DIR: "./data",
      AETHER_PASSWORD_HASH: await hashPassword("presentation-test"),
      AETHER_SESSION_SECRET: "presentation-media-test-secret-long-enough"
    },
    cwd
  );
  db = openDatabase(config.configDir);
  app = fastify();
  registerPresentationMediaRoutes(app, config, db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  db.close();
  await rm(cwd, { recursive: true, force: true });
});

async function assetNamed(name: string) {
  await scanLibrary(db, config.mediaRoots);
  const asset = listAssets(db, {
    folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
    offset: 0,
    limit: 100,
    sort: "filename",
    type: "all",
    recursive: true
  })?.items.find((item) => item.name === name);
  if (!asset) throw new Error("Expected indexed fixture.");
  return asset;
}
async function video(name = "clip.mp4", duration = 1) {
  await runMediaCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=48x32:rate=24:duration=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${duration}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      path.join(cwd, "media", name)
    ],
    10_000
  );
  return assetNamed(name);
}
function setHighlight(
  id: string,
  startMs: number,
  endMs: number,
  loopMode = "repeat"
) {
  db.prepare(
    "INSERT INTO asset_presentations (asset_id, revision, highlight_start_ms, highlight_end_ms, fit, focal_x, focal_y, zoom, playback_rate, loop_mode, updated_at) VALUES (?,1,?,?,'auto',0.5,0.5,1,1,?,'2026-01-01T00:00:00.000Z') ON CONFLICT(asset_id) DO UPDATE SET revision=revision+1,highlight_start_ms=excluded.highlight_start_ms,highlight_end_ms=excluded.highlight_end_ms,loop_mode=excluded.loop_mode"
  ).run(id, startMs, endMs, loopMode);
  return getAsset(db, id)!;
}

describe("presentation video delivery", () => {
  it("probes current media, streams full originals, and preserves HEAD, ranges and validators", async () => {
    const asset = await video();
    const caps = await app.inject(`/api/assets/${asset.id}/presentation-media`);
    expect(caps.statusCode).toBe(200);
    expect(caps.headers["cache-control"]).toBe("no-store");
    expect(caps.json()).toMatchObject({
      kind: "video",
      width: 48,
      height: 32,
      durationMs: 1000,
      hasAudio: true,
      maxBounceDurationMs: 10_000
    });
    const url = `/api/assets/${asset.id}/playback?variant=full&v=${caps.json().renditionKeys.full}`;
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(
      await readFile(path.join(cwd, "media", "clip.mp4"))
    );
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["cache-control"]).toContain("immutable");
    const head = await app.inject({ method: "HEAD", url });
    expect(head.rawPayload.length).toBe(0);
    expect(head.headers["content-length"]).toBe(
      response.headers["content-length"]
    );
    const partial = await app.inject({ url, headers: { range: "bytes=0-31" } });
    expect(partial.statusCode).toBe(206);
    expect(partial.rawPayload).toEqual(response.rawPayload.subarray(0, 32));
    expect(
      (await app.inject({ url, headers: { range: "bytes=999999999-" } }))
        .statusCode
    ).toBe(416);
    expect(
      (
        await app.inject({
          url,
          headers: { "if-none-match": String(response.headers.etag) }
        })
      ).statusCode
    ).toBe(304);
    expect(
      (
        await app.inject({
          url,
          headers: { range: "bytes=0-31", "if-range": '"old"' }
        })
      ).statusCode
    ).toBe(200);
  });

  it("generates the complete selected section and a muted deterministic forward/reverse rendition", async () => {
    const initial = await video();
    const asset = setHighlight(initial.id, 250, 750, "bounce");
    const highlight = await app.inject(
      `/api/assets/${asset.id}/playback?variant=highlight&v=${asset.presentation.renditionKeys.highlight}`
    );
    expect(highlight.statusCode).toBe(200);
    const bounce = await app.inject(
      `/api/assets/${asset.id}/playback?variant=bounce&v=${asset.presentation.renditionKeys.bounce}`
    );
    expect(bounce.statusCode).toBe(200);
    const bouncePath = path.join(cwd, "bounce.mp4");
    const highlightPath = path.join(cwd, "highlight.mp4");
    await writeFile(bouncePath, bounce.rawPayload);
    await writeFile(highlightPath, highlight.rawPayload);
    const probe = JSON.parse(
      (
        await runMediaCommand(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,nb_frames:format=duration",
            "-of",
            "json",
            bouncePath
          ],
          10_000
        )
      ).stdout
    );
    expect(probe.streams).toHaveLength(1);
    expect(probe.streams[0]).toMatchObject({
      codec_type: "video",
      nb_frames: "22"
    });
    const duration = Number(
      JSON.parse(
        (
          await runMediaCommand(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "json",
              highlightPath
            ],
            10_000
          )
        ).stdout
      ).format.duration
    );
    expect(duration).toBeGreaterThanOrEqual(0.49);
    expect(duration).toBeLessThan(0.6);
    const posterUrl = `/api/assets/${asset.id}/presentation-poster?variant=highlight&v=${asset.presentation.renditionKeys.highlight}&size=320`;
    expect((await app.inject(posterUrl)).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "HEAD", url: posterUrl })).rawPayload.length
    ).toBe(0);
    const workFiles = await readdir(
      path.join(config.cacheDir, "presentations", asset.id)
    );
    expect(
      workFiles.some(
        (name) => name.endsWith(".tmp") || name.startsWith("work-")
      )
    ).toBe(false);
  });

  it("preserves rotation and non-square source pixels in generated sections", async () => {
    await video();
    const original = path.join(cwd, "media", "clip.mp4");
    const anamorphic = path.join(cwd, "anamorphic.mp4");
    const oriented = path.join(cwd, "media", "oriented.mov");
    await runMediaCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        original,
        "-vf",
        "setsar=2/1",
        "-c:v",
        "libx264",
        "-an",
        "-y",
        anamorphic
      ],
      10_000
    );
    await runMediaCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        anamorphic,
        "-c",
        "copy",
        "-metadata:s:v:0",
        "rotate=90",
        "-y",
        oriented
      ],
      10_000
    );
    const movie = await readFile(oriented);
    const trackHeader = movie.indexOf(Buffer.from("tkhd"));
    if (trackHeader < 0) throw new Error("Expected MOV track header.");
    const matrixOffset = trackHeader + (movie[trackHeader + 4] === 1 ? 56 : 44);
    const rotationMatrix = [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824];
    rotationMatrix.forEach((value, index) =>
      movie.writeInt32BE(value, matrixOffset + index * 4)
    );
    await writeFile(oriented, movie);
    const asset = await assetNamed("oriented.mov");
    const capabilities = (
      await app.inject(`/api/assets/${asset.id}/presentation-media`)
    ).json();
    expect(capabilities).toMatchObject({
      width: 32,
      height: 96,
      hasAudio: false
    });
    const highlighted = setHighlight(asset.id, 0, 500);
    const response = await app.inject(
      `/api/assets/${asset.id}/playback?variant=highlight&v=${highlighted.presentation.renditionKeys.highlight}`
    );
    expect(response.statusCode).toBe(200);
    const resultPath = path.join(cwd, "oriented-result.mp4");
    await writeFile(resultPath, response.rawPayload);
    const result = JSON.parse(
      (
        await runMediaCommand(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "stream=width,height,sample_aspect_ratio",
            "-of",
            "json",
            resultPath
          ],
          10_000
        )
      ).stdout
    );
    expect(result.streams[0]).toMatchObject({
      width: 360,
      height: 1080,
      sample_aspect_ratio: "1:1"
    });
  });

  it("returns refreshed version keys after external changes without mutating source identity", async () => {
    const asset = await video();
    const oldKeys = asset.presentation.renditionKeys;
    expect(
      (
        await app.inject(
          `/api/assets/${asset.id}/presentation-poster?v=${oldKeys.full}`
        )
      ).statusCode
    ).toBe(200);
    const oldPoster = path.join(
      config.cacheDir,
      "presentations",
      asset.id,
      `${oldKeys.full}-640.jpg`
    );
    expect((await stat(oldPoster)).isFile()).toBe(true);

    const source = path.join(cwd, "media", "clip.mp4");
    const info = await stat(source);
    await utimes(source, new Date(), new Date(info.mtimeMs + 5000));
    const stale = await app.inject(
      `/api/assets/${asset.id}/playback?v=${oldKeys.full}`
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error: "stale_rendition",
      metadataRefresh: true
    });
    const caps = (
      await app.inject(`/api/assets/${asset.id}/presentation-media`)
    ).json();
    expect(caps.renditionKeys.full).not.toBe(oldKeys.full);
    expect(
      (
        await app.inject(
          `/api/assets/${asset.id}/presentation-poster?v=${caps.renditionKeys.full}`
        )
      ).statusCode
    ).toBe(200);
    expect(await stat(oldPoster).catch(() => null)).toBeNull();

    expect(
      (
        await app.inject(
          `/api/assets/${asset.id}/playback?v=${caps.renditionKeys.full}`
        )
      ).statusCode
    ).toBe(200);
    expect(getAsset(db, asset.id)!.mtimeMs).toBe(asset.mtimeMs);
  });

  it("rejects excessive bounce sections and malformed queries", async () => {
    const asset = await video("long.mp4", 11);
    const current = setHighlight(asset.id, 0, 10_500, "bounce");
    const bounce = await app.inject(
      `/api/assets/${asset.id}/playback?variant=bounce&v=${current.presentation.renditionKeys.bounce}`
    );
    expect(bounce.statusCode).toBe(422);
    expect(bounce.json().error).toBe("bounce_duration_exceeded");
    expect(
      (await app.inject(`/api/assets/${asset.id}/playback?v=../../escape`))
        .statusCode
    ).toBe(400);
    expect(
      (
        await app.inject(
          `/api/assets/${asset.id}/presentation-poster?v=${current.presentation.renditionKeys.full}&size=100000`
        )
      ).statusCode
    ).toBe(400);
  });

  it("rejects obsolete generation results and leaves no derivative files", async () => {
    const original = await video();
    const asset = setHighlight(original.id, 100, 700);
    const command = processing.runMediaCommand;
    vi.spyOn(processing, "runMediaCommand").mockImplementation(
      async (name, args, timeout) => {
        const result = await command(name, args, timeout);
        if (name === "ffmpeg" && args.some((value) => value.endsWith(".tmp")))
          setHighlight(asset.id, 200, 800);
        return result;
      }
    );
    const response = await app.inject(
      `/api/assets/${asset.id}/playback?variant=highlight&v=${asset.presentation.renditionKeys.highlight}`
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("stale_rendition");
    expect(
      await readdir(path.join(config.cacheDir, "presentations", asset.id))
    ).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS total FROM derivatives WHERE kind LIKE 'presentation:%'"
        )
        .get()
    ).toEqual({ total: 0 });
  });

  it("keeps source and derivative paths inside their managed boundaries", async () => {
    const asset = await video();
    const outside = path.join(cwd, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(config.cacheDir, "presentations"));
    const poster = await app.inject(
      `/api/assets/${asset.id}/presentation-poster?v=${asset.presentation.renditionKeys.full}`
    );
    expect(poster.statusCode).toBe(500);
    expect(poster.json()).toEqual({ error: "unsafe_cache" });
    expect(await readdir(outside)).toEqual([]);
    const source = path.join(cwd, "media", "clip.mp4");
    await rm(source);
    await writeFile(path.join(outside, "private.mp4"), "private");
    await symlink(path.join(outside, "private.mp4"), source);
    const response = await app.inject(
      `/api/assets/${asset.id}/playback?v=${asset.presentation.renditionKeys.full}`
    );
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(outside);
  });

  it("requires authentication for capabilities, playback, posters and animation atlases", async () => {
    const asset = await video();
    await app.close();
    app = await buildApp({ config, db, logger: false });
    for (const suffix of [
      "presentation-media",
      `playback?v=${asset.presentation.renditionKeys.full}`,
      `presentation-poster?v=${asset.presentation.renditionKeys.full}`,
      `animation?v=${asset.presentation.renditionKeys.full}`,
      `animation/atlases/0?v=${asset.presentation.renditionKeys.full}`
    ]) {
      expect(
        (await app.inject(`/api/assets/${asset.id}/${suffix}`)).statusCode
      ).toBe(401);
    }
  });
});

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(kind), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([header, payload, crc]);
}
async function animatedPng(destination: string): Promise<void> {
  const width = 16;
  const height = 12;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(3);
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("acTL", actl)
  ];
  let sequence = 0;
  for (let index = 0; index < 3; index++) {
    const frameWidth = index === 0 ? width : index === 1 ? 8 : 4;
    const frameHeight = index === 0 ? height : index === 1 ? 8 : 4;
    const frameX = index === 0 ? 0 : index === 1 ? 4 : 8;
    const frameY = index === 0 ? 0 : index === 1 ? 2 : 4;
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++);
    control.writeUInt32BE(frameWidth, 4);
    control.writeUInt32BE(frameHeight, 8);
    control.writeUInt32BE(frameX, 12);
    control.writeUInt32BE(frameY, 16);
    control.writeUInt16BE((index + 1) * 10, 20);
    control.writeUInt16BE(100, 22);
    control[24] = index === 1 ? 1 : 0;
    control[25] = index === 0 ? 0 : 1;
    chunks.push(chunk("fcTL", control));
    const pixels = Buffer.alloc(frameHeight * (frameWidth * 4 + 1));
    for (let y = 0; y < frameHeight; y++)
      for (let x = 0; x < frameWidth; x++) {
        const offset = y * (frameWidth * 4 + 1) + 1 + x * 4;
        pixels[offset + index] = 255;
        pixels[offset + 3] =
          (index === 0 && x < 4) || (index === 1 && x === 0) ? 0 : 255;
      }
    const compressed = deflateSync(pixels);
    if (index === 0) chunks.push(chunk("IDAT", compressed));
    else {
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(sequence++);
      chunks.push(chunk("fdAT", Buffer.concat([prefix, compressed])));
    }
  }
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  await writeFile(destination, Buffer.concat(chunks));
}

async function animatedFixture(format: "gif" | "webp" | "apng" | "avif") {
  const apngPath = path.join(cwd, "media", "source.png");
  await animatedPng(apngPath);
  if (format === "apng") return assetNamed("source.png");
  const destination = path.join(cwd, "media", `animation.${format}`);
  if (format === "gif" || format === "webp") {
    const raw = Buffer.alloc(16 * 12 * 3 * 4);
    for (let frame = 0; frame < 3; frame++)
      for (let pixel = 0; pixel < 16 * 12; pixel++) {
        const offset = (frame * 16 * 12 + pixel) * 4;
        raw[offset + frame] = 255;
        raw[offset + 3] = pixel % 16 < 4 ? 0 : 255;
      }
    const processor = sharp(raw, {
      raw: { width: 16, height: 36, channels: 4, pageHeight: 12 }
    });
    await processor[format]({ delay: [100, 200, 300], loop: 0 }).toFile(
      destination
    );
  } else {
    await runMediaCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        apngPath,
        "-map",
        "0:v",
        "-map",
        "0:v",
        "-filter:v:0",
        "format=yuv420p",
        "-filter:v:1",
        "alphaextract,format=gray,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709",
        "-colorspace:v:1",
        "bt709",
        "-c:v",
        "libaom-av1",
        "-cpu-used",
        "8",
        "-crf",
        "0",
        "-fps_mode",
        "passthrough",
        "-f",
        "avif",
        "-y",
        destination
      ],
      20_000
    );
  }
  return assetNamed(`animation.${format}`);
}

describe("controllable transparent animations", () => {
  it.each(["gif", "webp", "apng", "avif"] as const)(
    "decodes complete %s timelines into transparent composited atlases",
    async (format) => {
      const asset = await animatedFixture(format);
      const file = (await resolveAssetFile(db, asset.id))!;
      const capabilities = await getPresentationMediaCapabilities({
        db,
        config,
        file
      });
      expect(capabilities.kind).toBe("animation");
      expect(capabilities.durationMs).toBe(600);
      const [first, shared] = await Promise.all([
        ensurePresentationAnimation({
          db,
          config,
          file,
          key: capabilities.renditionKeys.full
        }),
        ensurePresentationAnimation({
          db,
          config,
          file,
          key: capabilities.renditionKeys.full
        })
      ]);
      expect(first.manifest).toEqual(shared.manifest);
      expect(first.manifest.frames.map((frame) => frame.durationMs)).toEqual([
        100, 200, 300
      ]);
      expect(first.manifest.frames.map((frame) => frame.startMs)).toEqual([
        0, 100, 300
      ]);
      const { data, info } = await sharp(first.atlasPaths[0]!)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width).toBeLessThanOrEqual(2048);
      expect(info.height).toBeLessThanOrEqual(2048);
      expect(data[3]).toBe(0);
      const firstVisible = 8 * 4;
      expect(data[firstVisible]).toBeGreaterThan(230);
      expect(data[firstVisible + 3]).toBe(255);
      if (format === "apng") {
        const second = first.manifest.frames[1]!;
        const third = first.manifest.frames[2]!;
        const at = (frameX: number, x: number, y: number) =>
          (y * info.width + frameX + x) * 4;
        expect(data[at(second.x, 4, 2)]).toBe(255);
        expect(data[at(second.x, 8, 2) + 1]).toBe(255);
        expect(data[at(third.x, 4, 2) + 3]).toBe(0);
        expect(data[at(third.x, 9, 5) + 2]).toBe(255);
      }

      const manifestResponse = await app.inject(
        `/api/assets/${asset.id}/animation?v=${capabilities.renditionKeys.full}`
      );
      expect(manifestResponse.statusCode).toBe(200);
      expect(manifestResponse.headers["cache-control"]).toBe("no-store");
      const atlasResponse = await app.inject(first.manifest.atlases[0]!.url);
      expect(atlasResponse.statusCode).toBe(200);
      expect(atlasResponse.headers["content-type"]).toContain("image/png");
      expect(
        (
          await app.inject(
            `/api/assets/${asset.id}/animation/atlases/37?v=${capabilities.renditionKeys.full}`
          )
        ).statusCode
      ).toBe(404);
      const highlighted = setHighlight(asset.id, 200, 500);
      const posterUrl = `/api/assets/${asset.id}/presentation-poster?variant=highlight&v=${highlighted.presentation.renditionKeys.highlight}&size=640`;
      const poster = await app.inject(posterUrl);
      expect(poster.statusCode).toBe(200);
      expect(poster.headers["content-type"]).toContain("image/png");
      expect((await app.inject(posterUrl)).headers["content-type"]).toContain(
        "image/png"
      );
      const decodedPoster = await sharp(poster.rawPayload)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(decodedPoster.data[3]).toBe(0);
      expect(
        decodedPoster.data[(2 * decodedPoster.info.width + 8) * 4 + 1]
      ).toBeGreaterThan(230);
      expect(
        (await app.inject({ method: "HEAD", url: posterUrl })).rawPayload.length
      ).toBe(0);
      await sweepDerivativeCache(db, config.cacheDir, {
        pruneStaleFiles: true
      });
      expect(await readFile(first.atlasPaths[0]!)).toEqual(
        atlasResponse.rawPayload
      );
      await removeAssetDerivativeCache(config.cacheDir, [asset.id]);
      expect(
        await stat(path.dirname(first.atlasPaths[0]!)).catch(() => null)
      ).toBeNull();
    }
  );

  it("rejects animated input above the frame budget before publishing files", async () => {
    const raw = Buffer.alloc(601 * 4);
    for (let index = 0; index < 601; index++) {
      raw[index * 4] = (index % 2) * 255;
      raw[index * 4 + 2] = (1 - (index % 2)) * 255;
      raw[index * 4 + 3] = 255;
    }
    await sharp(raw, {
      raw: { width: 1, height: 601, channels: 4, pageHeight: 1 }
    })
      .gif({ delay: 10 })
      .toFile(path.join(cwd, "media", "oversized.gif"));
    const asset = await assetNamed("oversized.gif");
    const response = await app.inject(
      `/api/assets/${asset.id}/presentation-media`
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "presentation_limit_exceeded" });
    expect(
      await stat(path.join(config.cacheDir, "presentations", asset.id)).catch(
        () => null
      )
    ).toBeNull();
  });

  it("recognizes static PNGs and rejects malformed animated media without claiming it is still", async () => {
    await sharp({
      create: { width: 16, height: 12, channels: 4, background: "red" }
    })
      .png()
      .toFile(path.join(cwd, "media", "still.png"));
    const asset = await assetNamed("still.png");
    const file = (await resolveAssetFile(db, asset.id))!;
    expect(
      (await getPresentationMediaCapabilities({ db, config, file })).kind
    ).toBe("still");
    await writeFile(path.join(cwd, "media", "broken.gif"), "GIF89a damaged");
    const broken = await assetNamed("broken.gif");
    await expect(
      getPresentationMediaCapabilities({
        db,
        config,
        file: (await resolveAssetFile(db, broken.id))!
      })
    ).rejects.toBeInstanceOf(PresentationMediaError);
    expect(
      (await app.inject(`/api/assets/${broken.id}/presentation-media`))
        .statusCode
    ).toBe(415);
    expect(
      (
        await app.inject(
          `/api/assets/${asset.id}/animation?v=${getPresentationRenditionKeys(asset, asset.presentation).full}`
        )
      ).statusCode
    ).toBe(415);
  });
});
