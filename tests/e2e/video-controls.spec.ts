import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";
import type {
  AssetListResponse,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureFolder = "video-controls-fixture";
const fixtureDirectory = path.resolve(".e2e", "media", fixtureFolder);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let videoAssetIds: string[];

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
    await promisify(execFile)("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      video,
      "-vf",
      "transpose=clock",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "copy",
      "-y",
      path.join(fixtureDirectory, "transport-1.mp4")
    ]);
    await scanLibrary(page);
    const response = await page.request.get(`${origin}/api/tree`);
    expect(response.ok()).toBe(true);
    const tree = (await response.json()) as TreeResponse;
    folderId = tree.folders.find(
      (entry) => entry.relativePath === fixtureFolder
    )!.id;
    const assetsResponse = await page.request.get(
      `${origin}/api/folders/${folderId}/assets?type=video&sort=filename&limit=10`
    );
    expect(assetsResponse.ok()).toBe(true);
    const { items } = (await assetsResponse.json()) as AssetListResponse;
    videoAssetIds = items.map((asset) => asset.id);
    expect(videoAssetIds).toHaveLength(2);
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

for (const viewport of [
  { width: 1440, height: 980 },
  { width: 393, height: 852 }
]) {
  test(`plays portrait and landscape videos inside landscape gallery cards at ${viewport.width}×${viewport.height}`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState, viewport });
    try {
      const page = await context.newPage();
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=video&sort=filename&size=huge&aspect=landscape`,
        { waitUntil: "domcontentloaded" }
      );
      const cards = page.locator(".media-tile");
      await expect(cards).toHaveCount(2);
      for (const card of await cards.all()) {
        await card.scrollIntoViewIfNeeded();
        const poster = card.locator(".media-video-poster");
        await expectDecodedPoster(poster);
        await expect
          .poll(() =>
            card.locator(".media-video-shell").evaluate((shell) => {
              const bounds = shell.getBoundingClientRect();
              return [...shell.querySelectorAll("img, video")].every(
                (media) => {
                  const frame = media.getBoundingClientRect();
                  return (
                    Math.abs(frame.width - bounds.width) <= 1 &&
                    Math.abs(frame.height - bounds.height) <= 1
                  );
                }
              );
            })
          )
          .toBe(true);
        const video = card.locator("video");
        await expect(video).toHaveAttribute("data-preview-source", "preview");
        await expectPlaying(video);
        await expect(video).toHaveCSS("opacity", "1");
        await expect(poster).toHaveCSS("opacity", "0");
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      const portrait = page
        .locator(".media-tile")
        .filter({ hasText: "transport-1.mp4" });
      await portrait.scrollIntoViewIfNeeded();
      await expectPlaying(portrait.locator("video"));
    } finally {
      await context.close();
    }
  });
}

for (const hasTouch of [false, true]) {
  test(`toggles Feed details and playback controls together with ${hasTouch ? "touch" : "mouse and keyboard"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      hasTouch,
      viewport: hasTouch
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      reducedMotion: hasTouch ? "reduce" : "no-preference"
    });
    try {
      const page = await context.newPage();
      const item = await openFeed(page);
      const video = item.locator("video");
      const toggle = item.locator(".media-video-playback-toggle");
      const controls = item.locator(".video-controls--feed");
      const details = item.locator(".feed-meta");
      const pauseButton = controls.getByRole("button", {
        name: "Pause video",
        exact: true
      });
      await expectPlaying(video);
      const frameBounds = (await item.locator(".feed-frame").boundingBox())!;
      const controlsBounds = (await controls.boundingBox())!;
      expect(controlsBounds.x).toBeCloseTo(frameBounds.x, 0);
      expect(controlsBounds.width).toBeCloseTo(frameBounds.width, 0);
      expect(controlsBounds.y + controlsBounds.height).toBeCloseTo(
        frameBounds.y + frameBounds.height,
        0
      );
      const formerPauseBounds = (await pauseButton.boundingBox())!;
      if (hasTouch) await toggle.tap();
      else await toggle.click();
      await expect(controls).toBeHidden();
      await expect(details).toBeHidden();
      await expect(item.getByRole("slider")).toHaveCount(0);
      await expect(
        item.getByRole("button", { name: /^Open details for/ })
      ).toHaveCount(0);
      await expectPaused(video, false);

      const x = formerPauseBounds.x + formerPauseBounds.width / 2;
      const y = formerPauseBounds.y + formerPauseBounds.height / 2;
      if (hasTouch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(controls).toBeVisible();
      await expect(details).toBeVisible();
      await expectPaused(video, false);

      if (hasTouch) await pauseButton.tap();
      else await pauseButton.click();
      await expectPaused(video, true);
      if (hasTouch) {
        // Time labels sit inside the slider's touch area and must not block it.
        const seek = controls.getByRole("slider");
        const seekBounds = (await seek.boundingBox())!;
        await seek.tap({ position: { x: seekBounds.width * 0.75, y: 8 } });
        await expect
          .poll(() =>
            video.evaluate((node: HTMLVideoElement) => node.currentTime)
          )
          .toBeGreaterThan(8);
        await expect(item).not.toHaveClass(/details-hidden/);
        await expectPaused(video, true);
      }
      if (hasTouch) await toggle.tap();
      else await toggle.press("Enter");
      await expect(controls).toBeHidden();
      if (hasTouch) await toggle.tap();
      else await toggle.press("Space");
      await expect(controls).toBeVisible();
      await expect(details).toBeVisible();
      await expectPaused(video, true);

      if (!hasTouch) {
        await controls
          .getByRole("button", { name: "Play video", exact: true })
          .click();
        await toggle.hover();
        await page.mouse.down();
        await expectPaused(video, true);
        await page.mouse.up();
        await expectPaused(video, false);
        await expect(controls).toBeVisible();
        await expect(details).toBeVisible();
      }
      if (hasTouch) await toggle.tap();
      else await toggle.click();
      await expect(controls).toBeHidden();
      await toggle.press("Tab");
      expect(
        await page.evaluate(() =>
          Boolean(
            document.activeElement?.closest(
              ".video-controls--feed, .feed-meta, .feed-actions"
            )
          )
        )
      ).toBe(false);
    } finally {
      await context.close();
    }
  });
}

