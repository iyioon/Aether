import { rm, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { hashPassword } from "../../apps/server/src/auth/password.js";
import { loadConfig } from "../../apps/server/src/config/config.js";
import { openDatabase } from "../../apps/server/src/db/database.js";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "../../apps/server/src/config/data-directory.js";
import { createPrivateTemporaryFiles } from "../../apps/server/src/maintenance/private-temporary-files.js";
import { acquireRuntimeLock } from "../../apps/server/src/maintenance/runtime-lock.js";
import { closeServerRuntime } from "../../apps/server/src/maintenance/server-runtime.js";
import { FileOperationsFilesystem } from "../../apps/server/src/library/file-operations-filesystem.js";
import { withLibraryMutationLock } from "../../apps/server/src/library/library-mutation-lock.js";
import { FileOperationBody } from "../../apps/server/src/library/file-operation-model.js";
import {
  createManagedOperation,
  getManagedAsset,
  getManagedRootOwnership,
  updateManagedOperation
} from "../../apps/server/src/library/repository-management.js";
import { captureTrashThumbnail } from "../../apps/server/src/library/trash-thumbnails.js";

process.umask(0o077);

const password = "aether-e2e-password";
const host = "127.0.0.1";
const port = Number(process.env.AETHER_E2E_API_PORT ?? 3130);
const runtimeDir = path.resolve(process.cwd(), ".e2e");
const mediaDir = path.join(runtimeDir, "media");
const dataDir = path.join(runtimeDir, "aether-data");
const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
const gifFixture = Buffer.from(
  "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

await rm(runtimeDir, { force: true, recursive: true });
const dataPaths = resolveDataPaths({ AETHER_DATA_DIR: dataDir }, process.cwd());
await initializeDataDirectory(dataPaths);
const releaseRuntimeLock = await acquireRuntimeLock(dataPaths);
const temporaryFiles = await createPrivateTemporaryFiles(dataPaths);
const { default: sharp } = await import("sharp");
const { runMediaCommand } =
  await import("../../apps/server/src/library/video-processing.js");
await prepareFixtureLibrary();

const config = await loadConfig(
  {
    ...process.env,
    AETHER_HOST: host,
    AETHER_PORT: String(port),
    AETHER_MEDIA_ROOTS: `media=${mediaDir}`,
    AETHER_WRITABLE_ROOTS: "media",
    AETHER_DATA_DIR: dataDir,
    AETHER_PASSWORD_HASH: await hashPassword(password),
    AETHER_SESSION_SECRET: "e2e-development-session-secret-32chars",
    AETHER_COOKIE_SECURE: "false",
    // Independent browser scenarios share loopback; exercise throttling in API tests.
    AETHER_LOGIN_MAX_ATTEMPTS: "100",
    NODE_ENV: "test"
  },
  process.cwd()
);
const db = openDatabase(config.configDir);
const { buildApp } = await import("../../apps/server/src/http/app.js");
const app = await buildApp({ config, db, logger: false });

// This route exists only in the disposable browser-test server. App-level
// session and CSRF hooks still apply; the fixture cannot target arbitrary media.
app.post("/api/e2e/trash-publication", async (request, reply) => {
  const body = z
    .object({ assetId: z.string().min(1).max(256) })
    .strict()
    .safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "invalid_request" });
  return withLibraryMutationLock(db, async () => {
    const asset = getManagedAsset(db, body.data.assetId);
    if (
      !asset ||
      asset.lifecycle !== "active" ||
      asset.rootRealPath !== mediaDir ||
      !["trash-recovery-desktop.png", "trash-recovery-phone.png"].includes(
        asset.relativePath
      )
    )
      return reply.code(400).send({ error: "invalid_fixture" });
    if (
      db
        .prepare(
          "SELECT 1 FROM file_operations WHERE status NOT IN ('completed', 'partial', 'cancelled', 'failed') LIMIT 1"
        )
        .get()
    )
      return reply.code(409).send({ error: "library_busy" });
    const ownership = getManagedRootOwnership(db, asset.rootId);
    if (!ownership) return reply.code(409).send({ error: "read_only" });
    const filesystem = new FileOperationsFilesystem();
    const location = (relativePath: string) => ({
      rootPath: mediaDir,
      relativePath,
      expectedRoot: { dev: ownership.deviceId, ino: ownership.inode }
    });
    const operation = FileOperationBody.parse({
      requestId: randomUUID(),
      type: "trash",
      items: [{ assetId: asset.id, expectedVersion: asset.sourceVersion }]
    });
    const source = location(asset.relativePath);
    const before = await filesystem.inventory(source);
    const originalIdentity = before.entries[0]!.identity;
    const destinationPath = `.aether-trash/${operation.requestId}/0`;
    await filesystem.createDirectory(
      location(`.aether-trash/${operation.requestId}`)
    );
    const trashId = `${operation.requestId}-0`;
    await captureTrashThumbnail(config, db, asset.id, trashId);
    await filesystem.rename(
      source,
      location(destinationPath),
      originalIdentity
    );
    const publishedManifest = await filesystem.inventory(
      location(destinationPath)
    );
    const published = publishedManifest.entries[0]!.identity;
    // APFS can change the moved entry's metadata during native rename. Retain
    // real destination identities and bytes, with the older metadata snapshot
    // in the prepared journal to reproduce that state on every test platform.
    const expected = {
      ...originalIdentity,
      metadataSha256:
        published.metadataSha256 === "0".repeat(64)
          ? "1".repeat(64)
          : "0".repeat(64),
      metadataBytes: (originalIdentity.metadataBytes ?? 0) + 1
    };
    const stateJson = JSON.stringify({
      cancelRequested: false,
      items: [
        {
          input: operation.items[0],
          status: "needs_attention",
          phase: "prepared",
          source: { rootId: asset.rootId, relativePath: asset.relativePath },
          destination: { rootId: asset.rootId, relativePath: destinationPath },
          expected,
          manifest: {
            entries: [{ ...before.entries[0], identity: expected }],
            totalBytes: before.totalBytes + 1
          },
          published,
          publishedManifest,
          sourceAssetId: asset.id,
          trashId,
          errorCode: "destination_exists"
        }
      ]
    });
    createManagedOperation(db, {
      id: operation.requestId,
      requestJson: JSON.stringify(operation),
      stateJson
    });
    updateManagedOperation(db, operation.requestId, {
      status: "needs_attention",
      stateJson
    });
    return { operationId: operation.requestId };
  });
});

