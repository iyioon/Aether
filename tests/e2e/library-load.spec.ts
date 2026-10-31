import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "library-load-fixture";
const directory = path.resolve(".e2e/media", folderName);
const staging = path.resolve(".e2e/aether-data/cache/e2e-fixtures/load");
const count = 1_024;
const command = promisify(execFile);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let assets: AssetRecord[];
let sourceHashes: Map<string, string>;
let scanMs: number;
let sourceBytes: number;

// DOM/network tracing retains resources and would distort memory observations.
test.use({ trace: "off" });

test.describe("representative library", () => {
  // Explicitly opt in: this exercises real decoders and a much larger source set.
  test.skip(
    process.env.AETHER_E2E_LOAD_TESTS !== "1",
    "Set AETHER_E2E_LOAD_TESTS=1 to run the mixed-library resource checks."
  );
  test.setTimeout(300_000);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      await page
        .getByLabel("Password", { exact: true })
        .fill("aether-e2e-password");
      await page.getByRole("button", { name: "Enter", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      storageState = await page.context().storageState();
      await createLibrary();
      const start = performance.now();
      await scan(page);
      scanMs = performance.now() - start;
      const tree = (await (
        await page.request.get(`${origin}/api/tree`)
      ).json()) as TreeResponse;
      folderId = tree.folders.find(
        (folder) => folder.relativePath === folderName
      )!.id;
      assets = [];
      for (let offset = 0; offset < count; offset += 250) {
        const response = await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=250&offset=${offset}`
        );
        expect(response.ok()).toBe(true);
        assets.push(...((await response.json()) as AssetListResponse).items);
      }
      expect(assets).toHaveLength(count);
      // Settings are saved here; actual preparation remains demand-driven.
      for (const asset of assets
        .filter((asset) => asset.mediaType === "video")
        .slice(0, 4)) {
        const response = await page.request.put(
          `${origin}/api/assets/${asset.id}/presentation`,
          {
            headers: await csrf(page),
            data: {
              expectedRevision: asset.presentation?.revision ?? 0,
              highlight: { startMs: 500, endMs: 1_500 },
              aspectFraming: {},
              feedFraming: {},
              fit: "auto",
              focalX: 0.5,
              focalY: 0.5,
              zoom: 1,
              playbackRate: 1,
              loopMode: "bounce"
            }
          }
        );
        expect(response.ok()).toBe(true);
      }
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    try {
      if (sourceHashes) {
        for (const [name, hash] of sourceHashes) {
          expect(await hashFile(path.join(directory, name))).toBe(hash);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(staging, { recursive: true, force: true });
      if (storageState) {
        const context = await browser.newContext({ storageState });
        try {
          await scan(await context.newPage());
        } finally {
          await context.close();
        }
      }
    }
  });

  for (const phone of [false, true]) {
    test(`bounds media and retained resources while traversing ${count} items on ${phone ? "phone" : "desktop"}`, async ({
      browser
    }, testInfo) => {
      const context = await browser.newContext({
        storageState,
        viewport: phone
          ? { width: 393, height: 852 }
          : { width: 1440, height: 980 },
        isMobile: phone,
        hasTouch: phone,
        reducedMotion: "reduce"
      });
      try {
        context.setDefaultTimeout(15_000);
        await context.addInitScript(() => {
          // Exercise the lossless codec available in this desktop test browser.
          const original = HTMLMediaElement.prototype.canPlayType;
          HTMLMediaElement.prototype.canPlayType = function (type) {
            return type.includes("hvc1") ? "" : original.call(this, type);
          };
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        const browserCdp = await browser.newBrowserCDPSession();
        await cdp.send("Network.enable");
        const transfers = new Set<string>();
        let mediaBytes = 0;
        let maximumTransfers = 0;
        cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
          if (!new URL(request.url).pathname.startsWith("/api/assets/")) return;
          transfers.add(requestId);
          maximumTransfers = Math.max(maximumTransfers, transfers.size);
        });
        cdp.on("Network.dataReceived", ({ requestId, dataLength }) => {
          if (transfers.has(requestId)) mediaBytes += dataLength;
        });
        cdp.on("Network.loadingFinished", ({ requestId }) =>
          transfers.delete(requestId)
        );
        cdp.on("Network.loadingFailed", ({ requestId }) =>
          transfers.delete(requestId)
        );
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let loaded = 0;
        page.on("response", async (response) => {
          const url = new URL(response.url());
          if (
            url.pathname !== `/api/folders/${folderId}/assets` ||
            !response.ok()
          )
            return;
          const result = (await response
            .json()
            .catch(() => null)) as AssetListResponse | null;
          if (result)
            loaded = Math.max(
              loaded,
              Number(url.searchParams.get("offset") ?? 0) + result.items.length
            );
        });
        const samples: Array<Record<string, number | string>> = [];
        const measure = async (phase: string) => {
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve())
                )
              )
          );
          await cdp.send("HeapProfiler.collectGarbage");
          await cdp.send("HeapProfiler.collectGarbage");
          const heap = await cdp.send("Runtime.getHeapUsage");
          const dom = await cdp.send("Memory.getDOMCounters");
          const { processInfo } = await browserCdp.send(
            "SystemInfo.getProcessInfo"
          );
          const resident = await Promise.all(
            processInfo.map(async ({ id }) => {
              if (process.platform !== "linux") return 0;
              const status = await readFile(`/proc/${id}/status`, "utf8").catch(
                () => ""
              );
              return Number(/^VmRSS:\s+(\d+)\s+kB/m.exec(status)?.[1] ?? 0);
            })
          );
          const media = await page.evaluate(() => ({
            connectedNodes: document.querySelectorAll("*").length,
            tiles: document.querySelectorAll(".media-tile").length,
            feedMedia: document.querySelectorAll(".feed-frame").length,
            nativeSources: [...document.querySelectorAll("video")].filter(
              (video) => video.hasAttribute("src")
            ).length,
            originalImages: document.querySelectorAll(
              '.feed-item img[data-preview-source="original"]'
            ).length,
            canvases: [...document.querySelectorAll("canvas")].filter(
              (canvas) => canvas.width > 0 && canvas.height > 0
            ).length
          }));
          const sample = {
            phase,
            loaded,
            heapMiB: Math.round((heap.usedSize / 1_048_576) * 10) / 10,
            nodes: dom.nodes,
            listeners: dom.jsEventListeners,
            ...(process.platform === "linux"
              ? {
                  browserRssMiB: Math.round(
                    resident.reduce((sum, value) => sum + value, 0) / 1024
                  )
                }
              : {}),
            mediaMiB: Math.round(mediaBytes / 1_048_576),
            maximumTransfers,
            ...media
          };
          samples.push(sample);
          return sample;
        };
        await page.goto(
          `${origin}/?folder=${folderId}&view=gallery&sort=filename&size=small&aspect=Square&highlight=1`
        );
        const gallery = page.locator(".gallery-viewport");
        await expect(gallery).toHaveAttribute("aria-busy", "false");
        await expect.poll(() => loaded).toBeGreaterThanOrEqual(80);
        await measure("gallery-80");
        for (let pass = 0; pass < 3; pass++) {
          if (pass === 0) {
            while (loaded < count) {
              const previous = loaded;
              await gallery.evaluate((node) => {
                node.scrollTop = node.scrollHeight;
              });
              await expect
                .poll(() => loaded, { timeout: 20_000 })
                .toBeGreaterThan(previous);
              expect(await page.locator(".media-tile").count()).toBeLessThan(
                160
              );
            }
          }
          for (const position of [0, 0.25, 0.5, 0.75, 1]) {
            await gallery.evaluate((node, fraction) => {
              node.scrollTop =
                (node.scrollHeight - node.clientHeight) * fraction;
            }, position);
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                  )
                )
            );
            expect(await page.locator(".media-tile").count()).toBeLessThan(160);
          }
          await measure(`gallery-pass-${pass + 1}`);
        }
        await expect.poll(() => transfers.size, { timeout: 30_000 }).toBe(0);
        await measure("gallery-settled");
        // Switch in-place so all loaded records transfer through the real view flow.
        const feedButton = page.getByRole("button", {
          name: "Feed view",
          exact: true
        });
        if (await feedButton.isVisible()) await feedButton.click();
        else {
          await page
            .getByRole("button", {
              name: "Change view, Gallery selected",
              exact: true
            })
            .click();
          await page
            .getByRole("menuitemradio", { name: "Feed", exact: true })
            .click();
        }
        const feed = page.getByRole("region", { name: "Feed view" });
        await expect(feed).toHaveAttribute("aria-busy", "false");
        await expect(page.locator(".feed-item")).toHaveCount(count);
        for (const index of [0, 12, 13, 14, 15, 16, 256, 512, 1_023, 12, 0]) {
          const start = performance.now();
          await page.locator(".feed-view").evaluate((node, target) => {
            node.scrollTop = target * node.clientHeight;
          }, index);
          await expect(
            page.locator(`.feed-item[data-feed-index="${index}"] .feed-frame`)
          ).toBeVisible();
          await expect
            .poll(() => page.locator(".feed-frame").count())
            .toBeLessThanOrEqual(7);
          await expect
            .poll(() => page.locator(".feed-item video[src]").count())
            .toBeLessThanOrEqual(1);
          await expect(
            page.locator('.feed-item img[data-preview-source="original"]')
          ).toHaveCount(index % 16 < 12 || index % 16 === 15 ? 1 : 0);
          const frame = page.locator(
            `.feed-item[data-feed-index="${index}"] .feed-frame`
          );
          const activeVideo = frame.locator("video");
          if (await activeVideo.count()) {
            await expect
              .poll(
                () =>
                  activeVideo.evaluate(
                    (video: HTMLVideoElement) =>
                      video.readyState >= 2 &&
                      video.currentTime > 0 &&
                      !video.paused
                  ),
                { timeout: 60_000 }
              )
              .toBe(true);
            await activeVideo.evaluate(
              (video: HTMLVideoElement) =>
                new Promise<void>((resolve) =>
                  video.requestVideoFrameCallback(() => resolve())
                )
            );
          } else {
            await expect(frame.locator(".media-image-shell")).toHaveClass(
              /\b(?:ready|animation-ready)\b/,
              { timeout: 30_000 }
            );
          }
          samples.push({
            phase: `feed-ready-${index}`,
            readyMs: Math.round(performance.now() - start)
          });
        }
        const visible = await measure("feed-traversed");
        expect(visible.nativeSources).toBeLessThanOrEqual(1);
        expect(visible.feedMedia).toBeLessThanOrEqual(7);
        const settled = samples.filter((sample) =>
          String(sample.phase).startsWith("gallery-pass-")
        );
        expect(
          Number(settled[2]!.heapMiB) - Number(settled[1]!.heapMiB)
        ).toBeLessThan(16);
        expect(Number(settled[2]!.connectedNodes)).toBeLessThan(6_000);
        expect(maximumTransfers).toBeLessThan(256);
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true
          });
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden"
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect
          .poll(() =>
            page
              .locator("video")
              .evaluateAll((videos) => videos.every((video) => video.paused))
          )
          .toBe(true);
        await expect
          .poll(() =>
            page
              .locator("canvas")
              .evaluateAll((canvases) =>
                canvases.every((canvas) => canvas.width === 0)
              )
          )
          .toBe(true);
        await measure("hidden");
        expect(errors).toEqual([]);
        const report = {
          viewport: phone ? "phone" : "desktop",
          count,
          scanMs: Math.round(scanMs),
          sourceMiB: Math.round(sourceBytes / 1_048_576),
          samples
        };
        await testInfo.attach("library-resources", {
          body: JSON.stringify(report, null, 2),
          contentType: "application/json"
        });
        console.log(JSON.stringify(report));
      } finally {
        await context.close();
      }
    });
  }
});

async function createLibrary() {
  await mkdir(directory, { recursive: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await command("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=24:duration=4",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    path.join(staging, "video.mp4")
  ]);
  await command("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-i",
    path.join(staging, "video.mp4"),
    "-frames:v",
    "1",
    "-y",
    path.join(staging, "frame.png")
  ]);
  await sharp(path.join(staging, "frame.png"))
    .resize(4000, 3000, { fit: "fill" })
    .jpeg({ quality: 90 })
    .toFile(path.join(staging, "photo.jpg"));
  await sharp(path.join(staging, "frame.png"))
    .resize(1280, 960, { fit: "fill" })
    .png()
    .toFile(path.join(staging, "heic.png"));
  await command(
    "heif-enc",
    [
      "-L",
      "-p",
      "x265:pools=none",
      "-p",
      "x265:frame-threads=1",
      "-o",
      path.join(staging, "photo.heic"),
      path.join(staging, "heic.png")
    ],
    { maxBuffer: 1_048_576 }
  );
  await sharp(
    Buffer.concat(
      [32, 96, 160, 224].map((shade) => Buffer.alloc(480 * 640 * 3, shade))
    ),
    {
      raw: { width: 480, height: 640 * 4, channels: 3, pageHeight: 640 },
      animated: true
    }
  )
    .webp({ loop: 0, delay: [100, 200, 300, 400], lossless: true, effort: 0 })
    .toFile(path.join(staging, "sequence.webp"));
  sourceHashes = new Map();
  sourceBytes = 0;
  for (let index = 0; index < count; index++) {
    const slot = index % 16;
    const source =
      slot < 12
        ? "photo.jpg"
        : slot < 14
          ? "video.mp4"
          : slot === 14
            ? "sequence.webp"
            : "photo.heic";
    const name = `${String(index).padStart(4, "0")}${path.extname(source)}`;
    await copyFile(path.join(staging, source), path.join(directory, name));
    sourceBytes += (await stat(path.join(directory, name))).size;
    sourceHashes.set(name, await hashFile(path.join(directory, name)));
  }
}

async function hashFile(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}
async function scan(page: Page) {
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: await csrf(page)
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const result = await page.request.get(`${origin}/api/admin/jobs`);
        const { jobs } = (await result.json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 90_000 }
    )
    .toBe("completed");
}