test("keeps mobile Feed full height with a reachable view switcher through rotation and safe-area changes", async ({
  browser,
  browserName
}) => {
  test.skip(browserName !== "chromium", "Requires CDP safe-area emulation");
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 59, bottom: 34, left: 0, right: 0 }
    });
    await openFeed(page);
    const item = page.locator('.feed-item[data-feed-index="1"]');
    await item.scrollIntoViewIfNeeded();
    await expectPlaying(item.locator("video"));
    const toggle = item.locator(".media-video-playback-toggle");
    const controls = item.locator(".video-controls--feed");
    await controls
      .getByRole("button", { name: "Pause video", exact: true })
      .tap();
    const header = page.locator(".library-path-bar");
    const switcher = page.getByRole("group", { name: "Library view" });
    const overlay = page.locator(".feed-view-controls");
    await expect(header).toHaveCount(0);
    const expectSwitcher = async (top: number, right: number) => {
      await expect(switcher).toBeVisible();
      const rect = (await switcher.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(rect.y).toBeGreaterThanOrEqual(top + 12);
      expect(
        Math.abs(rect.x + rect.width - (viewport.width - right - 12))
      ).toBeLessThanOrEqual(1);
      for (const button of await overlay.getByRole("button").all()) {
        const target = (await button.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.y).toBeGreaterThanOrEqual(top + 12);
        await expect(button).toBeVisible();
      }
    };

    const expectFullViewport = async () => {
      await expect
        .poll(() =>
          item.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return Math.max(
              Math.abs(rect.top),
              Math.abs(rect.left),
              Math.abs(rect.bottom - innerHeight),
              Math.abs(rect.right - innerWidth),
              Math.abs(document.documentElement.scrollWidth - innerWidth)
            );
          })
        )
        .toBeLessThanOrEqual(1);
      await expectPaused(item.locator("video"), true);
      const itemBounds = (await item.boundingBox())!;
      const frameBounds = (await item.locator(".feed-frame").boundingBox())!;
      expect(frameBounds.width).toBeCloseTo(itemBounds.width, 0);
      expect(frameBounds.height).toBeCloseTo(itemBounds.height, 0);
      await expect(item).toHaveAttribute("data-aspect", "Portrait");
    };
    await expectFullViewport();
    await expectSwitcher(59, 0);
    await toggle.tap();
    await expect(controls).toBeHidden();
    await expect(overlay).toBeHidden();
    await expect(overlay).toHaveAttribute("inert", "");
    await expectFullViewport();
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 0, bottom: 21, left: 59, right: 59 }
    });
    await page.setViewportSize({ width: 932, height: 430 });
    await expectFullViewport();
    await expect(overlay).toBeHidden();
    await toggle.tap();
    await expectSwitcher(0, 59);
    await expect(header).toHaveCount(0);
    await expectSafeTargets(controls, { left: 59, right: 59, bottom: 21 });

    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 59, bottom: 34, left: 0, right: 0 }
    });
    await page.setViewportSize({ width: 393, height: 852 });
    await expectSafeTargets(controls, { left: 0, right: 0, bottom: 34 });
    await expectSwitcher(59, 0);
    await toggle.tap();
    await expectFullViewport();

    // Some iOS versions expose a shorter viewport with no top inset.
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 0, bottom: 34, left: 0, right: 0 }
    });
    await page.setViewportSize({ width: 393, height: 793 });
    await expectFullViewport();
    await expect(overlay).toBeHidden();
    await toggle.tap();
    await expectSwitcher(0, 0);
    await switcher
      .getByRole("button", { name: "Gallery view", exact: true })
      .tap();
    await expect(
      page.getByRole("region", { name: "Gallery view" })
    ).toBeVisible();
    await expect(header).toBeVisible();
    await expect(page.locator(".feed-view-controls")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("folder")).toBe(folderId);
    expect(new URL(page.url()).searchParams.get("type")).toBe("video");
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
    await controls
      .getByRole("button", { name: "Play video", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(seek).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      controls.getByRole("button", { name: "Unmute video", exact: true })
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      controls.getByRole("button", { name: / in viewer$/ })
    ).toBeFocused();
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
    await expect(
      controls.getByRole("button", { name: "Pause video", exact: true })
    ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expectPaused(video, true);
    // Let the hidden-page render settle before simulating a return.
    await expect(
      controls.getByRole("button", { name: "Play video", exact: true })
    ).toBeVisible();
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

test("removes failed video posters while the original media remains playable", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  const mediaGate = createRequestGate();
  try {
    await context.route(/\/api\/assets\/[^/]+\/thumbnail\?/, (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: "thumbnail_generation_failed" })
      })
    );
    await context.route(
      /\/api\/assets\/[^/]+\/media(?:\?|$)/,
      async (route) => {
        await mediaGate.wait;
        await route.continue();
      }
    );
    const page = await context.newPage();
    await page.goto(feedUrl(), { waitUntil: "domcontentloaded" });
    const item = page.locator('.feed-item[data-feed-index="0"]');
    const shell = item.locator(".media-video-shell");
    const video = item.locator("video");
    await expect(shell).toHaveClass(/poster-error/);
    await expect(item.locator(".media-video-poster")).toHaveCount(0);
    await expect(video).toHaveJSProperty("readyState", 0);
    await expect(item.getByRole("slider")).toBeDisabled();

    mediaGate.release();
    await expectPlaying(video);
    await expect(shell).toHaveClass(/\bready\b/);
    await item.getByRole("button", { name: / in viewer$/ }).click();
    const viewer = page.locator(".viewer-dialog");
    const viewerVideo = viewer.locator("video");
    await expectPlaying(viewerVideo);
    await expect(viewer.locator(".viewer-video-poster")).toHaveCount(0);
    await expect(viewer.locator(".viewer-loading")).toHaveCount(0);
    await expect(viewer.getByRole("slider")).toBeEnabled();
  } finally {
    mediaGate.release();
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
});

