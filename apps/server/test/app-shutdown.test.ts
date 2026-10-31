import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createSession } from "../src/auth/sessions.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { resolveAssetFile } from "../src/library/media-serving.js";
import { ensurePresentationDerivative } from "../src/library/presentation-cache.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";
import { closeServerRuntime } from "../src/maintenance/server-runtime.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("application shutdown", () => {
  let directory: string;
  let config: AppConfig;
  let db: AetherDatabase;
  let app: FastifyInstance;
  let cookie: string;
  const held: Array<ReturnType<typeof gate>> = [];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aether-shutdown-"));
    await mkdir(path.join(directory, "media"));
    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./data",
        AETHER_PASSWORD_HASH: await hashPassword("shutdown-test"),
        AETHER_SESSION_SECRET: "shutdown-test-secret-long-enough",
        AETHER_WATCH_ENABLED: "false"
      },
      directory
    );
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
    cookie = `${config.sessionCookieName}=${encodeURIComponent(
      app.signCookie(createSession(db, 1).sessionToken)
    )}`;
  });

  afterEach(async () => {
    held.splice(0).forEach((entry) => entry.release());
    await app.close();
    if (db.open) db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it.each([false, true])(
    "drains disconnected cache work before releasing SQLite and ownership (failure=%s)",
    async (failure) => {
      const source = path.join(directory, "media", "source.png");
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#123456" }
      })
        .png()
        .toFile(source);
      const sourceBytes = await readFile(source);
      await scanLibrary(db, config.mediaRoots);
      const asset = listAssets(db, {
        folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
        offset: 0,
        limit: 1,
        sort: "filename",
        type: "all",
        recursive: true
      })!.items[0]!;
      const file = (await resolveAssetFile(db, asset.id))!;
      const started = gate();
      const work = gate();
      held.push(work);
      let handlerFinished = false;
      app.get("/api/shutdown-test", async (_request, reply) => {
        try {
          const rendition = await ensurePresentationDerivative(
            db,
            config,
            file,
            "full",
            asset.presentation.renditionKeys.full,
            "test.png",
            async (destination) => {
              started.release();
              await work.promise;
              await writeFile(destination, sourceBytes);
              if (failure) throw new Error("expected generation failure");
              return "image/png";
            }
          );
          return reply.send({ ready: Boolean(rendition.path) });
        } finally {
          handlerFinished = true;
        }
      });
      const controller = new AbortController();
      const request = app
        .inject({
          url: "/api/shutdown-test",
          headers: { cookie },
          signal: controller.signal
        })
        .then(
          (response) => ({ status: response.statusCode }),
          (error: NodeJS.ErrnoException) => ({ code: error.code })
        );
      await started.promise;
      controller.abort();
      await expect(request).resolves.toEqual({ code: "ABORT_ERR" });

      let ownershipReleased = false;
      let readyRecords = -1;
      const closing = closeServerRuntime({
        closeApplication: () => app.close(),
        closeDatabase: () => {
          expect(handlerFinished).toBe(true);
          readyRecords = (
            db.prepare("SELECT COUNT(*) AS count FROM derivatives").get() as {
              count: number;
            }
          ).count;
          db.close();
        },
        releaseLock: async () => {
          ownershipReleased = true;
        }
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(handlerFinished).toBe(false);
      expect(db.open).toBe(true);
      expect(ownershipReleased).toBe(false);
      work.release();
      await closing;
      expect(db.open).toBe(false);
      expect(ownershipReleased).toBe(true);
      expect(readyRecords).toBe(failure ? 0 : 1);
      expect(await readFile(source)).toEqual(sourceBytes);
      const files = await readdir(
        path.join(config.cacheDir, "presentations", asset.id)
      );
      expect(files).toHaveLength(failure ? 0 : 1);
      expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
    }
  );

  it("waits for handler work after its response has already completed", async () => {
    const work = gate();
    held.push(work);
    let handlerFinished = false;
    app.get("/api/shutdown-test", async function (_request, reply) {
      reply.send({ boundToApp: this === app });
      await work.promise;
      db.prepare("SELECT 1").get();
      handlerFinished = true;
    });
    const response = await app.inject({
      url: "/api/shutdown-test",
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ boundToApp: true });
    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    work.release();
    await closing;
    expect(handlerFinished).toBe(true);
    expect(closed).toBe(true);
  });
});
