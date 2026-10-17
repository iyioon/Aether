import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";
import type { ScanJob, TreeResponse } from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureFolder = "video-controls-fixture";
const fixtureDirectory = path.resolve(".e2e", "media", fixtureFolder);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;

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
    await mkdir(fixtureDirectory, { recursive: true });
    const video = path.join(fixtureDirectory, "transport-0.mp4");
    await promisify(execFile)("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "12",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-af",
      "volume=0.01",
      "-movflags",
      "+faststart",
      "-y",
      video
    ]);
    await copyFile(video, path.join(fixtureDirectory, "transport-1.mp4"));
    await scanLibrary(page);
    const response = await page.request.get(`${origin}/api/tree`);
    expect(response.ok()).toBe(true);
    const tree = (await response.json()) as TreeResponse;
    folderId = tree.folders.find(
      (entry) => entry.relativePath === fixtureFolder
    )!.id;
    storageState = await page.context().storageState();
  } finally {
    await page.close();
  }
});

test.afterAll(async ({ browser }) => {
  await rm(fixtureDirectory, { recursive: true, force: true });
  if (!storageState) return;
  const context = await browser.newContext({ storageState });
  try {
    await scanLibrary(await context.newPage());
  } finally {
    await context.close();
  }
});

test("controls real playback without feed navigation, score edits, or unwanted foreground audio", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const scoreWrites: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/score(?:\/|$)/.test(new URL(request.url()).pathname)
      ) {
        scoreWrites.push(request.url());
      }
    });
    const item = await openFeed(page);
    const video = item.locator("video");
    const controls = item.getByRole("group", {
      name: "Video playback controls"
    });
    const seek = item.getByRole("slider");
    await expect
      .poll(() =>
        video.evaluate(
          (node: HTMLVideoElement) => !node.paused && node.currentTime > 0
        )
      )
      .toBe(true);
    await controls
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    await expectPaused(video, true);
    const bounds = (await seek.boundingBox())!;
    await seek.click({
      position: { x: bounds.width / 2, y: bounds.height / 2 }
    });
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
      .toBeGreaterThan(5);
    await seek.press("ArrowLeft");
    await seek.press("ArrowDown");
    await seek.press("Space");
    await expectPaused(video, true);
    await expect(item).not.toHaveClass(/details-hidden/);
    expect(
      await page.locator(".feed-view").evaluate((node) => node.scrollTop)
    ).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expectPaused(video, true);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expectPaused(video, true);

    await controls
      .getByRole("button", { name: "Unmute video", exact: true })
      .click();
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.muted))
      .toBe(false);
    await expectPaused(video, true);
    await controls
      .getByRole("button", { name: "Mute video", exact: true })
      .click();
    await controls
      .getByRole("button", { name: "Play video", exact: true })
      .click();
    await expectPaused(video, false);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expectPaused(video, true);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expectPaused(video, false);

    await controls
      .getByRole("button", { name: "Unmute video", exact: true })
      .click();
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.muted))
      .toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expectPaused(video, true);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expectPaused(video, true);
    await controls
      .getByRole("button", { name: "Play video", exact: true })
      .click();
    await expectPaused(video, false);
    await controls.getByRole("button", { name: / in viewer$/ }).click();

    const viewer = page.locator(".viewer-dialog");
    const viewerVideo = viewer.locator("video");
    await expect(viewer).toBeVisible();
    await expectPaused(video, true);
    await expectPaused(viewerVideo, false);
    await viewer.locator(".viewer-fit-area").hover();
    await viewer
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    await expectPaused(viewerVideo, true);
    const viewerSeek = viewer.getByRole("slider");
    await viewerSeek.focus();
    await viewerSeek.press("End");
    await expect
      .poll(() =>
        viewerVideo.evaluate((node: HTMLVideoElement) => node.currentTime)
      )
      .toBeGreaterThan(11);
    await expectPaused(viewerVideo, true);
    await viewerSeek.press("ArrowDown");
    await viewerVideo.evaluate(async (node: HTMLVideoElement) => {
      node.dispatchEvent(new Event("webkitbeginfullscreen"));
      await node.play();
    });
    await expectPaused(viewerVideo, false);
    await viewerVideo.evaluate((node: HTMLVideoElement) => {
      node.pause();
      node.dispatchEvent(new Event("webkitendfullscreen"));
    });
    await expectPaused(viewerVideo, true);
    await page.waitForTimeout(2_000);
    await expect(viewer).toHaveClass(/controls-visible/);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expectPaused(viewerVideo, true);
    if (await page.evaluate(() => document.fullscreenEnabled)) {
      await viewer
        .getByRole("button", { name: "Enter fullscreen", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.fullscreenElement?.classList.contains("viewer-dialog")
          )
        )
        .toBe(true);
      await viewer
        .getByRole("button", { name: "Exit fullscreen", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement === null))
        .toBe(true);
      await viewer.evaluate((node: HTMLElement) => {
        node.requestFullscreen = () =>
          Promise.reject(new Error("Fullscreen denied"));
      });
      await viewer
        .getByRole("button", { name: "Enter fullscreen", exact: true })
        .click();
      await expect(viewerVideo).toHaveJSProperty("controls", true);
      await expect(viewer.locator(".video-controls--viewer")).toHaveCount(0);
    }
    await expect(
      viewer.getByRole("heading", { name: /transport-0\.mp4/ })
    ).toBeAttached();
    expect(scoreWrites).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 393, height: 852 },
  { width: 932, height: 430 },
  { width: 1440, height: 980 }
]) {
  test(`keeps playback targets and media clear of safe areas at ${viewport.width}×${viewport.height}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport,
      isMobile:
        viewport.width < 1000 && browser.browserType().name() !== "firefox",
      hasTouch: viewport.width < 1000,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const item = await openFeed(page);
      await page.addStyleTag({
        content:
          ":root { --media-safe-area-bottom: 34px; --media-safe-area-left: 20px; --media-safe-area-right: 20px; }"
      });
      const feedControls = item.locator(".video-controls--feed");
      await expectSafeTargets(feedControls);
      const meta = (await item.locator(".feed-meta-button").boundingBox())!;
      const dock = (await feedControls.boundingBox())!;
      expect(meta.y + meta.height).toBeLessThanOrEqual(dock.y + 1);
      await feedControls.getByRole("button", { name: / in viewer$/ }).click();
      const viewer = page.locator(".viewer-dialog");
      await expect(viewer).toBeVisible();
      await viewer.evaluate(async (node) => {
        await Promise.all(
          node
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined))
        );
      });
      const viewerControls = viewer.locator(".video-controls--viewer");
      await viewerControls.getByRole("slider").focus();
      await expectSafeTargets(viewerControls);
      const frame = (await viewer
        .locator(".viewer-media-frame")
        .boundingBox())!;
      const viewerDock = (await viewerControls.boundingBox())!;
      expect(frame.height).toBeGreaterThan(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(viewerDock.y + 1);
    } finally {
      await context.close();
    }
  });
}

async function openFeed(page: Page) {
  await page.goto(
    `${origin}/?folder=${encodeURIComponent(folderId)}&view=feed&type=video&sort=filename`,
    { waitUntil: "domcontentloaded" }
  );
  const item = page.locator('.feed-item[data-feed-index="0"]');
  await expect(item.locator("video")).toHaveAttribute(
    "data-preview-source",
    "original"
  );
  await expect(item.getByRole("slider")).toBeEnabled();
  return item;
}

async function expectPaused(video: Locator, paused: boolean) {
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.paused))
    .toBe(paused);
}

async function expectSafeTargets(controls: Locator) {
  await expect
    .poll(() =>
      controls.evaluate((node) =>
        [...node.querySelectorAll<HTMLElement>("button, input")].every(
          (target) => {
            const rect = target.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2
            );
            return hit === target || target.contains(hit);
          }
        )
      )
    )
    .toBe(true);
  const geometry = await controls.evaluate((node) => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    targets: [...node.querySelectorAll<HTMLElement>("button, input")].map(
      (target) => {
        const rect = target.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        );
        return {
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          reachable: hit === target || target.contains(hit)
        };
      }
    )
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.targets.length).toBeGreaterThanOrEqual(3);
  for (const target of geometry.targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.left).toBeGreaterThanOrEqual(20);
    expect(target.right).toBeLessThanOrEqual(geometry.width - 20);
    expect(target.bottom).toBeLessThanOrEqual(geometry.height - 34);
    expect(target.reachable).toBe(true);
  }
}

async function scanLibrary(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(csrf).toBeTruthy();
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: { "x-csrf-token": csrf! }
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