test("keeps healthy posters until a video frame arrives and discards a failed inherited poster", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  const firstMedia = createRequestGate();
  const secondMedia = createRequestGate();
  const secondPoster = createRequestGate();
  try {
    await context.route(
      /\/api\/assets\/[^/]+\/media(?:\?|$)/,
      async (route) => {
        const assetId = new URL(route.request().url()).pathname.split("/")[3];
        await (assetId === videoAssetIds[0] ? firstMedia : secondMedia).wait;
        await route.continue();
      }
    );
    await context.route(/\/api\/assets\/[^/]+\/thumbnail\?/, async (route) => {
      if (route.request().url().includes(`/assets/${videoAssetIds[1]}/`)) {
        await secondPoster.wait;
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(feedUrl(), { waitUntil: "domcontentloaded" });
    const item = page.locator('.feed-item[data-feed-index="0"]');
    const feedPoster = item.locator(".media-video-poster");
    await expectDecodedPoster(feedPoster);
    await expect(feedPoster).toHaveCSS("opacity", "1");
    await expect(item.locator("video")).toHaveJSProperty("readyState", 0);
    await item.getByRole("button", { name: / in viewer$/ }).click();

    const viewer = page.locator(".viewer-dialog");
    const viewerVideo = viewer.locator("video");
    await expectDecodedPoster(viewer.locator(".viewer-video-poster"));
    await expect(viewerVideo).toHaveJSProperty("readyState", 0);
    await expect(viewer.locator(".viewer-media-frame")).toHaveClass(/is-ready/);
    firstMedia.release();
    await expectPlaying(viewerVideo);
    await expect(viewer.locator(".viewer-media-frame")).toHaveClass(
      /is-video-ready/
    );
    await expect(viewer.locator(".viewer-video-poster")).toHaveCount(0);

    await viewer
      .getByRole("button", { name: "Next media", exact: true })
      .click();
    await expect(
      viewer.getByRole("heading", { name: "transport-1.mp4", exact: true })
    ).toBeAttached();
    const fallback = viewer.locator(".viewer-video-poster-fallback");
    await expectDecodedPoster(fallback);
    await expect(viewerVideo).toHaveJSProperty("readyState", 0);
    await expect(viewer.locator(".viewer-media-frame")).toHaveClass(/is-ready/);
    await fallback.evaluate((node: HTMLImageElement) => {
      node.src = "data:image/jpeg;base64,AA==";
    });
    await expect(fallback).toHaveCount(0);
    await expect(viewer.locator(".viewer-loading")).toBeVisible();

    secondPoster.release();
    const currentPoster = viewer.locator(".viewer-video-poster");
    await expectDecodedPoster(currentPoster);
    await expect(currentPoster).toHaveAttribute(
      "src",
      new RegExp(`/assets/${videoAssetIds[1]}/thumbnail`)
    );
    await expect(viewer.locator(".viewer-loading")).toHaveCount(0);
    await expect(viewerVideo).toHaveJSProperty("readyState", 0);
    secondMedia.release();
    await expectPlaying(viewerVideo);
    await expect(viewer.locator(".viewer-media-frame")).toHaveClass(
      /is-video-ready/
    );
    await expect(viewer.locator(".viewer-video-poster")).toHaveCount(0);
  } finally {
    firstMedia.release();
    secondMedia.release();
    secondPoster.release();
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 393, height: 852 },
  { width: 932, height: 430 },
  { width: 1440, height: 980 }
]) {
  test(`overlays playback controls while fitting media within safe areas at ${viewport.width}×${viewport.height}`, async ({
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
      await context.addInitScript(() =>
        localStorage.setItem(
          "aether.feed.metadata-fields",
          '["title", "mediaType"]'
        )
      );
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
      for (const aspectRatio of [16 / 9, 9 / 16]) {
        await expectPlaying(viewer.locator("video"));
        await viewerControls.getByRole("slider").focus();
        await expectSafeTargets(viewerControls);
        const fitArea = viewer.locator(".viewer-fit-area");
        const availableWidth = viewport.width - 40;
        const availableHeight = viewport.height - 38;
        await expect
          .poll(async () => {
            const bounds = (await fitArea.boundingBox())!;
            return Math.abs(bounds.height - availableHeight);
          })
          .toBeLessThanOrEqual(1);
        const video = viewer.locator("video");
        await expect(video).toHaveCSS("object-fit", "contain");
        await expect(video).toHaveCSS("object-position", "50% 50%");
        const expectedWidth = Math.min(
          availableWidth,
          availableHeight * aspectRatio
        );
        const expectedHeight = Math.min(
          availableHeight,
          availableWidth / aspectRatio
        );
        await expect
          .poll(async () => {
            // The element can include letterboxing around the fitted picture.
            const bounds = (await video.boundingBox())!;
            const width = Math.min(bounds.width, bounds.height * aspectRatio);
            const height = Math.min(bounds.height, bounds.width / aspectRatio);
            return Math.max(
              Math.abs(width - expectedWidth),
              Math.abs(height - expectedHeight)
            );
          })
          .toBeLessThanOrEqual(1);
        const frame = (await video.boundingBox())!;
        expect(frame.x).toBeGreaterThanOrEqual(20);
        expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.width - 20);
        expect(frame.y).toBeGreaterThanOrEqual(4);
        expect(frame.y + frame.height).toBeLessThanOrEqual(
          viewport.height - 34
        );
        // The dock overlays the full viewing area, including any letterboxing.
        const viewerDock = (await viewerControls.boundingBox())!;
        expect(frame.y + frame.height).toBeGreaterThan(
          viewerDock.y + viewerDock.height
        );
        if (aspectRatio >= 1) {
          await fitArea.press("ArrowRight");
          await expect(viewer.getByRole("slider")).toHaveAttribute(
            "aria-label",
            "Seek transport-1.mp4"
          );
        }
      }
    } finally {
      await context.close();
    }
  });
}

async function openFeed(page: Page) {
  await page.goto(feedUrl(), { waitUntil: "domcontentloaded" });
  const item = page.locator('.feed-item[data-feed-index="0"]');
  await expect(item.locator("video")).toHaveAttribute(
    "data-preview-source",
    "original"
  );
  await expect(item.getByRole("slider")).toBeEnabled();
  return item;
}

function feedUrl() {
  return `${origin}/?folder=${encodeURIComponent(folderId)}&view=feed&type=video&sort=filename`;
}

function createRequestGate() {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release: () => release() };
}

