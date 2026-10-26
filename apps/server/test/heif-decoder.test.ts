import {
  mkdir,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rename,
  open,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { hashPassword } from "../src/auth/password.js";
import { buildApp } from "../src/http/app.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import {
  inspectHeifImage,
  parseHeifInfo
} from "../src/library/heif-decoder.js";
import {
  ensureImageDisplay,
  IMAGE_DISPLAY_MAX_OUTPUT_BYTES,
  requireImageDisplayOutput
} from "../src/library/image-display.js";
import {
  imageSourceKey,
  openImageCacheFile
} from "../src/library/image-cache.js";
import {
  resolveAssetFile,
  type ResolvedAssetFile
} from "../src/library/media-serving.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";
import { ensureImageThumbnail } from "../src/library/thumbnails.js";
import { runMediaCommand } from "../src/library/video-processing.js";
import * as processing from "../src/library/video-processing.js";

let directory: string;
let config: AppConfig;
let db: AetherDatabase;
let app: FastifyInstance | undefined;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aether-heic-"));
  await mkdir(path.join(directory, "media"));
  config = await loadConfig(
    { AETHER_MEDIA_ROOTS: "./media", AETHER_DATA_DIR: "./data" },
    directory
  );
  db = openDatabase(config.configDir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = undefined;
  db.close();
  await rm(directory, { recursive: true, force: true });
});

async function fixture(
  options: {
    tenBit?: boolean;
    exifRotation?: boolean;
    multi?: boolean;
    hdr?: boolean;
    profile?: boolean;
    tiled?: boolean;
    transfer?: number;
  } = {}
) {
  const source = path.join(config.cacheDir, "fixture.png");
  const width = options.tiled ? 512 : 64;
  const height = options.tiled ? 384 : 48;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      rgba[p] = x * 4;
      rgba[p + 1] = y * 5;
      rgba[p + 2] = ((x + y) % 2) * 255;
      rgba[p + 3] = x < 32 ? 255 : 128;
    }
  let processor = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (options.tenBit) processor = processor.toColourspace("rgb16");
  if (options.exifRotation)
    processor = processor.withExif({ IFD0: { Orientation: "6" } });
  if (options.profile) processor = processor.withIccProfile("p3");
  await processor.png().toFile(source);
  const heic = path.join(directory, "media", "actual.heic");
  const second = path.join(config.cacheDir, "second.png");
  if (options.multi)
    await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 0.5 }
      }
    })
      .png()
      .toFile(second);
  await runMediaCommand(
    "heif-enc",
    [
      "-L",
      "-p",
      "x265:pools=none",
      "-p",
      "x265:frame-threads=1",
      ...(options.tenBit ? ["-b", "10"] : []),
      ...(options.tiled ? ["--cut-tiles", "32"] : []),
      ...(options.transfer !== undefined
        ? ["--transfer_characteristic", String(options.transfer)]
        : []),
      ...(options.hdr
        ? ["--transfer_characteristic", "16", "--colour_primaries", "9"]
        : []),
      "-o",
      heic,
      source,
      ...(options.multi ? [second] : [])
    ],
    15_000
  );
  if (options.multi) {
    const info = await runMediaCommand("heif-info", [heic], 10_000);
    const secondId = Number(
      [...info.stdout.matchAll(/^image: .*\(id=(\d+)\)/gm)][1]![1]
    );
    const bytes = await readFile(heic);
    bytes.writeUInt16BE(secondId, bytes.indexOf(Buffer.from("pitm")) + 8);
    await writeFile(heic, bytes);
  }
  return { heic, source, rgba };
}
async function indexed(): Promise<ResolvedAssetFile> {
  await scanLibrary(db, config.mediaRoots);
  const asset = listAssets(db, {
    folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
    offset: 0,
    limit: 10,
    sort: "filename",
    type: "all",
    recursive: true
  })!.items[0]!;
  return (await resolveAssetFile(db, asset.id))!;
}

