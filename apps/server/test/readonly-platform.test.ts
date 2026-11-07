import {
  lstat,
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
import { expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { getAsset } from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";

it("starts read-only on macOS with configured writable roots and keeps annotations available", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "aether-readonly-platform-")
  );
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  let app: FastifyInstance | undefined;
  let db: AetherDatabase | undefined;
  try {
    const media = path.join(directory, "media");
    await mkdir(media);
    const source = path.join(media, "photo.jpg");
    await writeFile(source, "unchanged media bytes");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "media=./media",
        AETHER_WRITABLE_ROOTS: "media",
        AETHER_DATA_DIR: "./data",
        AETHER_PASSWORD_HASH: await hashPassword("readonly-platform-password"),
        AETHER_SESSION_SECRET:
          "readonly-platform-session-secret-is-long-enough",
        NODE_ENV: "test"
      },
      directory
    );
    expect(config.mediaRoots[0]?.writable).toBe(true);
    // Load the host's native SQLite binary before exercising macOS runtime guards.
    db = openDatabase(config.configDir);
    expect((await scanLibrary(db, config.mediaRoots)).outcome).toBe(
      "completed"
    );
    const asset = db.prepare("SELECT id FROM assets").get() as { id: string };
    Object.defineProperty(process, "platform", { value: "darwin" });
    app = await buildApp({ config, db, logger: false });
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "readonly-platform-password" }
    });
    expect(login.statusCode).toBe(200);
    const headers = {
      cookie: login.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
      "x-csrf-token": login.cookies.find(
        (cookie) => cookie.name === "aether_csrf"
      )!.value
    };
    const tree = await app.inject({ url: "/api/tree", headers });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().roots).toMatchObject([
      {
        writable: false,
        writeUnavailableReason: "unsupported_filesystem",
        allowedActions: [],
        assetCount: 1
      }
    ]);
    const uploads = await app.inject({ url: "/api/uploads/status", headers });
    expect(uploads.statusCode).toBe(200);
    expect(uploads.json()).toMatchObject({
      items: [],
      recoveryRequired: false
    });
    const create = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers
    });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toEqual({ error: "unsupported_filesystem" });

    const score = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/score`,
      headers,
      payload: { score: 4 }
    });
    expect(score.statusCode).toBe(200);
    expect(score.json().asset).toMatchObject({ id: asset.id, score: 4 });
    const tags = await app.inject({
      method: "PUT",
      url: `/api/assets/${asset.id}/tags`,
      headers,
      payload: { tags: ["Travel"] }
    });
    expect(tags.statusCode).toBe(200);
    expect(getAsset(db, asset.id)).toMatchObject({
      score: 4,
      tags: [{ displayName: "Travel" }]
    });
    expect(await readFile(source, "utf8")).toBe("unchanged media bytes");
    expect(await readdir(media)).toEqual(["photo.jpg"]);
    await expect(
      lstat(path.join(config.dataDir, "uploads"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    try {
      await app?.close();
    } finally {
      Object.defineProperty(process, "platform", platform);
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
