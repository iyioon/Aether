import sharp from "sharp";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const frameSide = 512;
const atlasSide = 2048;
const framesPerAtlas = 12;
const atlasCount = 4;
const frameDurationMs = 40;
const compareFolder = "animation-continuity-fixture";
const compareDirectory = path.resolve(".e2e", "media", compareFolder);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let compareFolderId: string;
let comparisonAssets: AssetRecord[];
let asset: AssetRecord;
let atlasImages: Buffer[];

interface DrawSample {
  time: number;
  frame: number;
  source: string;
}
interface ContinuityWindow extends Window {
  animationContinuity: {
    selector: string;
    samples: DrawSample[];
  };
}

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
    await mkdir(compareDirectory, { recursive: true });
    const animatedSource = path.resolve(
      ".e2e",
      "media",
      "animated-memory.webp"
    );
    await Promise.all([
      sharp(animatedSource, { animated: true })
        .gif()
        .toFile(path.join(compareDirectory, "animation-0.gif")),
      copyFile(animatedSource, path.join(compareDirectory, "animation-1.webp"))
    ]);
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.roots[0]!.folderId;
    compareFolderId = tree.folders.find(
      (folder) => folder.relativePath === compareFolder
    )!.id;
    comparisonAssets = (
      (await (
        await page.request.get(
          `${origin}/api/folders/${compareFolderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse
    ).items;
    expect(comparisonAssets).toHaveLength(2);
    asset = comparisonAssets.find((item) => item.name === "animation-0.gif")!;
    expect(asset).toBeDefined();
    storageState = await page.context().storageState();
    atlasImages = await Promise.all(
      Array.from({ length: atlasCount }, (_, atlas) => createAtlas(atlas))
    );
  } finally {
    await page.close();
  }
});

test.afterAll(async ({ browser }) => {
  await rm(compareDirectory, { recursive: true, force: true });
  if (!storageState) return;
  const context = await browser.newContext({ storageState });
  try {
    await scan(await context.newPage());
  } finally {
    await context.close();
  }
});

for (const surface of ["gallery", "feed", "viewer"] as const) {
  test(`keeps animation motion continuous across delayed atlases in ${surface}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      ...(surface === "feed"
        ? {
            viewport: { width: 393, height: 852 },
            isMobile: true,
            hasTouch: true
          }
        : {})
    });
    try {
      await observeDraws(context);
      const page = await context.newPage();
      await mockAnimation(page);
      const selector =
        surface === "viewer"
          ? ".viewer-dialog .controlled-animation__canvas"
          : surface === "feed"
            ? ".feed-item .controlled-animation__canvas"
            : ".media-tile .controlled-animation__canvas";
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=${surface === "feed" ? "feed" : "gallery"}&type=image&q=${encodeURIComponent(asset.name)}${surface === "viewer" ? `&asset=${encodeURIComponent(asset.id)}` : ""}`
      );
      const canvas = page.locator(selector).first();
      await expect(canvas).toHaveCSS("opacity", "1");
      await expectContinuousMotion(page, selector, [asset.name]);

      if (surface === "feed") {
        await page
          .getByRole("button", { name: "Pause video", exact: true })
          .click();
        await expectMotionStops(page);
        await page
          .getByRole("button", { name: "Play video", exact: true })
          .click();
        await expectMotionResumes(page);
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent("pagehide"))
        );
        await expectMotionStops(page);
        await expect(canvas).toHaveAttribute("width", "0");
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent("pageshow"))
        );
        await expectMotionResumes(page);
      }
    } finally {
      await context.close();
    }
  });
}

for (const loopMode of ["repeat", "bounce"] as const) {
  test(`keeps two comparison animations continuous through ${loopMode} atlas transitions`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true
    });
    try {
      await observeDraws(context);
      const page = await context.newPage();
      const token = (await context.cookies()).find(
        (cookie) => cookie.name === "aether_csrf"
      )!.value;
      for (const item of comparisonAssets) {
        const current = (await (
          await page.request.get(`${origin}/api/assets/${item.id}`)
        ).json()) as AssetRecord;
        const result = await page.request.put(
          `${origin}/api/assets/${item.id}/presentation`,
          {
            headers: { "x-csrf-token": token },
            data: {
              expectedRevision: current.presentation?.revision ?? 0,
              highlight: null,
              fit: "auto",
              focalX: 0.5,
              focalY: 0.5,
              zoom: 1,
              playbackRate: 1,
              loopMode
            }
          }
        );
        expect(result.ok()).toBe(true);
        await mockAnimation(page, item);
      }
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(compareFolderId)}&view=compare&workspace=ranking&type=image`
      );
      const selector = ".comparison-card .controlled-animation__canvas";
      const canvases = page.locator(selector);
      await expect(canvases).toHaveCount(2);
      for (const canvas of await canvases.all())
        await expect(canvas).toHaveCSS("opacity", "1");
      await expectContinuousMotion(
        page,
        selector,
        comparisonAssets.map((item) => item.name),
        loopMode
      );
    } finally {
      await context.close();
    }
  });
}

async function createAtlas(atlas: number): Promise<Buffer> {
  const pixels = Buffer.alloc(atlasSide * atlasSide * 4, 255);
  for (let frame = 0; frame < framesPerAtlas; frame++) {
    const red = 16 + (atlas * framesPerAtlas + frame) * 4;
    const left = (frame % 4) * frameSide;
    const top = Math.floor(frame / 4) * frameSide;
    for (let row = top; row < top + frameSide; row++) {
      for (let column = left; column < left + frameSide; column++) {
        const offset = (row * atlasSide + column) * 4;
        pixels[offset] = red;
        pixels[offset + 1] = 80;
        pixels[offset + 2] = 160;
      }
    }
  }
  return sharp(pixels, {
    raw: { width: atlasSide, height: atlasSide, channels: 4 }
  })
    .png()
    .toBuffer();
}

