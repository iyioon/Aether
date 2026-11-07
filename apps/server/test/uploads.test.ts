import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  appendFile,
  symlink,
  writeFile,
  open,
  readlink,
  lstat,
  type FileHandle
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import {
  getManagedUpload,
  updateManagedUpload,
  createManagedUpload,
  getManagedUploadByRequestId,
  listManagedUploads,
  pruneUploadCancellations,
  uploadVolumeReservations
} from "../src/library/repository-uploads.js";
import { fileManagementBlockers } from "../src/maintenance/file-management.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, lstat: vi.fn(original.lstat) };
});

describe.skipIf(process.platform !== "linux")(
  "authenticated resumable uploads",
  () => {
    let directory: string;
    let app: FastifyInstance;
    let db: AetherDatabase;
    let headers: Record<string, string>;
    let folderId: string;
    let version: string;
    let jpeg: Buffer;
    let config: AppConfig;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "aether-upload-"));
      await mkdir(path.join(directory, "media"));
      config = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: "media=./media",
          AETHER_WRITABLE_ROOTS: "media",
          AETHER_DATA_DIR: "./data",
          AETHER_PASSWORD_HASH: await hashPassword("upload-password"),
          AETHER_SESSION_SECRET: "upload-test-session-secret-is-long-enough",
          AETHER_MIN_FREE_BYTES: "0",
          NODE_ENV: "test"
        },
        directory
      );
      db = openDatabase(config.configDir);
      app = await buildApp({ config, db, logger: false });
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "upload-password" }
      });
      headers = {
        cookie: login.cookies
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; "),
        "x-csrf-token": login.cookies.find(
          (cookie) => cookie.name === "aether_csrf"
        )!.value,
        "tus-resumable": "1.0.0"
      };
      const tree = (await app.inject({ url: "/api/tree", headers })).json<{
        roots: Array<{
          folderId: string;
          sourceVersion: string;
          writable: boolean;
        }>;
      }>();
      expect(tree.roots[0]?.writable).toBe(true);
      folderId = tree.roots[0]!.folderId;
      version = tree.roots[0]!.sourceVersion;
      jpeg = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#84a09a" }
      })
        .jpeg()
        .toBuffer();
    });

    afterEach(async () => {
      await app?.close();
      db?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it.each([
      { changed: false, outcome: "accepts unchanged" },
      { changed: true, outcome: "rejects changed" }
    ])(
      "$outcome staging directories with inodes above the safe integer range",
      async ({ changed }) => {
        await app.close();
        const staging = path.join(config.dataDir, "uploads");
        const inode = 2n ** 53n + 1n;
        expect(BigInt(Number(inode))).not.toBe(inode);
        const { lstat: originalLstat } =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises"
          );
        const probe = await open(staging, "r");
        const prototype = Object.getPrototypeOf(probe) as FileHandle;
        await probe.close();
        const originalStat = prototype.stat;
        const pathStat = vi
          .mocked(lstat)
          .mockImplementation(async (filePath, options) => {
            const info = await originalLstat(filePath, options);
            if (filePath === staging)
              info.ino = typeof info.ino === "bigint" ? inode : Number(inode);
            return info;
          });
        const descriptorStat = vi
          .spyOn(prototype, "stat")
          .mockImplementation(async function (this: FileHandle, options) {
            const info = await originalStat.call(this, options);
            if ((await readlink(`/proc/self/fd/${this.fd}`)) === staging) {
              const openedInode = changed ? inode + 2n : inode;
              info.ino =
                typeof info.ino === "bigint"
                  ? openedInode
                  : Number(openedInode);
            }
            return info;
          });
        try {
          if (changed) {
            await expect(
              buildApp({ config, db, logger: false })
            ).rejects.toThrow("Upload staging changed during startup.");
          } else {
            app = await buildApp({ config, db, logger: false });
            const status = await app.inject({
              url: "/api/uploads/status",
              headers
            });
            expect(status.statusCode).toBe(200);
            expect(status.json()).toMatchObject({
              items: [],
              recoveryRequired: false
            });
          }
        } finally {
          await app.close();
          pathStat.mockImplementation(originalLstat);
          descriptorStat.mockRestore();
        }
      }
    );

    async function create(
      name = "added.jpg",
      size = jpeg.length,
      requestId = randomUUID()
    ) {
      const metadata = {
        requestId,
        folderId,
        expectedParentVersion: version,
        name,
        conflict: "skip"
      };
      return app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: {
          ...headers,
          "upload-length": String(size),
          "upload-metadata": Object.entries(metadata)
            .map(
              ([key, value]) =>
                `${key} ${Buffer.from(value).toString("base64")}`
            )
            .join(",")
        }
      });
    }
    async function patch(url: string, offset: number, bytes: Buffer) {
      return app.inject({
        method: "PATCH",
        url,
        headers: {
          ...headers,
          "content-type": "application/offset+octet-stream",
          "upload-offset": String(offset)
        },
        payload: bytes
      });
    }

    it("authenticates every protocol method and checks CSRF before accepting bytes", async () => {
      for (const method of [
        "POST",
        "HEAD",
        "PATCH",
        "DELETE",
        "OPTIONS"
      ] as const) {
        const response = await app.inject({
          method,
          url:
            method === "POST" ? "/api/uploads" : `/api/uploads/${randomUUID()}`
        });
        expect(response.statusCode).toBe(401);
      }
      const response = await app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: { cookie: headers.cookie! }
      });
      expect(response.statusCode).toBe(403);
      expect(db.prepare("SELECT id FROM managed_uploads").all()).toHaveLength(
        0
      );
    });

    it("resumes from the actual retained offset and proves the retained prefix", async () => {
      const created = await create();
      expect(created.statusCode).toBe(201);
      const url = created.headers.location!;
      const partial = jpeg.subarray(0, 80);
      const first = await patch(url, 0, partial);
      expect(first.statusCode).toBe(204);
      expect(first.headers["upload-offset"]).toBe("80");
      const head = await app.inject({ method: "HEAD", url, headers });
      expect(head.statusCode).toBe(200);
      expect(head.headers["upload-offset"]).toBe("80");
      const prefix = await app.inject({ url: `${url}/prefix`, headers });
      expect(prefix.json()).toEqual({
        offset: 80,
        sha256: createHash("sha256").update(partial).digest("hex")
      });
      const wrong = await patch(url, 0, jpeg.subarray(80));
      expect(wrong.statusCode).toBe(409);
      expect(
        await readFile(
          path.join(directory, "data/uploads", url.split("/").at(-1)!)
        )
      ).toEqual(partial);
      const finished = await patch(url, 80, jpeg.subarray(80));
      expect(finished.statusCode).toBe(204);
      const operationId = finished.headers["upload-operation-id"];
      expect(operationId).toBeTypeOf("string");
      await expect
        .poll(
          async () =>
            (
              await app.inject({
                url: `/api/file-operations/${operationId}`,
                headers
              })
            ).json<{ status: string }>().status,
          { timeout: 15_000, interval: 100 }
        )
        .toBe("completed");
      expect(await readFile(path.join(directory, "media/added.jpg"))).toEqual(
        jpeg
      );
      const listed = (
        await app.inject({ url: `/api/folders/${folderId}/assets`, headers })
      ).json<{ items: Array<{ name: string }> }>();
      expect(listed.items.map((item) => item.name)).toContain("added.jpg");
    }, 30_000);

    it("rejects disguised content without publishing an asset", async () => {
      const bytes = Buffer.from("not an image");
      const created = await create("invalid.jpg", bytes.length);
      expect(created.statusCode).toBe(201);
      const response = await patch(created.headers.location!, 0, bytes);
      expect(response.statusCode).toBe(422);
      expect(
        db.prepare("SELECT id FROM assets WHERE name = 'invalid.jpg'").all()
      ).toHaveLength(0);
    });

    it("terminates an incomplete transfer without touching media", async () => {
      const created = await create();
      expect(created.statusCode).toBe(201);
      const url = created.headers.location!;
      expect((await patch(url, 0, jpeg.subarray(0, 64))).statusCode).toBe(204);
      expect(
        (await app.inject({ method: "DELETE", url, headers })).statusCode
      ).toBe(204);
      expect(
        (await app.inject({ method: "HEAD", url, headers })).statusCode
      ).toBeGreaterThanOrEqual(400);
      expect(db.prepare("SELECT id FROM assets").all()).toHaveLength(0);
    });

    it("records authenticated cancellation before an unknown-location creation arrives, including after restart", async () => {
      const requestId = randomUUID();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/uploads/cancel",
            payload: { requestId }
          })
        ).statusCode
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/uploads/cancel",
            headers: { cookie: headers.cookie! },
            payload: { requestId }
          })
        ).statusCode
      ).toBe(403);
      expect(
        db.prepare("SELECT request_id FROM upload_cancellations").all()
      ).toEqual([]);
      const cancelled = await app.inject({
        method: "POST",
        url: "/api/uploads/cancel",
        headers,
        payload: { requestId }
      });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json()).toEqual({ status: "cancelled" });
      const intent = db
        .prepare(
          "SELECT created_at, expires_at FROM upload_cancellations WHERE request_id = ?"
        )
        .get(requestId) as { created_at: string; expires_at: string };
      expect(
        new Date(intent.expires_at).getTime() -
          new Date(intent.created_at).getTime()
      ).toBe(7 * 86400_000);
      await app.close();
      app = await buildApp({ config, db, logger: false });
      expect(
        (await create("late.jpg", jpeg.length, requestId)).statusCode
      ).toBe(409);
      expect(getManagedUploadByRequestId(db, requestId)).toBeNull();
      expect(db.prepare("SELECT id FROM assets").all()).toEqual([]);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/uploads/cancel",
            headers,
            payload: { requestId }
          })
        ).json()
      ).toEqual({ status: "cancelled" });
    });

    it("cancels admitted bytes by request ID and releases the owned staging reservation", async () => {
      const requestId = randomUUID();
      const created = await create("cancelled.jpg", jpeg.length, requestId);
      const url = created.headers.location!;
      const id = url.split("/").at(-1)!;
      await patch(url, 0, jpeg.subarray(0, 40));
      const result = await app.inject({
        method: "POST",
        url: "/api/uploads/cancel",
        headers,
        payload: { requestId }
      });
      expect(result.statusCode).toBe(200);
      expect(getManagedUpload(db, id)).toMatchObject({
        status: "cancelled",
        cleanedUp: true,
        offset: 40
      });
      await expect(
        readFile(path.join(config.dataDir, "uploads", id))
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(fileManagementBlockers(config.configDir).uploads).toBe(0);
      expect(
        (await create("cancelled.jpg", jpeg.length, requestId)).statusCode
      ).toBe(409);
    });

    it("preserves cancellation during stage creation and cleans it after the creation claim drains", async () => {
      const probePath = path.join(directory, "sync-probe");
      const probe = await open(probePath, "wx");
      const prototype = Object.getPrototypeOf(probe) as FileHandle;
      await probe.close();
      await rm(probePath);
      const original = prototype.sync;
      let unblock!: () => void;
      const blockedUntil = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      let blocked = false;
      const spy = vi
        .spyOn(prototype, "sync")
        .mockImplementation(async function (this: FileHandle) {
          const filename = await readlink(`/proc/self/fd/${this.fd}`);
          if (
            !blocked &&
            path.dirname(filename) === path.join(config.dataDir, "uploads")
          ) {
            blocked = true;
            await blockedUntil;
          }
          await original.call(this);
        });
      try {
        const requestId = randomUUID();
        const creation = create("cancel-create.jpg", jpeg.length, requestId);
        await expect.poll(() => blocked).toBe(true);
        const admitted = getManagedUploadByRequestId(db, requestId)!;
        expect(admitted.stagingIdentity).toBeDefined();
        const cancelled = await app.inject({
          method: "POST",
          url: "/api/uploads/cancel",
          headers,
          payload: { requestId }
        });
        expect(cancelled.statusCode).toBe(200);
        expect(getManagedUpload(db, admitted.id)).toMatchObject({
          status: "cancelled",
          cleanedUp: false
        });
        unblock();
        expect((await creation).statusCode).toBe(409);
        await expect
          .poll(() => getManagedUpload(db, admitted.id)?.cleanedUp)
          .toBe(true);
        expect(getManagedUpload(db, admitted.id)?.status).toBe("cancelled");
        await expect(
          readFile(path.join(config.dataDir, "uploads", admitted.id))
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(db.prepare("SELECT id FROM file_operations").all()).toEqual([]);
      } finally {
        unblock();
        spy.mockRestore();
      }
    });

    it("keeps cancellation during a streamed final chunk from publishing media", async () => {
      const requestId = randomUUID();
      const created = await create("cancel-chunk.jpg", jpeg.length, requestId);
      const id = created.headers.location!.split("/").at(-1)!;
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          value.enqueue(Uint8Array.from(jpeg.subarray(0, 40)));
        }
      });
      const init: RequestInit & { duplex: "half" } = {
        method: "PATCH",
        headers: {
          ...headers,
          "content-type": "application/offset+octet-stream",
          "upload-offset": "0",
          "content-length": String(jpeg.length)
        },
        body: stream,
        duplex: "half"
      };
      const response = fetch(new URL(created.headers.location!, address), init);
      let ended = false;
      try {
        await expect
          .poll(
            async () =>
              (await readFile(path.join(config.dataDir, "uploads", id))).length
          )
          .toBe(40);
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/uploads/cancel",
              headers,
              payload: { requestId }
            })
          ).statusCode
        ).toBe(200);
        expect(getManagedUpload(db, id)).toMatchObject({
          status: "cancelled",
          cleanedUp: false
        });
        controller.enqueue(Uint8Array.from(jpeg.subarray(40)));
        controller.close();
        ended = true;
        const finished = await response;
        expect(finished.status).toBe(409);
        await finished.arrayBuffer();
        await expect.poll(() => getManagedUpload(db, id)?.cleanedUp).toBe(true);
        expect(getManagedUpload(db, id)?.status).toBe("cancelled");
        expect(db.prepare("SELECT id FROM file_operations").all()).toEqual([]);
        expect(db.prepare("SELECT id FROM assets").all()).toEqual([]);
        await expect(
          readFile(path.join(config.dataDir, "uploads", id))
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        if (!ended) {
          controller.error(new Error("Stop incomplete test request"));
          await response.catch(() => undefined);
        }
      }
    }, 15_000);

    it.each(["validating", "publishing", "completed"] as const)(
      "refuses to cancel %s uploads",
      async (status) => {
        const requestId = randomUUID();
        const created = await create("locked.jpg", jpeg.length, requestId);
        const id = created.headers.location!.split("/").at(-1)!;
        updateManagedUpload(db, { ...getManagedUpload(db, id)!, status });
        const cancelled = await app.inject({
          method: "POST",
          url: "/api/uploads/cancel",
          headers,
          payload: { requestId }
        });
        expect(cancelled.statusCode).toBe(409);
        expect(cancelled.json()).toEqual({ error: "upload_not_cancellable" });
        expect(getManagedUpload(db, id)?.status).toBe(status);
        expect(
          db
            .prepare(
              "SELECT request_id FROM upload_cancellations WHERE request_id = ?"
            )
            .get(requestId)
        ).toBeUndefined();
      }
    );

    it("prunes expired cancellation intents in bounded batches and retains current intents", async () => {
      const active = randomUUID();
      await app.inject({
        method: "POST",
        url: "/api/uploads/cancel",
        headers,
        payload: { requestId: active }
      });
      const insert = db.prepare(
        "INSERT INTO upload_cancellations VALUES (?, '2000-01-01T00:00:00Z', '2000-01-08T00:00:00Z')"
      );
      for (let index = 0; index < 105; index++) insert.run(randomUUID());
      expect(pruneUploadCancellations(db)).toBe(100);
      expect(pruneUploadCancellations(db)).toBe(5);
      expect(pruneUploadCancellations(db)).toBe(0);
      expect(
        db.prepare("SELECT request_id FROM upload_cancellations").all()
      ).toEqual([{ request_id: active }]);
    });

    it("rejects unsafe names and undeclared types at creation", async () => {
      expect((await create("../escape.jpg")).statusCode).toBe(400);
      expect((await create("script.html")).statusCode).toBe(415);
      expect(db.prepare("SELECT id FROM managed_uploads").all()).toHaveLength(
        0
      );
    });

    it("does not reset an existing transfer when a request ID is reused", async () => {
      const id = randomUUID();
      const first = await create("same.jpg", jpeg.length, id);
      expect(first.statusCode).toBe(201);
      await patch(first.headers.location!, 0, jpeg.subarray(0, 40));
      const second = await create("same.jpg", jpeg.length, id);
      expect(second.statusCode).toBe(409);
      const head = await app.inject({
        method: "HEAD",
        url: first.headers.location!,
        headers
      });
      expect(head.headers["upload-offset"]).toBe("40");
    });

    it("verifies standard sha256 chunk checksums and retains only the acknowledged prefix on mismatch", async () => {
      const options = await app.inject({
        method: "OPTIONS",
        url: "/api/uploads",
        headers
      });
      expect(options.headers["tus-checksum-algorithm"]).toBe("sha256");
      const created = await create("checksum.jpg");
      const url = created.headers.location!;
      const id = url.split("/").at(-1)!;
      const chunk = jpeg.subarray(0, 40);
      const send = (checksum: string) =>
        app.inject({
          method: "PATCH",
          url,
          headers: {
            ...headers,
            "content-type": "application/offset+octet-stream",
            "upload-offset": "0",
            "upload-checksum": checksum
          },
          payload: chunk
        });
      const wrong = await send(
        `sha256 ${createHash("sha256").update("wrong").digest("base64")}`
      );
      expect(wrong.statusCode).toBe(460);
      expect(getManagedUpload(db, id)?.offset).toBe(0);
      expect(
        await readFile(path.join(config.dataDir, "uploads", id))
      ).toHaveLength(0);
      expect((await send("md5 invalid")).statusCode).toBe(400);
      const correct = await send(
        `sha256 ${createHash("sha256").update(chunk).digest("base64")}`
      );
      expect(correct.statusCode).toBe(204);
      expect(correct.headers["upload-offset"]).toBe("40");
      expect(await readFile(path.join(config.dataDir, "uploads", id))).toEqual(
        chunk
      );
    });

    it("keeps an older paused upload visible ahead of terminal history and supports targeted reconciliation", async () => {
      const requestId = randomUUID();
      const created = await create("uncertain.jpg", jpeg.length, requestId);
      const id = created.headers.location!.split("/").at(-1)!;
      db.prepare(
        "UPDATE managed_uploads SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?"
      ).run(id);
      for (let index = 0; index < 110; index += 1)
        createManagedUpload(
          db,
          {
            id: randomUUID(),
            requestId: randomUUID(),
            folderId,
            expectedParentVersion: version,
            name: `completed-${index}.jpg`,
            conflict: "skip",
            size: 1,
            offset: 1,
            status: "completed",
            cleanedUp: true,
            expiresAt: "2099-01-01T00:00:00Z"
          },
          1024 * 1024
        );
      for (let index = 0; index < 3; index++)
        createManagedUpload(
          db,
          {
            id: randomUUID(),
            requestId: randomUUID(),
            folderId,
            expectedParentVersion: version,
            name: `failed-${index}.jpg`,
            conflict: "skip",
            size: 1,
            offset: 0,
            status: "failed",
            cleanedUp: false,
            expiresAt: "2099-01-01T00:00:00Z"
          },
          1024 * 1024
        );
      const ordered = listManagedUploads(db);
      expect(ordered).toHaveLength(100);
      expect(ordered[0]?.id).toBe(id);
      expect(
        ordered
          .slice(1, 4)
          .every((upload) => upload.status === "failed" && !upload.cleanedUp)
      ).toBe(true);
      expect(
        ordered
          .slice(4)
          .every((upload) => upload.status === "completed" && upload.cleanedUp)
      ).toBe(true);
      const response = await app.inject({
        url: "/api/uploads/status",
        headers
      });
      const recent = response.json<{ items: Array<{ id: string }> }>();
      expect(recent.items).toHaveLength(100);
      expect(recent.items[0]?.id).toBe(id);
      expect(response.body).not.toContain(directory);
      expect(response.body).not.toContain("stagingIdentity");
      const targeted = (
        await app.inject({
          url: `/api/uploads/status?requestId=${requestId}`,
          headers
        })
      ).json<{ items: Array<{ id: string }> }>();
      expect(targeted.items.map((item) => item.id)).toEqual([id]);
    });

    it("keeps incomplete bytes private and cleans failed and expired owned stages", async () => {
      const partial = await create("private.jpg");
      const url = partial.headers.location!;
      await patch(url, 0, jpeg.subarray(0, 40));
      expect((await app.inject({ url, headers })).statusCode).toBe(404);
      const id = url.split("/").at(-1)!;
      updateManagedUpload(db, {
        ...getManagedUpload(db, id)!,
        expiresAt: "2020-01-01T00:00:00Z"
      });
      await app.inject({ url: "/api/uploads/status", headers });
      expect(getManagedUpload(db, id)).toMatchObject({
        status: "expired",
        cleanedUp: true
      });
      await expect(
        readFile(path.join(config.dataDir, "uploads", id))
      ).rejects.toMatchObject({ code: "ENOENT" });
      const invalid = await create("invalid.jpg", 4);
      await patch(invalid.headers.location!, 0, Buffer.from("bad!"));
      const invalidId = invalid.headers.location!.split("/").at(-1)!;
      await expect
        .poll(() => getManagedUpload(db, invalidId)?.cleanedUp)
        .toBe(true);
      expect(fileManagementBlockers(config.configDir).uploads).toBe(0);
    });

    it("rejects a replaced staging entry and retains its recovery reservation", async () => {
      const created = await create();
      const url = created.headers.location!;
      const id = url.split("/").at(-1)!;
      const victim = path.join(directory, "untouched.jpg");
      await writeFile(victim, "untouched");
      await rm(path.join(config.dataDir, "uploads", id));
      await symlink(victim, path.join(config.dataDir, "uploads", id));
      expect((await patch(url, 0, jpeg)).statusCode).toBeGreaterThanOrEqual(
        400
      );
      await app.inject({ url: "/api/uploads/status", headers });
      expect(await readFile(victim, "utf8")).toBe("untouched");
      expect(getManagedUpload(db, id)?.cleanedUp).not.toBe(true);
      expect(fileManagementBlockers(config.configDir).uploads).toBe(1);
    });

    it("finishes fully received bytes after a restart even if the last offset was not journaled", async () => {
      const created = await create("recovered.jpg");
      const url = created.headers.location!;
      const id = url.split("/").at(-1)!;
      await patch(url, 0, jpeg.subarray(0, 40));
      await app.close();
      await appendFile(
        path.join(config.dataDir, "uploads", id),
        jpeg.subarray(40)
      );
      expect(getManagedUpload(db, id)?.offset).toBe(40);
      app = await buildApp({ config, db, logger: false });
      await expect
        .poll(
          async () => {
            await app.inject({ url: "/api/uploads/status", headers });
            return getManagedUpload(db, id)?.status;
          },
          { timeout: 15_000, interval: 100 }
        )
        .toBe("completed");
      expect(
        await readFile(path.join(directory, "media", "recovered.jpg"))
      ).toEqual(jpeg);
    }, 30_000);

    it("reserves staging and destination allocations together on a shared volume", () => {
      const id = randomUUID();
      createManagedUpload(
        db,
        {
          id,
          requestId: randomUUID(),
          folderId,
          expectedParentVersion: version,
          name: "reserved.jpg",
          conflict: "skip",
          size: 100,
          offset: 0,
          status: "receiving",
          expiresAt: "2099-01-01T00:00:00Z",
          stagingDevice: "shared",
          destinationDevice: "shared"
        },
        100
      );
      expect(uploadVolumeReservations(db).get("shared")).toBe(200n);
      updateManagedUpload(db, { ...getManagedUpload(db, id)!, offset: 40 });
      expect(uploadVolumeReservations(db).get("shared")).toBe(160n);
      expect(uploadVolumeReservations(db, id).size).toBe(0);
      updateManagedUpload(db, {
        ...getManagedUpload(db, id)!,
        status: "failed"
      });
      expect(() =>
        createManagedUpload(
          db,
          {
            ...getManagedUpload(db, id)!,
            id: randomUUID(),
            requestId: randomUUID(),
            status: "receiving"
          },
          100
        )
      ).toThrow("upload_budget_exceeded");
    });

    it("streams tus chunks over a real HTTP connection", async () => {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const metadata = {
        requestId: randomUUID(),
        folderId,
        expectedParentVersion: version,
        name: "network.jpg",
        conflict: "skip"
      };
      const created = await fetch(`${address}/api/uploads`, {
        method: "POST",
        headers: {
          ...headers,
          "upload-length": String(jpeg.length),
          "upload-metadata": Object.entries(metadata)
            .map(
              ([key, value]) =>
                `${key} ${Buffer.from(value).toString("base64")}`
            )
            .join(",")
        }
      });
      expect(created.status).toBe(201);
      const url = new URL(created.headers.get("location")!, address);
      const first = await fetch(url, {
        method: "PATCH",
        headers: {
          ...headers,
          "content-type": "application/offset+octet-stream",
          "upload-offset": "0"
        },
        body: Uint8Array.from(jpeg.subarray(0, 40))
      });
      expect(first.status).toBe(204);
      const head = await fetch(url, { method: "HEAD", headers });
      expect(head.headers.get("upload-offset")).toBe("40");
      const last = await fetch(url, {
        method: "PATCH",
        headers: {
          ...headers,
          "content-type": "application/offset+octet-stream",
          "upload-offset": "40"
        },
        body: Uint8Array.from(jpeg.subarray(40))
      });
      expect(last.status).toBe(204);
      await expect
        .poll(
          async () =>
            (
              await app.inject({
                url: `/api/file-operations/${last.headers.get("upload-operation-id")}`,
                headers
              })
            ).json<{ status: string }>().status,
          { timeout: 15_000, interval: 100 }
        )
        .toBe("completed");
      expect(
        await readFile(path.join(directory, "media", "network.jpg"))
      ).toEqual(jpeg);
    }, 30_000);

    it("rejects an obsolete list revision on the actual API query parameter", async () => {
      const original = (
        await app.inject({ url: `/api/folders/${folderId}/assets`, headers })
      ).json<{ page: { revision: string } }>();
      const requestId = randomUUID();
      const accepted = await app.inject({
        method: "POST",
        url: "/api/file-operations",
        headers,
        payload: {
          requestId,
          type: "create-folder",
          items: [],
          destinationFolderId: folderId,
          expectedParentVersion: version,
          name: "New folder"
        }
      });
      expect(accepted.statusCode).toBe(202);
      await expect
        .poll(
          async () =>
            (
              await app.inject({
                url: `/api/file-operations/${requestId}`,
                headers
              })
            ).json<{ status: string }>().status,
          { timeout: 15_000 }
        )
        .toBe("completed");
      const stale = await app.inject({
        url: `/api/folders/${folderId}/assets?expectedRevision=${original.page.revision}`,
        headers
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({ error: "snapshot_changed" });
      expect(
        (await app.inject({ url: `/api/folders/${folderId}/assets`, headers }))
          .statusCode
      ).toBe(200);
    });

    it("bounds authenticated record hydration and never returns private locations", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        headers,
        payload: { assetIds: ["missing-asset"] }
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ assets: unknown[]; revision: string }>().assets
      ).toEqual([]);
      expect(response.body).not.toContain(directory);
      const excessive = await app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        headers,
        payload: {
          assetIds: Array.from({ length: 501 }, (_, index) => `asset-${index}`)
        }
      });
      expect(excessive.statusCode).toBe(400);
      const denied = await app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        payload: { assetIds: ["missing-asset"] }
      });
      expect(denied.statusCode).toBe(401);
    });
  }
);
