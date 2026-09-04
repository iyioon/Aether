import { rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hashPassword } from "../../apps/server/src/auth/password.js";
import { loadConfig } from "../../apps/server/src/config/config.js";
import { openDatabase } from "../../apps/server/src/db/database.js";
import { buildApp } from "../../apps/server/src/http/app.js";

const password = "aether-e2e-password";
const host = "127.0.0.1";
const port = Number(process.env.AETHER_E2E_API_PORT ?? 3130);
const runtimeDir = path.resolve(process.cwd(), ".e2e");
const mediaDir = path.join(runtimeDir, "media");
const configDir = path.join(runtimeDir, "config");
const cacheDir = path.join(runtimeDir, "cache");
const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
const gifFixture = Buffer.from(
  "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

await prepareFixtureLibrary();

const config = await loadConfig(
  {
    ...process.env,
    AETHER_HOST: host,
    AETHER_PORT: String(port),
    AETHER_MEDIA_ROOTS: mediaDir,
    AETHER_CONFIG_DIR: configDir,
    AETHER_CACHE_DIR: cacheDir,
    AETHER_PASSWORD_HASH: await hashPassword(password),
    AETHER_SESSION_SECRET: "e2e-development-session-secret-32chars",
    AETHER_COOKIE_SECURE: "false",
    NODE_ENV: "test"
  },
  process.cwd()
);
const db = openDatabase(config.configDir);
const app = await buildApp({ config, db, logger: false });

await app.listen({ host, port });

async function prepareFixtureLibrary() {
  await rm(runtimeDir, { force: true, recursive: true });
  await mkdir(path.join(mediaDir, "Trips"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(mediaDir, "family-photo.png"), pngFixture);
  await writeFile(path.join(mediaDir, "loop-memory.gif"), gifFixture);
  await writeFile(path.join(mediaDir, "apng-candidate.apng"), pngFixture);
  await writeFile(
    path.join(mediaDir, "animated-memory.webp"),
    await createAnimatedWebpFixture()
  );
  await writeFile(path.join(mediaDir, "avif-candidate.avif"), await createAvifFixture());
  await writeFile(path.join(mediaDir, "Trips", "beach-walk.png"), pngFixture);
  await writeFile(path.join(mediaDir, "Trips", "city-night.png"), pngFixture);
}

async function createAnimatedWebpFixture(): Promise<Buffer> {
  const width = 2;
  const height = 2;
  const frame = (rgba: readonly number[]) =>
    Buffer.concat(Array.from({ length: width * height }, () => Buffer.from(rgba)));
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
  await app.close();
  db.close();
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