await app.listen({ host, port });

async function prepareFixtureLibrary() {
  await mkdir(path.join(mediaDir, "Trips"), { recursive: true });
  await writeFile(path.join(mediaDir, "family-photo.png"), pngFixture);
  await writeFile(path.join(mediaDir, "loop-memory.gif"), gifFixture);
  await writeFile(path.join(mediaDir, "apng-candidate.apng"), pngFixture);
  await writeFile(
    path.join(mediaDir, "animated-memory.webp"),
    await createAnimatedWebpFixture()
  );
  await writeFile(
    path.join(mediaDir, "avif-candidate.avif"),
    await createAvifFixture()
  );
  await writeFile(path.join(mediaDir, "Trips", "beach-walk.png"), pngFixture);
  await writeFile(path.join(mediaDir, "Trips", "city-night.png"), pngFixture);
  await createHeicFixtures();
}

async function createHeicFixtures(): Promise<void> {
  // The HEIC spec installs these into a temporary source folder, preserving other specs' library sizes.
  const directory = path.join(dataDir, "cache", "e2e-fixtures", "heic");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, width, height, color] of [
    ["source", 320, 160, "#92b8a3"],
    ["replacement", 180, 320, "#7e9ec4"]
  ] as const) {
    const png = path.join(directory, `${name}.png`);
    await sharp({ create: { width, height, channels: 4, background: color } })
      .png()
      .toFile(png);
    await runMediaCommand(
      "heif-enc",
      [
        "-L",
        "-p",
        "x265:pools=none",
        "-p",
        "x265:frame-threads=1",
        "-o",
        path.join(directory, `${name}.heic`),
        png
      ],
      30_000
    );
  }
}

async function createAnimatedWebpFixture(): Promise<Buffer> {
  const width = 2;
  const height = 2;
  const frame = (rgba: readonly number[]) =>
    Buffer.concat(
      Array.from({ length: width * height }, () => Buffer.from(rgba))
    );
  const frames = Buffer.concat([
    frame([147, 183, 165, 255]),
    frame([125, 154, 180, 255])
  ]);

  return sharp(frames, {
    raw: {
      width,
      height: height * 2,
      channels: 4,
      pageHeight: height
    },
    animated: true
  })
    .webp({
      loop: 0,
      delay: [80, 80],
      effort: 0
    })
    .toBuffer();
}

async function createAvifFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: "#7d9ab4"
    }
  })
    .heif({
      compression: "av1",
      quality: 70,
      effort: 0
    })
    .toBuffer();
}

async function shutdown() {
  await closeServerRuntime({
    closeApplication: async () => {
      await app.close();
    },
    closeDatabase: () => {
      db.close();
    },
    releaseLock: async () => {
      try {
        await temporaryFiles.close();
      } finally {
        await releaseRuntimeLock();
      }
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown()
      .catch(() => undefined)
      .finally(() => {
        process.exit(0);
      });
  });
}