// Edits only boxes emitted by our small heif-enc fixture; encoded HEVC pixels stay intact.
async function addHeifTransforms(
  filePath: string,
  mirror: boolean
): Promise<void> {
  const input = await readFile(filePath);
  const boxes = (bytes: Buffer, start = 0) => {
    const result: Array<{ type: string; start: number; bytes: Buffer }> = [];
    for (let offset = start; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      if (size < 8 || offset + size > bytes.length)
        throw new Error("Unexpected fixture box layout");
      result.push({
        type: bytes.toString("ascii", offset + 4, offset + 8),
        start: offset,
        bytes: bytes.subarray(offset, offset + size)
      });
      offset += size;
    }
    return result;
  };
  const box = (type: string, payload: Buffer) => {
    const result = Buffer.alloc(payload.length + 8);
    result.writeUInt32BE(result.length);
    result.write(type, 4, 4, "ascii");
    payload.copy(result, 8);
    return result;
  };
  const top = boxes(input);
  const meta = top.find((entry) => entry.type === "meta")!;
  const metadata = boxes(meta.bytes, 12);
  const iprp = metadata.find((entry) => entry.type === "iprp")!;
  const properties = boxes(iprp.bytes, 8);
  const ipco = properties.find((entry) => entry.type === "ipco")!;
  const count = boxes(ipco.bytes, 8).length;
  const transforms = [
    box("irot", Buffer.from([1])),
    ...(mirror ? [box("imir", Buffer.from([0]))] : [])
  ];
  const associations = properties.find((entry) => entry.type === "ipma")!.bytes;
  const wide = Boolean(associations.readUIntBE(9, 3) & 1);
  const idBytes = associations[8] === 0 ? 2 : 4;
  const associationBytes = wide ? 2 : 1;
  const entries: Buffer[] = [];
  let cursor = 16;
  for (let index = 0; index < associations.readUInt32BE(12); index++) {
    const start = cursor;
    cursor += idBytes;
    const existingCount = associations[cursor++]!;
    cursor += existingCount * associationBytes;
    const entry = Buffer.from(associations.subarray(start, cursor));
    {
      // The generated color and alpha items share geometry and need identical transforms.
      entry[idBytes] = existingCount + transforms.length;
      const added = Buffer.alloc(transforms.length * associationBytes);
      transforms.forEach((_, number) =>
        added.writeUIntBE(
          (wide ? 0x8000 : 0x80) | (count + number + 1),
          number * associationBytes,
          associationBytes
        )
      );
      entries.push(Buffer.concat([entry, added]));
    }
  }
  const updatedIpco = box(
    "ipco",
    Buffer.concat([ipco.bytes.subarray(8), ...transforms])
  );
  const updatedIpma = box(
    "ipma",
    Buffer.concat([associations.subarray(8, 16), ...entries])
  );
  const updatedIprp = box(
    "iprp",
    Buffer.concat(
      properties.map((entry) =>
        entry.type === "ipco"
          ? updatedIpco
          : entry.type === "ipma"
            ? updatedIpma
            : entry.bytes
      )
    )
  );
  const growth = updatedIprp.length - iprp.bytes.length;
  const iloc = Buffer.from(
    metadata.find((entry) => entry.type === "iloc")!.bytes
  );
  const version = iloc[8]!;
  const offsetBytes = iloc[12]! >> 4,
    lengthBytes = iloc[12]! & 15;
  const baseBytes = iloc[13]! >> 4,
    indexBytes = version ? iloc[13]! & 15 : 0;
  const itemCount = iloc.readUIntBE(14, version < 2 ? 2 : 4);
  const read = (at: number, size: number) =>
    size
      ? size === 8
        ? Number(iloc.readBigUInt64BE(at))
        : iloc.readUIntBE(at, size)
      : 0;
  const write = (value: number, at: number, size: number) => {
    if (size === 8) iloc.writeBigUInt64BE(BigInt(value), at);
    else iloc.writeUIntBE(value, at, size);
  };
  cursor = version < 2 ? 16 : 18;
  for (let item = 0; item < itemCount; item++) {
    cursor += version < 2 ? 2 : 4;
    const method = version ? iloc.readUInt16BE(cursor) & 15 : 0;
    if (version) cursor += 2;
    cursor += 2;
    const base = read(cursor, baseBytes);
    if (method === 0 && base >= meta.start + meta.bytes.length)
      write(base + growth, cursor, baseBytes);
    cursor += baseBytes;
    const extents = iloc.readUInt16BE(cursor);
    cursor += 2;
    for (let extent = 0; extent < extents; extent++) {
      cursor += indexBytes;
      const offset = read(cursor, offsetBytes);
      if (
        method === 0 &&
        base === 0 &&
        offset >= meta.start + meta.bytes.length
      )
        write(offset + growth, cursor, offsetBytes);
      cursor += offsetBytes + lengthBytes;
    }
  }
  const updatedMeta = box(
    "meta",
    Buffer.concat([
      meta.bytes.subarray(8, 12),
      ...metadata.map((entry) =>
        entry.type === "iprp"
          ? updatedIprp
          : entry.type === "iloc"
            ? iloc
            : entry.bytes
      )
    ])
  );
  await writeFile(
    filePath,
    Buffer.concat(
      top.map((entry) => (entry.type === "meta" ? updatedMeta : entry.bytes))
    )
  );
}

