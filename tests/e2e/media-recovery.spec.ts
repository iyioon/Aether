import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
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
const folderName = "media-recovery-fixture";
const directory = path.resolve(".e2e/media", folderName);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let assets: AssetRecord[];

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
    await mkdir(directory, { recursive: true });
    for (const [index, color] of ["red", "blue"].entries()) {
      await sharp({
        create: { width: 96, height: 64, channels: 3, background: color }
      })
        .jpeg()
        .toFile(path.join(directory, `photo-${index}.jpg`));
      await promisify(execFile)("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:size=96x64:rate=12`,
        "-t",
        "2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        path.join(directory, `video-${index}.mp4`)
      ]);
    }
    const frameBytes = 96 * 64 * 4;
    await sharp(
      Buffer.concat(
        [255, 170, 85, 0].map((red) => {
          const frame = Buffer.alloc(frameBytes);
          for (let offset = 0; offset < frame.length; offset += 4) {
            frame[offset] = red;
            frame[offset + 1] = 80;
            frame[offset + 2] = 160;
            frame[offset + 3] = 255;
          }
          return frame;
        })
      ),
      {
        raw: { width: 96, height: 64 * 4, channels: 4, pageHeight: 64 },
        animated: true
      }
    )
      .webp({ lossless: true, effort: 0, loop: 0, delay: [80, 160, 80, 160] })
      .toFile(path.join(directory, "animation.webp"));
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === folderName
    )!.id;
    const response = await page.request.get(
      `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
    );
    assets = ((await response.json()) as AssetListResponse).items;
    expect(assets).toHaveLength(5);
    storageState = await page.context().storageState();
  } finally {
    await page.close();
  }
});

test.afterAll(async ({ browser }) => {
  await rm(directory, { recursive: true, force: true });
  if (!storageState) return;
  const context = await browser.newContext({ storageState });
  try {
    await scan(await context.newPage());
  } finally {
    await context.close();
  }
});

for (const phone of [false, true]) {
  test(`diagnoses viewer Bounce overload before changing codec (${phone ? "phone" : "desktop"})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    let releaseHead: () => void = () => undefined;
    try {
      await context.addInitScript(() => {
        const original = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (type) {
          return type.includes("hvc1") ? "probably" : original.call(this, type);
        };
      });
      const page = await context.newPage();
      const asset = assets.find((asset) => asset.name === "video-0.mp4")!;
      const currentResponse = await page.request.get(
        `${origin}/api/assets/${asset.id}`
      );
      expect(currentResponse.ok()).toBe(true);
      const current = (await currentResponse.json()) as AssetRecord;
      const token = (await context.cookies()).find(
        (cookie) => cookie.name === "aether_csrf"
      )!.value;
      const saved = await page.request.put(
        `${origin}/api/assets/${asset.id}/presentation`,
        {
          headers: { "x-csrf-token": token },
          data: {
            expectedRevision: current.presentation.revision,
            highlight: { startMs: 500, endMs: 1500 },
            fit: "cover",
            focalX: 0.5,
            focalY: 0.5,
            zoom: 1,
            playbackRate: 1,
            loopMode: "bounce"
          }
        }
      );
      expect(saved.ok()).toBe(true);
      let mode: "busy" | "limit" | "browser" = "busy";
      let holdHead = false;
      let headStarted = false;
      const heldHead = new Promise<void>((resolve) => {
        releaseHead = resolve;
      });
      const requestedCodecs = new Set<string>();
      await page.route(
        `**/api/assets/${asset.id}/playback?*`,
        async (route) => {
          const request = route.request();
          const codec = new URL(request.url()).searchParams.get("codec")!;
          if (request.method() === "GET") requestedCodecs.add(codec);
          if (mode === "browser" && codec === "h264") {
            await route.continue();
            return;
          }
          if (holdHead && request.method() === "HEAD") {
            headStarted = true;
            await heldHead;
          }
          const code =
            mode === "busy" ? "processing_busy" : "presentation_limit_exceeded";
          await route
            .fulfill({
              status: mode === "browser" ? 200 : mode === "busy" ? 503 : 422,
              headers:
                mode === "browser"
                  ? { "content-type": "video/mp4" }
                  : {
                      "content-type": "application/json",
                      "x-aether-media-error": code
                    },
              body:
                mode === "browser"
                  ? "unsupported HEVC video"
                  : JSON.stringify({ error: code })
            })
            .catch(() => undefined);
        }
      );
      await page.goto(
        `${url("gallery", "video", asset.name)}&highlight=1&asset=${asset.id}`
      );
      const viewer = page.getByRole("dialog", {
        name: asset.name,
        exact: true
      });
      const notice = viewer.locator(".media-error-notice");
      await expect(notice).toContainText("Media preparation is busy.");
      expect([...requestedCodecs]).toEqual(["hevc"]);
      const retry = notice.getByRole("button", { name: "Retry", exact: true });
      mode = "limit";
      if (phone) await retry.tap();
      else await retry.click();
      await expect(notice).toContainText(
        "Playback exceeds a processing limit."
      );
      expect([...requestedCodecs]).toEqual(["hevc"]);
      await expect(retry).toHaveCount(0);
      await viewer
        .getByRole("button", { name: "Close viewer", exact: true })
        .click();
      await expect(viewer).toHaveCount(0);
      mode = "browser";
      const open = page.getByRole("button", {
        name: `Open ${asset.name}`,
        exact: true
      });
      holdHead = true;
      if (phone) await open.tap();
      else await open.click();
      await expect.poll(() => headStarted).toBe(true);
      await viewer
        .getByRole("button", { name: "Close viewer", exact: true })
        .click();
      releaseHead();
      await expect(viewer).toHaveCount(0);
      expect([...requestedCodecs]).toEqual(["hevc"]);
      holdHead = false;
      if (phone) await open.tap();
      else await open.click();
      await expect(viewer.locator("video")).toHaveAttribute(
        "src",
        /[?&]codec=h264(?:&|$)/
      );
      await expect
        .poll(() =>
          viewer
            .locator("video")
            .evaluate(
              (video: HTMLVideoElement) =>
                video.readyState >= 2 && video.currentTime > 0 && !video.paused
            )
        )
        .toBe(true);
      await expect(notice).toHaveCount(0);
    } finally {
      releaseHead();
      await context.close();
    }
  });

  test(`recovers Gallery animation manifest and atlas failures outside the activation button (${phone ? "phone" : "desktop"})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      const animation = assets.find(
        (asset) => asset.name === "animation.webp"
      )!;
      let blocked = true;
      let failureStage = "manifest";
      await page.route(
        new RegExp(
          `/api/assets/${animation.id}/animation(?:/atlases/\\d+)?\\?`
        ),
        async (route) => {
          const atlas = new URL(route.request().url()).pathname.includes(
            "/atlases/"
          );
          if (blocked && atlas === (failureStage === "atlas"))
            await route.fulfill({
              status: 503,
              json: { error: "processing_busy" }
            });
          else await route.continue();
        }
      );
      for (const stage of ["manifest", "atlas"]) {
        blocked = true;
        failureStage = stage;
        await page.goto(url("gallery", "image", animation.name));
        const frame = page.locator(".media-preview-frame");
        const retry = frame.getByRole("button", { name: "Retry", exact: true });
        await expect(retry).toBeVisible();
        await expect(retry.locator("xpath=ancestor::button")).toHaveCount(0);
        await expect
          .poll(async () => (await retry.boundingBox())!.height)
          .toBeGreaterThanOrEqual(44);
        const height = (await frame.boundingBox())!.height;
        await page
          .getByRole("button", { name: "Select media", exact: true })
          .click();
        await expect(frame).toHaveAttribute("inert", "");
        expect(
          await retry.evaluate((button: HTMLButtonElement) => {
            button.focus();
            return document.activeElement === button;
          })
        ).toBe(false);
        await page
          .getByRole("button", { name: "Exit selection mode", exact: true })
          .click();
        blocked = false;
        if (phone) await retry.tap();
        else {
          await retry.focus();
          await page.keyboard.press("Enter");
        }
        await expect(frame.locator("canvas")).toHaveCSS("opacity", "1");
        await expect(frame.locator("canvas")).toHaveJSProperty("width", 96);
        await expect(retry).toHaveCount(0);
        expect((await frame.boundingBox())!.height).toBe(height);
        await expect(page.locator(".viewer-dialog")).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });

  test(`recovers Gallery thumbnails and busy video previews explicitly (${phone ? "phone" : "desktop"})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      const photo = assets.find((asset) => asset.name === "photo-0.jpg")!;
      const video = assets.find((asset) => asset.name === "video-0.mp4")!;
      let blocked = true;
      const thumbnailRequests: string[] = [];
      const previewRequests: string[] = [];
      const nativeRequests: string[] = [];
      await page.route(
        /\/api\/assets\/[^/]+\/(?:thumbnail|preview)(?:\?|$)/,
        async (route) => {
          const request = route.request();
          if (request.method() === "GET") {
            const requests = new URL(request.url()).pathname.endsWith(
              "/preview"
            )
              ? previewRequests
              : thumbnailRequests;
            requests.push(request.url());
          }
          if (blocked)
            await route.fulfill({
              status: 503,
              headers: {
                "x-aether-media-error": "processing_busy",
                "retry-after": "1"
              },
              json: { error: "processing_busy" }
            });
          else await route.continue();
        }
      );
      page.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname === `/api/assets/${video.id}/media`
        )
          nativeRequests.push(request.url());
      });
      await page.goto(url("gallery", "image", photo.name));
      let card = page.locator(".media-tile").filter({
        has: page.getByRole("button", {
          name: `Open ${photo.name}`,
          exact: true
        })
      });
      let retry = card.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await expect
        .poll(async () => (await retry.boundingBox())!.height)
        .toBeGreaterThanOrEqual(44);
      await expect(retry.locator("xpath=ancestor::button")).toHaveCount(0);
      const photoBounds = await card.boundingBox();
      const source = thumbnailRequests[0];
      await page
        .getByRole("button", { name: "Select media", exact: true })
        .click();
      await expect(page.locator(".media-preview-frame")).toHaveAttribute(
        "inert",
        ""
      );
      expect(
        await retry.evaluate((button: HTMLButtonElement) => {
          button.focus();
          return document.activeElement === button;
        })
      ).toBe(false);
      const select = page.getByRole("button", {
        name: `Select ${photo.name}`,
        exact: true
      });
      await select.click();
      await expect(
        page.getByRole("button", {
          name: `Deselect ${photo.name}`,
          exact: true
        })
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "Exit selection mode", exact: true })
        .click();
      await expect(retry).toBeVisible();
      blocked = false;
      if (phone) await retry.tap();
      else {
        await retry.focus();
        await page.keyboard.press("Enter");
      }
      await expect(card.locator("img")).toHaveJSProperty("naturalWidth", 96);
      await expect(retry).toHaveCount(0);
      expect(thumbnailRequests.at(-1)).toBe(source);
      expect((await card.boundingBox())!.height).toBe(photoBounds!.height);
      await expect(page.locator(".viewer-dialog")).toHaveCount(0);

      blocked = true;
      await page.goto(url("gallery", "video", video.name));
      card = page.locator(".media-tile").filter({
        has: page.getByRole("button", {
          name: `Open ${video.name}`,
          exact: true
        })
      });
      await expect(card.getByRole("status")).toHaveText(
        "Media preparation is busy.Retry"
      );
      retry = card.getByRole("button", { name: "Retry", exact: true });
      const videoBounds = await card.boundingBox();
      expect(nativeRequests).toHaveLength(0);
      expect(previewRequests.length).toBeGreaterThan(0);
      const previewSource = previewRequests.at(-1);
      blocked = false;
      if (phone) await retry.tap();
      else await retry.click();
      await expect(card.locator(".media-video-shell")).toHaveClass(/\bready\b/);
      await expect(retry).toHaveCount(0);
      expect(previewRequests.at(-1)).toBe(previewSource);
      expect(nativeRequests).toHaveLength(0);
      expect((await card.boundingBox())!.height).toBe(videoBounds!.height);
      await expect(page.locator(".viewer-dialog")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test(`recovers Comparison thumbnails and exhausted native playback without choosing a pair (${phone ? "phone" : "desktop"})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      let blocked = true;
      await page.route(
        /\/api\/assets\/[^/]+\/thumbnail(?:\?|$)/,
        async (route) => {
          if (blocked)
            await route.fulfill({
              status: 503,
              json: { error: "processing_busy" }
            });
          else await route.continue();
        }
      );
      await page.goto(url("compare", "image", "photo-"));
      const cards = page.locator(".comparison-card[data-asset-id]");
      await expect(cards).toHaveCount(2);
      const imagePair = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-asset-id"))
      );
      await expect(
        cards.getByRole("button", { name: "Retry", exact: true })
      ).toHaveCount(2);
      blocked = false;
      for (let index = 0; index < 2; index++) {
        const retry = cards
          .nth(index)
          .getByRole("button", { name: "Retry", exact: true });
        await expect
          .poll(async () => (await retry.boundingBox())!.height)
          .toBeGreaterThanOrEqual(44);
        if (phone) await retry.tap();
        else await retry.click();
        await expect(cards.nth(index).locator("img")).toHaveJSProperty(
          "naturalWidth",
          96
        );
      }
      expect(
        await cards.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-asset-id"))
        )
      ).toEqual(imagePair);
      await expect(page.locator(".viewer-dialog")).toHaveCount(0);

      blocked = true;
      await page.route(/\/api\/assets\/[^/]+\/media(?:\?|$)/, async (route) => {
        if (blocked)
          await route.fulfill({
            status: 200,
            contentType: "video/mp4",
            body: route.request().method() === "HEAD" ? "" : "unplayable"
          });
        else await route.continue();
      });
      await page.route(
        /\/api\/assets\/[^/]+\/preview(?:\?|$)/,
        async (route) => {
          if (blocked)
            await route.fulfill({
              status: 503,
              headers: { "x-aether-media-error": "processing_busy" },
              json: { error: "processing_busy" }
            });
          else await route.continue();
        }
      );
      await page.goto(url("compare", "video"));
      await expect(cards).toHaveCount(2);
      const videoPair = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-asset-id"))
      );
      await expect(cards.getByRole("status")).toHaveText([
        "Media preparation is busy.Retry",
        "Media preparation is busy.Retry"
      ]);
      blocked = false;
      for (let index = 0; index < 2; index++) {
        const retry = cards
          .nth(index)
          .getByRole("button", { name: "Retry", exact: true });
        if (phone) await retry.tap();
        else await retry.click();
        await expect(
          cards.nth(index).locator(".media-video-shell")
        ).toHaveClass(/\bready\b/);
      }
      expect(
        await cards.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-asset-id"))
        )
      ).toEqual(videoPair);
      await expect(
        cards.getByRole("button", { name: "Retry", exact: true })
      ).toHaveCount(0);
      await expect(page.locator(".viewer-dialog")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test(`releases removed native image, poster and video requests without interrupting active media (${phone ? "phone" : "desktop"})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const page = await context.newPage();
      const photo = assets.find((asset) => asset.name === "photo-0.jpg")!;
      const removedVideo = assets.find(
        (asset) => asset.name === "video-0.mp4"
      )!;
      const retainedVideo = assets.find(
        (asset) => asset.name === "video-1.mp4"
      )!;
      const failed = new Set<string>();
      const requested = new Set<string>();
      page.on("request", (request) => requested.add(request.url()));
      page.on("requestfailed", (request) => failed.add(request.url()));
      await page.route(
        /\/api\/assets\/[^/]+\/(?:thumbnail|preview)(?:\?|$)/,
        async (route) => {
          const assetId = new URL(route.request().url()).pathname.split("/")[3];
          if (assetId === photo.id || assetId === removedVideo.id) {
            await gate;
            // A removed native element cancels the intercepted request.
            await route.continue().catch(() => undefined);
          } else await route.continue();
        }
      );
      await page.goto(url("gallery", "all", photo.name), {
        waitUntil: "domcontentloaded"
      });
      const search = page.getByRole("searchbox", {
        name: "Search",
        exact: true
      });
      const oldImage = (await page.locator(".media-tile img").elementHandle())!;
      const imageSource = (await oldImage.getAttribute("src"))!;
      await expect
        .poll(() =>
          [...requested].some(
            (url) => new URL(url).pathname + new URL(url).search === imageSource
          )
        )
        .toBe(true);
      await search.fill(removedVideo.name);
      const videoCard = page.locator(".media-tile").filter({
        has: page.getByRole("button", {
          name: `Open ${removedVideo.name}`,
          exact: true
        })
      });
      await expect(videoCard.locator("video")).toHaveAttribute(
        "src",
        /\/preview\?/
      );
      const oldVideo = (await videoCard.locator("video").elementHandle())!;
      const oldPoster = (await videoCard
        .locator(".media-video-poster")
        .elementHandle())!;
      const videoSource = (await oldVideo.getAttribute("src"))!;
      const posterSource = (await oldPoster.getAttribute("src"))!;
      for (const source of [videoSource, posterSource])
        await expect
          .poll(() =>
            [...requested].some(
              (url) => new URL(url).pathname + new URL(url).search === source
            )
          )
          .toBe(true);
      await expect.poll(() => oldImage.getAttribute("src")).toBeNull();
      await search.fill(retainedVideo.name);
      const activeVideo = page.locator(".media-tile video");
      await expect(
        page.locator(".media-tile").getByRole("button", {
          name: `Open ${retainedVideo.name}`,
          exact: true
        })
      ).toBeVisible();
      await expect.poll(() => oldVideo.getAttribute("src")).toBeNull();
      await expect.poll(() => oldPoster.getAttribute("src")).toBeNull();
      for (const source of [imageSource, videoSource, posterSource])
        await expect
          .poll(() =>
            [...failed].some(
              (url) => new URL(url).pathname + new URL(url).search === source
            )
          )
          .toBe(true);
      await expect(page.locator(".media-video-shell")).toHaveClass(/\bready\b/);
      const currentNode = (await activeVideo.elementHandle())!;
      const currentSource = await currentNode.getAttribute("src");
      const options = page.getByRole("button", { name: /^View options/ });
      if (phone) await options.tap();
      else await options.click();
      const panel = page.getByRole("dialog", {
        name: "View options",
        exact: true
      });
      await panel.getByRole("tab", { name: "Layout", exact: true }).click();
      await panel
        .getByRole("combobox", { name: "Media layout", exact: true })
        .click();
      await page.getByRole("option", { name: "Portrait", exact: true }).click();
      await page.keyboard.press("Escape");
      expect(await currentNode.evaluate((node) => node.isConnected)).toBe(true);
      expect(await currentNode.getAttribute("src")).toBe(currentSource);
      await expect(activeVideo).toHaveJSProperty("paused", false);
      await oldImage.dispose();
      await oldVideo.dispose();
      await oldPoster.dispose();
      await currentNode.dispose();
    } finally {
      release();
      await context.close();
    }
  });
}

function url(view: string, type: string, search = "") {
  return `${origin}/?folder=${encodeURIComponent(folderId)}&view=${view}&type=${type}&sort=filename&q=${encodeURIComponent(search)}${view === "compare" ? "&workspace=ranking" : ""}`;
}

async function scan(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(token).toBeTruthy();
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: { "x-csrf-token": token! }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${origin}/api/admin/jobs`);
        const { jobs } = (await response.json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("completed");
}