async function mockAnimation(page: Page, item = asset) {
  await page.route(`**/api/assets/${item.id}/animation?*`, async (route) => {
    const key = new URL(route.request().url()).searchParams.get("v")!;
    await route.fulfill({
      json: {
        kind: "animation",
        width: frameSide,
        height: frameSide,
        durationMs: atlasCount * framesPerAtlas * frameDurationMs,
        atlases: Array.from({ length: atlasCount }, (_, atlas) => ({
          url: `/api/assets/${item.id}/animation/atlases/${atlas}?v=${encodeURIComponent(key)}`,
          width: atlasSide,
          height: atlasSide
        })),
        frames: Array.from(
          { length: atlasCount * framesPerAtlas },
          (_, frame) => ({
            startMs: frame * frameDurationMs,
            durationMs: frameDurationMs,
            atlas: Math.floor(frame / framesPerAtlas),
            x: ((frame % framesPerAtlas) % 4) * frameSide,
            y: Math.floor((frame % framesPerAtlas) / 4) * frameSide,
            width: frameSide,
            height: frameSide
          })
        )
      }
    });
  });
  await page.route(
    `**/api/assets/${item.id}/animation/atlases/*`,
    async (route) => {
      const atlas = Number(
        new URL(route.request().url()).pathname.split("/").at(-1)
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route
        .fulfill({ contentType: "image/png", body: atlasImages[atlas]! })
        .catch(() => undefined);
    }
  );
}

async function observeDraws(context: BrowserContext) {
  await context.addInitScript(() => {
    const state = window as unknown as ContinuityWindow;
    state.animationContinuity = { selector: "", samples: [] };
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      original.apply(this, args);
      const observation = state.animationContinuity;
      if (!observation.selector || !this.canvas.matches(observation.selector))
        return;
      const frame = Math.round(
        (this.getImageData(0, 0, 1, 1).data[0]! - 16) / 4
      );
      const source = this.canvas.getAttribute("aria-label") ?? "";
      if (
        observation.samples.findLast((sample) => sample.source === source)
          ?.frame === frame
      )
        return;
      observation.samples.push({ time: performance.now(), frame, source });
    };
  });
}

async function expectContinuousMotion(
  page: Page,
  selector: string,
  sources: string[],
  loopMode: "repeat" | "bounce" = "repeat"
) {
  await page.evaluate((target) => {
    (window as unknown as ContinuityWindow).animationContinuity = {
      selector: target,
      samples: []
    };
  }, selector);
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ expectedSources, mode }) => {
            const { samples } = (window as unknown as ContinuityWindow)
              .animationContinuity;
            return Math.min(
              ...expectedSources.map((source) => {
                const sequence = samples.filter(
                  (sample) => sample.source === source
                );
                return sequence.filter((sample, index) => {
                  const previous = sequence[index - 1];
                  return (
                    previous &&
                    (mode === "repeat"
                      ? sample.frame < previous.frame
                      : sample.frame < 3 && previous.frame > sample.frame)
                  );
                }).length;
              })
            );
          },
          { expectedSources: sources, mode: loopMode }
        ),
      { timeout: 18_000, intervals: [100] }
    )
    .toBeGreaterThanOrEqual(loopMode === "repeat" ? 3 : 5);
  const observed = await page.evaluate(
    () => (window as unknown as ContinuityWindow).animationContinuity.samples
  );
  for (const source of sources) {
    const samples = observed.filter((sample) => sample.source === source);
    expect(
      new Set(samples.map((sample) => sample.frame)).size,
      `${source} advances through the complete source`
    ).toBeGreaterThan(framesPerAtlas * 3);
    if (loopMode === "bounce")
      expect(
        samples.some(
          (sample, index) =>
            sample.frame >= framesPerAtlas * (atlasCount - 1) &&
            sample.frame < (samples[index - 1]?.frame ?? -1)
        ),
        `${source} reverses after reaching its end`
      ).toBe(true);
    const gaps = samples.slice(1).map((sample, index) => ({
      afterFrame: samples[index]!.frame,
      duration: sample.time - samples[index]!.time
    }));
    expect(
      Math.max(...gaps.map((gap) => gap.duration)),
      `${source} should not stop at atlas boundaries: ${JSON.stringify(gaps.filter((gap) => gap.duration >= 180))}`
    ).toBeLessThan(180);
  }
}

async function scan(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: { "x-csrf-token": token }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(async () => {
      const result = (await (
        await page.request.get(`${origin}/api/admin/jobs`)
      ).json()) as { jobs: ScanJob[] };
      return result.jobs.find((job) => job.id === jobId)?.status;
    })
    .toBe("completed");
}

async function expectMotionStops(page: Page) {
  await page.waitForTimeout(100);
  const count = await drawCount(page);
  await page.waitForTimeout(400);
  expect(await drawCount(page)).toBe(count);
}

async function expectMotionResumes(page: Page) {
  const count = await drawCount(page);
  await expect.poll(() => drawCount(page)).toBeGreaterThan(count + 2);
}

async function drawCount(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as ContinuityWindow).animationContinuity.samples.length
  );
}