async function expectPlaying(video: Locator) {
  await expect
    .poll(() =>
      video.evaluate(
        (node: HTMLVideoElement) => !node.paused && node.currentTime > 0
      )
    )
    .toBe(true);
}

async function expectDecodedPoster(poster: Locator) {
  await expect
    .poll(() =>
      poster.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0
      )
    )
    .toBe(true);
}

async function expectPaused(video: Locator, paused: boolean) {
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.paused))
    .toBe(paused);
}

async function expectSafeTargets(
  controls: Locator,
  insets = { left: 20, right: 20, bottom: 34 }
) {
  await controls.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
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
    dockHeight: node.getBoundingClientRect().height,
    isFeed: node.classList.contains("video-controls--feed"),
    documentWidth: document.documentElement.scrollWidth,
    targets: [...node.querySelectorAll<HTMLElement>("button, input")].map(
      (target) => {
        const rect = target.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        );
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          reachable: hit === target || target.contains(hit),
          label: target.getAttribute("aria-label"),
          edgesReachable: [
            [rect.left + 2, rect.top + 2],
            [rect.right - 2, rect.bottom - 2]
          ].every(([x, y]) => {
            const edge = document.elementFromPoint(x, y);
            return edge === target || target.contains(edge);
          })
        };
      }
    )
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.dockHeight).toBeLessThanOrEqual(
    56 + (geometry.isFeed ? insets.bottom : 0)
  );
  expect(geometry.targets.length).toBeGreaterThanOrEqual(3);
  for (const [index, target] of geometry.targets.entries()) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.left).toBeGreaterThanOrEqual(insets.left);
    expect(target.right).toBeLessThanOrEqual(geometry.width - insets.right);
    expect(target.bottom).toBeLessThanOrEqual(geometry.height - insets.bottom);
    expect(target.reachable).toBe(true);
    expect(target.edgesReachable, JSON.stringify({ index, ...target })).toBe(
      true
    );
    expect(Math.abs(target.top - geometry.targets[0].top)).toBeLessThanOrEqual(
      1
    );
    if (index > 0) {
      expect(target.left).toBeGreaterThanOrEqual(
        geometry.targets[index - 1].right
      );
    }
  }
  // A useful scrub width remains even with all buttons on a narrow phone.
  expect(
    (await controls.getByRole("slider").boundingBox())!.width
  ).toBeGreaterThanOrEqual(80);
  const labels = controls.locator(".video-controls__time > span");
  const elapsed = (await labels.first().boundingBox())!;
  const duration = (await labels.last().boundingBox())!;
  expect(elapsed.x + elapsed.width).toBeLessThan(duration.x);
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
