import { mkdir, mkdtemp, realpath, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { stableId } from "../src/library/ids.js";
import {
  folderIdFor,
  getAsset,
  getDerivative,
  listAssets
} from "../src/library/repository.js";
import {
  parseRangeHeader,
  resolveAssetFile
} from "../src/library/media-serving.js";
import { scanLibrary } from "../src/library/scanner.js";
import { ensureImageThumbnail } from "../src/library/thumbnails.js";

describe("media serving", () => {
  let cwd: string;
  let config: AppConfig;
  let db: AetherDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "aether-media-"));
    await mkdir(path.join(cwd, "media"));

    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        AETHER_PASSWORD_HASH: await hashPassword("media-password"),
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("parses simple, open-ended, and suffix byte ranges", () => {
    expect(parseRangeHeader(undefined, 10)).toBeNull();
    expect(parseRangeHeader("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseRangeHeader("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRangeHeader("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseRangeHeader("bytes=10-", 10)).toBe("invalid");
    expect(parseRangeHeader("bytes=-4", 0)).toBe("invalid");
    expect(parseRangeHeader("items=0-2", 10)).toBe("invalid");
  });

  it("streams indexed media and supports byte ranges", async () => {
    await writeFile(path.join(cwd, "media", "clip.mp4"), "0123456789");
    await scanLibrary(db, config.mediaRoots);
    const asset = firstAsset("all");
    const cookies = await loginCookies();

    const full = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/media`,
      cookies
    });

    expect(full.statusCode).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["cache-control"]).toBe("private, max-age=3600");
    expect(full.headers["content-length"]).toBe("10");
    expect(full.headers["content-type"]).toContain("video/mp4");
    expect(full.body).toBe("0123456789");
    const etag = String(full.headers.etag);
    const lastModified = String(full.headers["last-modified"]);
    expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(Number.isFinite(Date.parse(lastModified))).toBe(true);

    const head = await app.inject({
      method: "HEAD",
      url: `/api/assets/${asset.id}/media`,
      cookies
    });

    expect(head.statusCode).toBe(200);
    expect(head.headers["accept-ranges"]).toBe("bytes");
    expect(head.headers["content-length"]).toBe("10");
    expect(head.headers.etag).toBe(etag);
    expect(head.body).toBe("");

    const partial = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/media`,
      cookies,
      headers: {
        range: "bytes=2-5"
      }
    });

    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-range"]).toBe("bytes 2-5/10");
    expect(partial.headers["content-length"]).toBe("4");
    expect(partial.body).toBe("2345");

    const matchingIfRange = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/media`,
      cookies,
      headers: {
        "if-range": etag,
        range: "bytes=2-5"
      }
    });

    expect(matchingIfRange.statusCode).toBe(206);
    expect(matchingIfRange.body).toBe("2345");

    const staleIfRange = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/media`,
      cookies,
      headers: {
        "if-range": '"stale"',
        range: "bytes=2-5"
      }
    });

    expect(staleIfRange.statusCode).toBe(200);
    expect(staleIfRange.body).toBe("0123456789");

    const notModified = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/media`,
      cookies,
      headers: {
        "if-none-match": `W/${etag}`
      }
    });

    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toBe("");

    const invalid = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/media`,
      cookies,
      headers: {
        range: "bytes=20-30"
      }
    });

    expect(invalid.statusCode).toBe(416);
    expect(invalid.headers["accept-ranges"]).toBe("bytes");
    expect(invalid.headers["content-range"]).toBe("bytes */10");
  });

  it("sends downloads with attachment disposition", async () => {
    await writeFile(path.join(cwd, "media", "family photo.jpg"), "image-bytes");
    await scanLibrary(db, config.mediaRoots);
    const asset = firstAsset("all");
    const cookies = await loginCookies();

    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/download`,
      cookies
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain(
      "family%20photo.jpg"
    );
    expect(response.body).toBe("image-bytes");
  });

  it("generates cached image thumbnails and updates dimensions", async () => {
    await sharp({
      create: {
        width: 16,
        height: 12,
        channels: 3,
        background: "#93b7a5"
      }
    })
      .png()
      .toFile(path.join(cwd, "media", "photo.png"));
    await scanLibrary(db, config.mediaRoots);
    const asset = firstAsset("image");
    const cookies = await loginCookies();

    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/thumbnail?size=128`,
      cookies
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/webp");
    expect(response.rawPayload.byteLength).toBeGreaterThan(0);

    const updatedAsset = getAsset(db, asset.id);
    expect(updatedAsset?.width).toBe(16);
    expect(updatedAsset?.height).toBe(12);
  });

  it("shares concurrent generation work for the same image thumbnail", async () => {
    await sharp({
      create: {
        width: 96,
        height: 64,
        channels: 3,
        background: "#768c82"
      }
    })
      .png()
      .toFile(path.join(cwd, "media", "shared.png"));
    await scanLibrary(db, config.mediaRoots);
    const asset = firstAsset("image");
    const cookies = await loginCookies();
    db.exec(`
      CREATE TABLE derivative_write_attempts (count INTEGER NOT NULL);
      INSERT INTO derivative_write_attempts (count) VALUES (0);
      CREATE TRIGGER count_derivative_write_attempts
      BEFORE INSERT ON derivatives
      BEGIN
        UPDATE derivative_write_attempts SET count = count + 1;
      END;
    `);

    const [first, second] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/assets/${asset.id}/thumbnail?size=128`,
        cookies
      }),
      app.inject({
        method: "GET",
        url: `/api/assets/${asset.id}/thumbnail?size=128`,
        cookies
      })
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.rawPayload).toEqual(second.rawPayload);
    expect(
      db.prepare("SELECT count FROM derivative_write_attempts").get()
    ).toEqual({ count: 1 });
  });

  it("isolates concurrent thumbnail jobs between databases and cache directories", async () => {
    const sourceMtime = new Date("2026-01-01T00:00:00.000Z");
    const fixtures: Array<{
      config: AppConfig;
      db: AetherDatabase;
      file: NonNullable<Awaited<ReturnType<typeof resolveAssetFile>>>;
    }> = [];

    try {
      for (const [name, background] of [
        ["first", "#b45309"],
        ["second", "#0369a1"]
      ] as const) {
        const fixtureDirectory = path.join(cwd, name);
        const mediaDirectory = path.join(fixtureDirectory, "media");
        const sourcePath = path.join(mediaDirectory, "shared.png");
        await mkdir(mediaDirectory, { recursive: true });
        await sharp({
          create: {
            width: 512,
            height: 384,
            channels: 3,
            background
          }
        })
          .png()
          .toFile(sourcePath);
        await utimes(sourcePath, sourceMtime, sourceMtime);

        const fixtureConfig: AppConfig = {
          ...config,
          mediaRoots: [
            {
              id: "root_shared-thumbnail-isolation",
              label: "media",
              inputPath: mediaDirectory,
              realPath: await realpath(mediaDirectory)
            }
          ],
          configDir: path.join(fixtureDirectory, "config"),
          cacheDir: path.join(fixtureDirectory, "cache")
        };
        const fixtureDb = openDatabase(fixtureConfig.configDir);
        await scanLibrary(fixtureDb, fixtureConfig.mediaRoots);
        const asset = fixtureDb.prepare("SELECT id FROM assets").get() as {
          id: string;
        };
        const file = await resolveAssetFile(fixtureDb, asset.id);

        if (!file) {
          fixtureDb.close();
          throw new Error("Expected an indexed thumbnail fixture.");
        }

        fixtures.push({ config: fixtureConfig, db: fixtureDb, file });
      }

      const thumbnails = await Promise.all(
        fixtures.map((fixture) =>
          ensureImageThumbnail({
            db: fixture.db,
            config: fixture.config,
            file: fixture.file,
            size: 128
          })
        )
      );

      expect(thumbnails[0]?.path).not.toBe(thumbnails[1]?.path);
      expect(thumbnails[0]?.path).toContain(
        path.join("first", "cache", "thumbnails")
      );
      expect(thumbnails[1]?.path).toContain(
        path.join("second", "cache", "thumbnails")
      );
      expect(
        fixtures.map((fixture) =>
          fixture.db.prepare("SELECT path, status FROM derivatives").get()
        )
      ).toEqual([
        { path: thumbnails[0]?.path, status: "ready" },
        { path: thumbnails[1]?.path, status: "ready" }
      ]);
    } finally {
      for (const fixture of fixtures) {
        fixture.db.close();
      }
    }
  });

  it("generates cached video posters and updates metadata", async () => {
    await createTestVideo(path.join(cwd, "media", "clip.mp4"));
    await scanLibrary(db, config.mediaRoots);
    const asset = firstAsset("video");
    const cookies = await loginCookies();

    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/thumbnail?size=128`,
      cookies
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.rawPayload.byteLength).toBeGreaterThan(0);

    const updatedAsset = getAsset(db, asset.id);
    expect(updatedAsset?.width).toBe(64);
    expect(updatedAsset?.height).toBe(36);
    expect(updatedAsset?.durationMs).toBeGreaterThan(0);
    expect(updatedAsset?.codec).toBeTruthy();

    const derivative = getDerivative(
      db,
      stableId(
        "derivative",
        asset.id,
        "poster",
        "v2",
        "128",
        String(asset.mtimeMs)
      )
    );
    expect(derivative?.status).toBe("ready");
    expect(derivative?.path).toContain("v2-");
  });

  it("generates cached video previews and supports byte ranges", async () => {
    await createTestVideo(path.join(cwd, "media", "clip.mp4"));
    await scanLibrary(db, config.mediaRoots);
    const asset = firstAsset("video");
    const cookies = await loginCookies();

    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/preview?size=720&duration=2`,
      cookies
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-type"]).toContain("video/mp4");
    expect(response.rawPayload.byteLength).toBeGreaterThan(0);

    const derivative = getDerivative(
      db,
      stableId(
        "derivative",
        asset.id,
        "preview",
        "v3",
        "720",
        "2",
        String(asset.mtimeMs)
      )
    );
    expect(derivative?.status).toBe("ready");
    expect(derivative?.width).toBe(720);
    expect(derivative?.height).toBe(2);
    expect(derivative?.path).toContain("v3-");
    expect(
      derivative?.path ? await hasAudioStream(derivative.path) : false
    ).toBe(true);

    const partial = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/preview?size=720&duration=2`,
      cookies,
      headers: {
        range: "bytes=0-15"
      }
    });

    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-range"]).toMatch(/^bytes 0-15\/\d+$/);
    expect(partial.rawPayload.byteLength).toBe(16);
  });

  function firstAsset(type: "all" | "image" | "video") {
    const root = config.mediaRoots[0]!;
    const result = listAssets(db, {
      folderId: folderIdFor(root.id, ""),
      offset: 0,
      limit: 1,
      sort: "filename",
      type,
      recursive: true
    });

    const asset = result?.items[0];

    if (!asset) {
      throw new Error("Expected scanner fixture asset.");
    }

    return asset;
  }

  async function loginCookies(): Promise<Record<string, string>> {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "media-password"
      }
    });

    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    if (!sessionCookie) {
      throw new Error("Expected session cookie.");
    }

    return {
      aether_session: sessionCookie.value
    };
  }
});

async function createTestVideo(outputPath: string): Promise<void> {
  await runFixtureCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x36:rate=5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "2",
    "-c:v",
    "mpeg4",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-shortest",
    "-y",
    outputPath
  ]);
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  const result = await runFixtureCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    filePath
  ]);

  return result.stdout
    .trim()
    .split(/\r?\n/)
    .some((line) => line === "audio");
}

async function runFixtureCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 15_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `${command} exited with code ${code ?? "unknown"}.`
          )
        );
        return;
      }

      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}