describe("HEVC-backed HEIC display", () => {
  it("applies actual HEIF rotation and mirroring once to indexed dimensions, display and thumbnail pixels", async () => {
    for (const mirror of [false, true]) {
      const { heic, rgba } = await fixture();
      await addHeifTransforms(heic, mirror);
      const original = await readFile(heic);
      const file = await indexed();
      expect(file.asset).toMatchObject({ width: 48, height: 64 });
      const expected = Buffer.alloc(rgba.length);
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 48; x++) {
          // irot=1 is 90 degrees counterclockwise; imir=0 mirrors vertically afterward.
          const sourceX = mirror ? y : 63 - y;
          const sourceY = x;
          rgba.copy(
            expected,
            (y * 48 + x) * 4,
            (sourceY * 64 + sourceX) * 4,
            (sourceY * 64 + sourceX) * 4 + 4
          );
        }
      const digest = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      const display = await ensureImageDisplay({ db, config, file });
      expect(
        digest(await sharp(display.path).raw().toBuffer()),
        `mirror=${mirror}`
      ).toBe(digest(expected));
      const thumbnail = await ensureImageThumbnail({
        db,
        config,
        file,
        size: 32
      });
      expect(await sharp(thumbnail.path).metadata()).toMatchObject({
        width: 24,
        height: 32
      });
      const expectedWebp = await sharp(expected, {
        raw: { width: 48, height: 64, channels: 4 }
      })
        .resize({
          width: 32,
          height: 32,
          fit: "inside",
          withoutEnlargement: true
        })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      expect(digest(await sharp(thumbnail.path).raw().toBuffer())).toBe(
        digest(await sharp(expectedWebp).raw().toBuffer())
      );
      expect(await readFile(heic)).toEqual(original);
    }
  });
  it("rejects unprofiled BT.709 and BT.601 transfer curves while retaining ICC-backed SDR support", async () => {
    for (const transfer of [1, 6]) {
      const { heic } = await fixture({ transfer });
      await expect(inspectHeifImage(heic)).rejects.toMatchObject({
        code: "heic_color_not_supported",
        status: 415
      });
    }
    const { heic } = await fixture({
      transfer: 1,
      tenBit: true,
      profile: true
    });
    expect(await inspectHeifImage(heic)).toMatchObject({
      bitDepth: 10,
      hasProfile: true
    });
    const file = await indexed();
    await expect(
      ensureImageDisplay({ db, config, file })
    ).resolves.toMatchObject({ width: 64, height: 48 });
  });
  it("decodes an iPhone-style 192-tile HEVC grid whose metadata exceeds the ordinary command limit", async () => {
    const { heic, rgba } = await fixture({ tiled: true });
    const dump = await runMediaCommand(
      "heif-info",
      ["-d", heic],
      10_000,
      1024 * 1024
    );
    expect(Buffer.byteLength(dump.stdout)).toBeGreaterThan(96 * 1024);
    expect(await inspectHeifImage(heic)).toMatchObject({
      width: 512,
      height: 384,
      pages: 1
    });
    const file = await indexed();
    const display = await ensureImageDisplay({ db, config, file });
    expect(await sharp(display.path).raw().toBuffer()).toEqual(rgba);
  });
  it("reports oversized generated PNGs as a resource limit before cache publication", async () => {
    const output = path.join(config.cacheDir, "large-display.png");
    const handle = await open(output, "wx", 0o600);
    try {
      await handle.truncate(IMAGE_DISPLAY_MAX_OUTPUT_BYTES + 1);
    } finally {
      await handle.close();
    }
    await expect(requireImageDisplayOutput(output)).rejects.toMatchObject({
      code: "heic_limit_exceeded",
      status: 422
    });
  });
  it("queues a visible gallery of32 HEIC images, coalesces duplicates at capacity and recovers from backpressure", async () => {
    const { heic } = await fixture();
    for (let index = 1; index < 33; index++)
      await copyFile(
        heic,
        path.join(directory, "media", `camera-${index}.heic`)
      );
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
      assets.map(async (asset) => (await resolveAssetFile(db, asset.id))!)
    );
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = processing.runMediaCommand;
    let active = 0;
    let peak = 0;
    let first = true;
    vi.spyOn(processing, "runMediaCommand").mockImplementation(
      async (command, args, timeout) => {
        if (command !== "heif-convert") return original(command, args, timeout);
        active += 1;
        peak = Math.max(peak, active);
        try {
          if (first) {
            first = false;
            enter();
            await blocked;
          }
          return await original(command, args, timeout);
        } finally {
          active -= 1;
        }
      }
    );
    const firstFile = files[0]!;
    const initial = ensureImageDisplay({ db, config, file: firstFile });
    await entered;
    const rejected: ResolvedAssetFile[] = [];
    const rest = files.slice(1).map((file) =>
      ensureImageDisplay({ db, config, file }).catch((error: unknown) => {
        expect(error).toMatchObject({ code: "processing_busy", status: 503 });
        rejected.push(file);
        return null;
      })
    );
    const duplicate = ensureImageDisplay({ db, config, file: firstFile });
    await vi.waitFor(() => expect(rejected).toHaveLength(1));
    expect(peak).toBe(1);
    release();
    const results = await Promise.all([initial, duplicate, ...rest]);
    expect(results[0]).toEqual(results[1]);
    expect(results.filter(Boolean)).toHaveLength(33);
    expect(peak).toBe(1);
    await expect(
      ensureImageDisplay({ db, config, file: rejected[0]! })
    ).resolves.toMatchObject({ contentType: "image/png" });
  }, 20_000);
  it("serves authenticated display HEAD, ranges and 304 while preserving original downloads", async () => {
    const { heic, rgba } = await fixture();
    const file = await indexed();
    app = await buildApp({
      config: { ...config, passwordHash: await hashPassword("heic-password") },
      db,
      logger: false
    });
    const url = `/api/assets/${file.asset.id}/display`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "heic-password" }
    });
    const cookies = {
      aether_session: login.cookies.find(
        (cookie) => cookie.name === "aether_session"
      )!.value
    };
    const full = await app.inject({ method: "GET", url, cookies });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toContain("image/png");
    expect(full.headers["cache-control"]).toContain("private");
    expect(await sharp(full.rawPayload).raw().toBuffer()).toEqual(rgba);
    const head = await app.inject({ method: "HEAD", url, cookies });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe(String(full.rawPayload.length));
    const partial = await app.inject({
      method: "GET",
      url,
      cookies,
      headers: { range: "bytes=0-9" }
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.rawPayload).toEqual(full.rawPayload.subarray(0, 10));
    const notModified = await app.inject({
      method: "GET",
      url,
      cookies,
      headers: { "if-none-match": String(full.headers.etag) }
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toBe("");
    const original = await app.inject({
      method: "GET",
      url: `/api/assets/${file.asset.id}/download`,
      cookies
    });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload).toEqual(await readFile(heic));
    expect(original.headers["content-type"]).toContain("image/heic");
    const thumbUrl = `/api/assets/${file.asset.id}/thumbnail?size=320`;
    const thumbnail = await app.inject({
      method: "GET",
      url: thumbUrl,
      cookies
    });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers["cache-control"]).toBe("private, no-cache");
    const thumbnailHead = await app.inject({
      method: "HEAD",
      url: thumbUrl,
      cookies
    });
    expect(thumbnailHead.statusCode).toBe(200);
    expect(thumbnailHead.body).toBe("");
    expect(thumbnailHead.headers.etag).toBe(thumbnail.headers.etag);
    const thumbnail304 = await app.inject({
      method: "GET",
      url: thumbUrl,
      cookies,
      headers: { "if-none-match": `W/${thumbnail.headers.etag}` }
    });
    expect(thumbnail304.statusCode).toBe(304);
    expect(thumbnail304.body).toBe("");
    const capability = await app.inject({
      method: "GET",
      url: `/api/assets/${file.asset.id}/presentation-media`,
      cookies
    });
    expect(capability.statusCode).toBe(200);
    expect(capability.json()).toMatchObject({
      kind: "still",
      width: 64,
      height: 48
    });
  });

  it("returns stable private HDR and missing-decoder failures without leaking source paths", async () => {
    await fixture({ hdr: true, tenBit: true });
    const file = await indexed();
    app = await buildApp({
      config: { ...config, passwordHash: await hashPassword("heic-password") },
      db,
      logger: false
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "heic-password" }
    });
    const cookies = {
      aether_session: login.cookies.find(
        (cookie) => cookie.name === "aether_session"
      )!.value
    };
    const url = `/api/assets/${file.asset.id}/display`;
    const hdr = await app.inject({ method: "GET", url, cookies });
    expect(hdr.statusCode).toBe(415);
    expect(hdr.json()).toEqual({ error: "heic_hdr_not_supported" });
    expect(hdr.headers["cache-control"]).toBe("no-store");
    const original = processing.runMediaCommand;
    vi.spyOn(processing, "runMediaCommand").mockImplementation(
      async (command, args, timeout) => {
        if (command === "heif-info")
          throw Object.assign(new Error(`missing decoder at ${directory}`), {
            code: "ENOENT"
          });
        return original(command, args, timeout);
      }
    );
    const unavailable = await app.inject({ method: "GET", url, cookies });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ error: "heic_decoder_unavailable" });
    expect(unavailable.body).not.toContain(directory);
    expect(unavailable.headers["cache-control"]).toBe("no-store");
  });

  it("decodes and serves through an allowed aliased parent of the data directory", async () => {
    await fixture();
    const file = await indexed();
    const alias = path.join(directory, "data-alias");
    await symlink(config.dataDir, alias);
    const aliased = {
      ...config,
      dataDir: alias,
      cacheDir: path.join(alias, "cache"),
      passwordHash: await hashPassword("heic-password")
    };
    const display = await ensureImageDisplay({ db, config: aliased, file });
    expect(display.path).toContain(alias);
    app = await buildApp({ config: aliased, db, logger: false });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "heic-password" }
    });
    const cookies = {
      aether_session: login.cookies.find(
        (cookie) => cookie.name === "aether_session"
      )!.value
    };
    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${file.asset.id}/display`,
      cookies
    });
    expect(response.statusCode).toBe(200);
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({
      width: 64,
      height: 48
    });
  });
  it("decodes real lossless HEIC alpha pixels, shares jobs, indexes dimensions, and leaves sources unchanged", async () => {
    const { heic, rgba } = await fixture();
    const original = await readFile(heic);
    const file = await indexed();
    expect(file.asset).toMatchObject({ width: 64, height: 48 });
    const [one, two] = await Promise.all([
      ensureImageDisplay({ db, config, file }),
      ensureImageDisplay({ db, config, file })
    ]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({
      width: 64,
      height: 48,
      contentType: "image/png"
    });
    expect(await sharp(one.path).raw().toBuffer()).toEqual(rgba);
    expect(await readFile(heic)).toEqual(original);
    expect(await readdir(path.dirname(one.path))).toEqual([
      path.basename(one.path)
    ]);
    const thumbnail = await ensureImageThumbnail({
      db,
      config,
      file,
      size: 32
    });
    expect(await sharp(thumbnail.path).metadata()).toMatchObject({
      width: 32,
      height: 24,
      hasAlpha: true
    });
  });

  it("normalizes orientation once and strips private EXIF from browser renditions", async () => {
    await fixture({ exifRotation: true });
    const file = await indexed();
    const display = await ensureImageDisplay({ db, config, file });
    expect(await sharp(display.path).metadata()).toMatchObject({
      width: 64,
      height: 48
    });
    expect((await sharp(display.path).metadata()).exif).toBeUndefined();
    const thumbnail = await ensureImageThumbnail({
      db,
      config,
      file,
      size: 32
    });
    expect(await sharp(thumbnail.path).metadata()).toMatchObject({
      width: 32,
      height: 24
    });
  });

  it("selects the primary image and cleans every extra decoded image", async () => {
    const { heic } = await fixture({ multi: true });
    expect(await inspectHeifImage(heic)).toMatchObject({
      pages: 2,
      primaryPage: 1,
      width: 32,
      height: 24
    });
    const file = await indexed();
    const display = await ensureImageDisplay({ db, config, file });
    expect(await sharp(display.path).raw().toBuffer()).toEqual(
      await sharp(path.join(config.cacheDir, "second.png")).raw().toBuffer()
    );
    expect(await readdir(path.dirname(display.path))).toEqual([
      path.basename(display.path)
    ]);
  });

  it("retains 10-bit SDR gradation and embedded P3 in 16-bit PNG", async () => {
    const { heic } = await fixture({ tenBit: true, profile: true });
    expect(await inspectHeifImage(heic)).toMatchObject({
      bitDepth: 10,
      hasProfile: true
    });
    const file = await indexed();
    const display = await ensureImageDisplay({ db, config, file });
    expect(await sharp(display.path).metadata()).toMatchObject({
      bitsPerSample: 16,
      hasAlpha: true,
      hasProfile: true
    });
    const encoded = await sharp(display.path)
      .withIccProfile("srgb")
      .raw()
      .toBuffer();
    const expected = await sharp(path.join(config.cacheDir, "fixture.png"))
      .withIccProfile("srgb")
      .raw()
      .toBuffer();
    expect(
      Math.max(
        ...encoded.map((value, index) => Math.abs(value - expected[index]!))
      )
    ).toBeLessThanOrEqual(2);
  });

  it("rejects PQ/HDR explicitly without publishing partial display or thumbnails", async () => {
    const { heic } = await fixture({ hdr: true, tenBit: true });
    await expect(inspectHeifImage(heic)).rejects.toMatchObject({
      code: "heic_hdr_not_supported"
    });
    const file = await indexed();
    await expect(
      ensureImageDisplay({ db, config, file })
    ).rejects.toMatchObject({ code: "heic_hdr_not_supported" });
    expect(
      await readdir(path.join(config.cacheDir, "display-images", file.asset.id))
    ).toEqual([]);
  });

  it("rejects stale source snapshots and removes superseded files after regeneration", async () => {
    const { heic } = await fixture();
    const file = await indexed();
    const display = await ensureImageDisplay({ db, config, file });
    const thumbnail = await ensureImageThumbnail({
      db,
      config,
      file,
      size: 32
    });
    await utimes(heic, new Date(), new Date(file.mtimeMs + 2000));
    await expect(
      ensureImageDisplay({ db, config, file })
    ).rejects.toMatchObject({ code: "stale_image_source" });
    const current = (await resolveAssetFile(db, file.asset.id))!;
    const next = await ensureImageDisplay({ db, config, file: current });
    const nextThumb = await ensureImageThumbnail({
      db,
      config,
      file: current,
      size: 32
    });
    expect(next.path).not.toBe(display.path);
    expect(nextThumb.path).not.toBe(thumbnail.path);
    await expect(readFile(display.path)).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(thumbnail.path)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("discards decoded pixels if the source changes during processing", async () => {
    const { heic } = await fixture();
    const file = await indexed();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = processing.runMediaCommand;
    vi.spyOn(processing, "runMediaCommand").mockImplementation(
      async (command, args, timeout) => {
        if (command === "heif-convert") {
          enter();
          await blocked;
        }
        return original(command, args, timeout);
      }
    );
    const job = ensureImageDisplay({ db, config, file });
    await entered;
    await utimes(heic, new Date(), new Date(file.mtimeMs + 2000));
    release();
    await expect(job).rejects.toMatchObject({ code: "stale_image_source" });
    expect(
      await readdir(path.join(config.cacheDir, "display-images", file.asset.id))
    ).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM derivatives").get()).toEqual({
      n: 0
    });
  });

  it("invalidates cached images after an inode replacement preserving source size and mtime", async () => {
    const { heic } = await fixture();
    const file = await indexed();
    const display = await ensureImageDisplay({ db, config, file });
    const replacement = path.join(config.cacheDir, "replacement.heic");
    await writeFile(replacement, await readFile(heic));
    await utimes(replacement, new Date(file.mtimeMs), new Date(file.mtimeMs));
    await rename(replacement, heic);
    const current = (await resolveAssetFile(db, file.asset.id))!;
    expect(current).toMatchObject({
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs
    });
    expect(current.inode).not.toBe(file.inode);
    const next = await ensureImageDisplay({ db, config, file: current });
    expect(next.path).not.toBe(display.path);
    await expect(readFile(display.path)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("scopes HDR checks to primary properties and bounds decoded image metadata", async () => {
    const { heic } = await fixture();
    const info = await runMediaCommand("heif-info", [heic], 10_000);
    const dump = await runMediaCommand("heif-info", ["-d", heic], 10_000);
    const auxiliaryHdr = dump.stdout.replace(
      /(Box: ipma)/,
      "index: 100\n| | | Box: colr\n| | | colour_primaries: 9\n| | | transfer_characteristics: 16\n| | $1"
    );
    expect(parseHeifInfo(info.stdout, auxiliaryHdr)).toMatchObject({
      bitDepth: 8
    });
    const largeInfo = info.stdout.replace("64x48", "8064x6048");
    const largeDump = dump.stdout
      .replaceAll("image width: 64", "image width: 8064")
      .replaceAll("image height: 64", "image height: 6048");
    expect(parseHeifInfo(largeInfo, largeDump)).toMatchObject({
      width: 8064,
      height: 6048,
      bitDepth: 8
    });
    expect(
      parseHeifInfo(
        largeInfo,
        largeDump
          .replaceAll("bits_per_channel: 8", "bits_per_channel: 10")
          .replaceAll(",8", ",10")
          .replaceAll("bit_depth_luma: 8", "bit_depth_luma: 10")
          .replaceAll("bit_depth_chroma: 8", "bit_depth_chroma: 10")
      )
    ).toMatchObject({ width: 8064, height: 6048, bitDepth: 10 });
    expect(() =>
      parseHeifInfo(info.stdout.replace("64x48", "100000x100000"), dump.stdout)
    ).toThrow("heic_limit_exceeded");
    expect(() =>
      parseHeifInfo(
        info.stdout,
        dump.stdout.replace(
          "bits_per_channel: 8,8,8",
          "bits_per_channel: 12,12,12"
        )
      )
    ).toThrow("heic_source_not_supported");
  });

  it("rejects symlink cache directories and final files without reading or overwriting targets", async () => {
    await fixture();
    const file = await indexed();
    const target = path.join(config.cacheDir, "outside");
    await mkdir(target);
    await mkdir(path.join(config.cacheDir, "thumbnails"));
    await symlink(
      target,
      path.join(config.cacheDir, "thumbnails", file.asset.id)
    );
    await expect(
      ensureImageThumbnail({ db, config, file, size: 32 })
    ).rejects.toMatchObject({ code: "unsafe_cache" });
    const displayDir = path.join(
      config.cacheDir,
      "display-images",
      file.asset.id
    );
    await mkdir(displayDir, { recursive: true });
    const privateFile = path.join(target, "private.txt");
    await writeFile(privateFile, "private");
    const destination = path.join(displayDir, `${imageSourceKey(file)}.png`);
    await symlink(privateFile, destination);
    await expect(
      ensureImageDisplay({ db, config, file })
    ).rejects.toBeDefined();
    await expect(openImageCacheFile(destination)).rejects.toBeDefined();
    expect(await readFile(privateFile, "utf8")).toBe("private");
  });
});
