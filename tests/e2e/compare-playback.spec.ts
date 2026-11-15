import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  ComparisonDecisionResponse,
  ComparisonPairResponse,
  ComparisonSessionResumeResponse,
  PresentationValues,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "compare-playback-fixture";
const directory = path.resolve(".e2e/media", folderName);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let assets: AssetRecord[];
const defaults: PresentationValues = {
  highlight: null,
  aspectFraming: {},
  feedFraming: {},
  fit: "auto",
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  playbackRate: 1,
  loopMode: "repeat"
};

interface PlaybackWindow extends Window {
  comparisonPolicyDeniedSources: string[];
  publishComparisonVisibilityBatch: (states: boolean[]) => number;
  viewerPlayAttempts: Array<{
    muted: boolean;
    defaultMuted: boolean;
    inline: boolean;
    opacity: string;
  }>;
  comparisonPlayAttempts: Array<{
    muted: boolean;
    defaultMuted: boolean;
    inline: boolean;
    first: boolean;
    videoOpacity: string;
    posterOpacity: string;
    width: number;
    height: number;
  }>;
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
    await mkdir(directory, { recursive: true });
    const first = path.join(directory, "video-0.mp4");
    await promisify(execFile)("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x96:rate=12",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-y",
      first
    ]);
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        copyFile(first, path.join(directory, `video-${index + 1}.mp4`))
      )
    );
    await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const frames = [32, 96, 160, 224].map((value) => {
          const pixels = Buffer.alloc(40 * 40 * 3);
          for (let pixel = 0; pixel < pixels.length; pixel += 3) {
            pixels[pixel] = value;
            pixels[pixel + 1] = value;
            // A distinct source colour detects an old canvas behind new labels.
            pixels[pixel + 2] = 32 + index * 32;
          }
          return pixels;
        });
        await sharp(Buffer.concat(frames), {
          raw: { width: 40, height: 160, channels: 3, pageHeight: 40 },
          animated: true
        })
          .webp({
            lossless: true,
            loop: 0,
            delay: [400, 400, 400, 400],
            effort: 0
          })
          .toFile(path.join(directory, `animation-${index}.webp`));
      })
    );
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === folderName
    )!.id;
    assets = (
      (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=20`
        )
      ).json()) as AssetListResponse
    ).items;
    expect(assets).toHaveLength(12);
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
  test(`advances decoded animation frames after each acknowledged comparison (${phone ? "phone" : "desktop"})`, async ({
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
      await observeComparisonVisibilityBatches(context);
      const page = await context.newPage();
      const animationIds = assets
        .filter((asset) => asset.mediaType === "image")
        .map((asset) => asset.id);
      let plannedPairs: string[][] = [];
      let choices = 0;
      await page.route("**/api/comparisons", async (route) => {
        const body = route.request().postDataJSON() as {
          leftAssetId: string;
          rightAssetId: string;
        };
        const nextPairAssetIds = plannedPairs[choices++]!;
        expect(nextPairAssetIds).toHaveLength(2);
        expect(
          nextPairAssetIds.every(
            (id) => id !== body.leftAssetId && id !== body.rightAssetId
          )
        ).toBe(true);
        const response = await route.fetch({
          postData: JSON.stringify({ ...body, nextPairAssetIds })
        });
        expect(response.ok()).toBe(true);
        const result = (await response.json()) as ComparisonDecisionResponse;
        expect(result.nextPair && pairAssetIds(result.nextPair)).toEqual(
          nextPairAssetIds
        );
        await route.fulfill({ response });
      });
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking&type=image`
      );
      const initialPair = await pairIds(page);
      const remaining = animationIds.filter((id) => !initialPair.includes(id));
      expect(remaining).toHaveLength(4);
      plannedPairs = [remaining.slice(0, 2), remaining.slice(2), initialPair];
      await expectComparisonAnimationsAdvance(page, initialPair);
      for (const expectedPair of plannedPairs) {
        const acknowledgement = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/comparisons" &&
            response.request().method() === "POST" &&
            response.ok()
        );
        await page.locator(".comparison-choose-surface").first().click();
        const result = (await (
          await acknowledgement
        ).json()) as ComparisonDecisionResponse;
        expect(result.nextPair && pairAssetIds(result.nextPair)).toEqual(
          expectedPair
        );
        await expect.poll(() => pairIds(page)).toEqual(expectedPair);
        await publishComparisonVisibilityBatch(page, [false, true]);
        await expectComparisonAnimationsAdvance(page, expectedPair);
      }
      await publishComparisonVisibilityBatch(page, [true, false]);
      await expect
        .poll(() =>
          page.locator(".comparison-card canvas").evaluateAll((nodes) =>
            nodes.every((node) => {
              const canvas = node as HTMLCanvasElement;
              return canvas.width === 0 && canvas.height === 0;
            })
          )
        )
        .toBe(true);
      await publishComparisonVisibilityBatch(page, [true]);
      await expectComparisonAnimationsAdvance(page, plannedPairs.at(-1)!);
      expect(choices).toBe(3);
    } finally {
      await context.close();
    }
  });

  test(`preserves authorized muted playback through choices, Skip and Undo (${phone ? "phone" : "desktop"})`, async ({
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
      await observeComparisonVisibilityBatches(context);
      await context.addInitScript(() => {
        const target = window as unknown as PlaybackWindow;
        target.comparisonPolicyDeniedSources = [];
        const setAttribute = HTMLMediaElement.prototype.setAttribute;
        HTMLMediaElement.prototype.setAttribute = function (name, value) {
          if (name.toLowerCase() !== "autoplay")
            setAttribute.call(this, name, value);
        };
        const autoplay = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          "autoplay"
        )!;
        Object.defineProperty(HTMLMediaElement.prototype, "autoplay", {
          ...autoplay,
          set() {
            autoplay.set!.call(this, false);
          }
        });
        // WebKit can authorize playback per native media element. A completed
        // asynchronous choice does not grant replacement elements that permission.
        const authorized = new Set<HTMLMediaElement>();
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (this.closest(".comparison-card") && !authorized.has(this)) {
            if (authorized.size < 2) authorized.add(this);
            else {
              target.comparisonPolicyDeniedSources.push(this.src);
              return Promise.reject(
                new DOMException(
                  "This media element is not authorized to autoplay",
                  "NotAllowedError"
                )
              );
            }
          }
          return play.call(this);
        };
      });
      const page = await context.newPage();
      const videoIds = assets
        .filter((asset) => asset.mediaType === "video")
        .map((asset) => asset.id);
      let plannedPairs: string[][] = [];
      let choices = 0;
      await page.route("**/api/comparisons", async (route) => {
        const body = route.request().postDataJSON() as {
          leftAssetId: string;
          rightAssetId: string;
          mutationId: string;
          comparisonGeneration: string;
        };
        const nextPairAssetIds = plannedPairs[choices++]!;
        expect(nextPairAssetIds).toHaveLength(2);
        expect(
          nextPairAssetIds.every(
            (id) => id !== body.leftAssetId && id !== body.rightAssetId
          )
        ).toBe(true);
        // Keep the real mutation identifier and generation. The server validates
        // these deterministic next-pair candidates and returns hydrated records.
        const response = await route.fetch({
          postData: JSON.stringify({ ...body, nextPairAssetIds })
        });
        expect(response.ok()).toBe(true);
        const result = (await response.json()) as ComparisonDecisionResponse;
        expect(result.nextPair && pairAssetIds(result.nextPair)).toEqual(
          nextPairAssetIds
        );
        await route.fulfill({ response });
      });
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking&type=video`
      );
      const initialPair = await pairIds(page);
      const remaining = videoIds.filter((id) => !initialPair.includes(id));
      expect(remaining).toHaveLength(4);
      plannedPairs = [remaining.slice(0, 2), remaining.slice(2), initialPair];
      await expectComparisonPlaying(page);
      await expectComparisonFramesAdvance(page);
      const retainedVideos = await page
        .locator(".comparison-card video")
        .elementHandles();
      const expectRetainedVideos = async () => {
        expect(
          await Promise.all(
            retainedVideos.map((video, index) =>
              video.evaluate(
                (node, slot) =>
                  node ===
                  document.querySelectorAll(".comparison-card video")[slot],
                index
              )
            )
          )
        ).toEqual([true, true]);
      };
      let lastVotedPair = initialPair;
      for (const expectedPair of plannedPairs) {
        lastVotedPair = await pairIds(page);
        const acknowledgement = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/comparisons" &&
            response.request().method() === "POST" &&
            response.ok()
        );
        await page.locator(".comparison-choose-surface").first().click();
        const result = (await (
          await acknowledgement
        ).json()) as ComparisonDecisionResponse;
        expect(result.nextPair && pairAssetIds(result.nextPair)).toEqual(
          expectedPair
        );
        await expect.poll(() => pairIds(page)).toEqual(expectedPair);
        await publishComparisonVisibilityBatch(page, [false, true]);
        await expectComparisonPlaying(page);
        await expectComparisonFramesAdvance(page);
        await expectRetainedVideos();
      }
      const expectedSkipPair = plannedPairs[0]!;
      expect(
        expectedSkipPair.every(
          (id) => !initialPair.includes(id) && !lastVotedPair.includes(id)
        )
      ).toBe(true);
      let overrideSkip = true;
      const csrfToken = (await context.cookies()).find(
        (cookie) => cookie.name === "aether_csrf"
      )!.value;
      await page.route(
        /\/comparisons\/(?:resume|next)(?:\?|$)/,
        async (route) => {
          if (!overrideSkip) {
            await route.continue();
            return;
          }
          overrideSkip = false;
          const wasResume = route.request().method() === "POST";
          const body = wasResume
            ? (route.request().postDataJSON() as Record<string, unknown>)
            : {
                type: "video",
                recursive: true,
                search: "",
                tags: [],
                score: "all",
                previousDecision: null
              };
          // Validate the deterministic candidate through the real resume endpoint.
          // Preserve the caller's previous decision when Skip uses a prepared pair.
          const response = await route.fetch({
            url: `${origin}/api/folders/${encodeURIComponent(folderId)}/comparisons/resume`,
            method: "POST",
            headers: {
              ...route.request().headers(),
              "content-type": "application/json",
              "x-csrf-token": csrfToken
            },
            postData: JSON.stringify({
              ...body,
              pairAssetIds: expectedSkipPair
            })
          });
          expect(response.ok()).toBe(true);
          const validated =
            (await response.json()) as ComparisonSessionResumeResponse;
          expect(validated.pair && pairAssetIds(validated.pair)).toEqual(
            expectedSkipPair
          );
          await route.fulfill({
            response,
            json: wasResume ? validated : validated.pair
          });
        }
      );
      const skippedPairResponse = page.waitForResponse(
        (response) =>
          /\/comparisons\/(?:resume|next)$/.test(
            new URL(response.url()).pathname
          ) && response.ok()
      );
      await page.getByRole("button", { name: "Skip this pair" }).click();
      const skipped = (await (await skippedPairResponse).json()) as
        ComparisonSessionResumeResponse | ComparisonPairResponse;
      const skippedPair = "pair" in skipped ? skipped.pair : skipped;
      expect(skippedPair).toBeTruthy();
      expect(skippedPair && pairAssetIds(skippedPair)).toEqual(
        expectedSkipPair
      );
      await expect
        .poll(() => pairIds(page))
        .toEqual(pairAssetIds(skippedPair!));
      await publishComparisonVisibilityBatch(page, [false, true]);
      await expectComparisonPlaying(page);
      await expectComparisonFramesAdvance(page);
      await expectRetainedVideos();

      const undoAcknowledgement = page.waitForResponse(
        (response) =>
          /\/api\/comparisons\/[^/]+\/undo$/.test(
            new URL(response.url()).pathname
          ) && response.ok()
      );
      const restoredPairResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith("/comparisons/resume") &&
          response.ok()
      );
      await page.getByRole("button", { name: "Undo last choice" }).click();
      await undoAcknowledgement;
      const restored = (await (
        await restoredPairResponse
      ).json()) as ComparisonSessionResumeResponse;
      expect(restored.pair && pairAssetIds(restored.pair)).toEqual(
        lastVotedPair
      );
      await expect.poll(() => pairIds(page)).toEqual(lastVotedPair);
      await publishComparisonVisibilityBatch(page, [false, true]);
      await expectComparisonPlaying(page);
      await expectComparisonFramesAdvance(page);
      await expectRetainedVideos();
      await publishComparisonVisibilityBatch(page, [true, false]);
      await expect
        .poll(() =>
          page.locator(".comparison-card video").evaluateAll((nodes) =>
            nodes.every((node) => {
              const video = node as HTMLVideoElement;
              return video.paused && video.getAttribute("src") === null;
            })
          )
        )
        .toBe(true);
      await publishComparisonVisibilityBatch(page, [true]);
      await expectComparisonPlaying(page);
      await expectComparisonFramesAdvance(page);
      await expectRetainedVideos();
      expect(choices).toBe(3);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as PlaybackWindow).comparisonPolicyDeniedSources
        )
      ).toEqual([]);
      for (const video of retainedVideos) await video.dispose();
    } finally {
      await context.close();
    }
  });

  test(`recovers muted inline comparison autoplay after interrupted loading and foreground suspension (${phone ? "phone" : "desktop"})`, async ({
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
      await context.addInitScript(() => {
        const target = window as unknown as PlaybackWindow;
        target.comparisonPlayAttempts = [];
        target.viewerPlayAttempts = [];
        const setAttribute = HTMLMediaElement.prototype.setAttribute;
        HTMLMediaElement.prototype.setAttribute = function (name, value) {
          if (name.toLowerCase() !== "autoplay")
            setAttribute.call(this, name, value);
        };
        const autoplay = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          "autoplay"
        )!;
        Object.defineProperty(HTMLMediaElement.prototype, "autoplay", {
          ...autoplay,
          set() {
            autoplay.set!.call(this, false);
          }
        });
        // iOS may omit loadeddata. Metadata/canplay must independently start playback.
        document.addEventListener(
          "loadeddata",
          (event) => {
            if (
              event.target instanceof HTMLVideoElement &&
              event.target.closest(".comparison-card")
            )
              event.stopImmediatePropagation();
          },
          true
        );
        const attempted = new WeakSet<HTMLMediaElement>();
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (this.closest(".comparison-card")) {
            const box = this.getBoundingClientRect();
            target.comparisonPlayAttempts.push({
              muted: this.muted,
              defaultMuted: this.defaultMuted,
              inline: (this as HTMLVideoElement).playsInline,
              first: !attempted.has(this),
              videoOpacity: getComputedStyle(this).opacity,
              posterOpacity: getComputedStyle(
                this.parentElement!.querySelector(".media-video-poster")!
              ).opacity,
              width: box.width,
              height: box.height
            });
            if (!attempted.has(this)) {
              attempted.add(this);
              return Promise.reject(
                new DOMException("Loading was interrupted", "AbortError")
              );
            }
          } else if (this.classList.contains("viewer-video")) {
            target.viewerPlayAttempts.push({
              muted: this.muted,
              defaultMuted: this.defaultMuted,
              inline: (this as HTMLVideoElement).playsInline,
              opacity: getComputedStyle(this).opacity
            });
          }
          return play.call(this);
        };
      });
      const page = await context.newPage();
      let choices = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/comparisons" &&
          request.method() === "POST"
        )
          choices += 1;
      });
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking&type=video`
      );
      const cards = page.locator(".comparison-card");
      await expect(cards).toHaveCount(2);
      await expectComparisonPlaying(page);
      const attempts = await page.evaluate(
        () => (window as unknown as PlaybackWindow).comparisonPlayAttempts
      );
      expect(attempts.length).toBeGreaterThanOrEqual(4);
      expect(
        attempts.every(
          (attempt) =>
            attempt.muted &&
            attempt.defaultMuted &&
            attempt.inline &&
            attempt.width > 0 &&
            attempt.height > 0
        )
      ).toBe(true);
      expect(
        attempts
          .filter((attempt) => attempt.first)
          .every(
            (attempt) =>
              attempt.videoOpacity === "1" && attempt.posterOpacity === "1"
          )
      ).toBe(true);
      await expect(cards.getByRole("button", { name: /^Play / })).toHaveCount(
        0
      );
      await expect(cards.locator(".media-loading-bar")).toHaveCount(0);
      const originalPair = await pairIds(page);
      expect(choices).toBe(0);
      const decision = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/comparisons" &&
          response.request().method() === "POST" &&
          response.ok()
      );
      await cards.first().locator(".comparison-choose-surface").click();
      await decision;
      await expect(
        page.getByRole("button", { name: "Undo last choice", exact: true })
      ).toBeEnabled();
      await expect.poll(() => pairIds(page)).not.toEqual(originalPair);
      await expectComparisonPlaying(page);
      const nextPair = await pairIds(page);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`compare-autoplay-${phone ? "phone" : "desktop"}.png`),
        animations: "disabled"
      });

      // A standalone app can return without ever publishing a hidden state.
      await page.evaluate(() => {
        for (const video of document.querySelectorAll<HTMLVideoElement>(
          ".comparison-card video"
        ))
          video.pause();
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true })
        );
      });
      await expectComparisonPlaying(page);
      await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true })
        );
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true })
        );
      });
      await expectComparisonPlaying(page);
      expect(await pairIds(page)).toEqual(nextPair);
      await expect(
        page.getByRole("button", { name: "Undo last choice", exact: true })
      ).toBeEnabled();
      await cards
        .first()
        .getByRole("button", { name: /^Open .* fullscreen$/ })
        .click();
      const viewer = page.locator(".viewer-dialog");
      await expect(viewer).toBeVisible();
      const viewerVideo = viewer.locator("video");
      await expect
        .poll(() =>
          viewerVideo.evaluate(
            (video: HTMLVideoElement) =>
              video.readyState >= 2 &&
              !video.paused &&
              video.currentTime > 0 &&
              video.muted &&
              video.playsInline
          )
        )
        .toBe(true);
      const viewerAttempts = await page.evaluate(
        () => (window as unknown as PlaybackWindow).viewerPlayAttempts
      );
      expect(viewerAttempts.length).toBeGreaterThan(0);
      expect(viewerAttempts[0]).toEqual({
        muted: true,
        defaultMuted: true,
        inline: true,
        opacity: "1"
      });
      const retainedViewerVideo = await viewerVideo.elementHandle();
      expect(retainedViewerVideo).not.toBeNull();
      const suspendedViewer = await viewerVideo.evaluate(
        (video: HTMLVideoElement) => {
          video.pause();
          const snapshot = {
            source: video.getAttribute("src"),
            time: video.currentTime
          };
          window.dispatchEvent(
            new PageTransitionEvent("pageshow", { persisted: true })
          );
          return snapshot;
        }
      );
      await expect
        .poll(() =>
          viewerVideo.evaluate(
            (video: HTMLVideoElement, before) =>
              !video.paused &&
              video.getAttribute("src") === before.source &&
              video.currentTime >= before.time,
            suspendedViewer
          )
        )
        .toBe(true);
      // WebKit exposes native fullscreen state through these events. A system
      // control pause must remain paused while native controls own playback.
      const nativePausedTime = await viewerVideo.evaluate(
        async (video: HTMLVideoElement) => {
          video.dispatchEvent(new Event("webkitbeginfullscreen"));
          video.pause();
          const time = video.currentTime;
          window.dispatchEvent(
            new PageTransitionEvent("pageshow", { persisted: true })
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          return time;
        }
      );
      expect(
        await viewerVideo.evaluate((video: HTMLVideoElement) => video.paused)
      ).toBe(true);
      expect(
        await viewerVideo.evaluate(
          (video: HTMLVideoElement) => video.currentTime
        )
      ).toBe(nativePausedTime);
      await viewerVideo.evaluate(async (video: HTMLVideoElement) => {
        video.dispatchEvent(new Event("webkitendfullscreen"));
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true })
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });
      expect(
        await viewerVideo.evaluate((video: HTMLVideoElement) => video.paused)
      ).toBe(true);
      expect(
        await viewerVideo.evaluate(
          (video: HTMLVideoElement) => video.currentTime
        )
      ).toBe(nativePausedTime);
      await viewer.locator(".viewer-fit-area").focus();
      await viewer
        .getByRole("button", { name: "Play video", exact: true })
        .click();
      await expect
        .poll(() =>
          viewerVideo.evaluate((video: HTMLVideoElement) => !video.paused)
        )
        .toBe(true);
      await viewer
        .getByRole("button", { name: "Pause video", exact: true })
        .click();
      const userPausedTime = await viewerVideo.evaluate(
        (video: HTMLVideoElement) => video.currentTime
      );
      await page.evaluate(async () => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true })
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });
      expect(
        await viewerVideo.evaluate((video: HTMLVideoElement) => video.paused)
      ).toBe(true);
      expect(
        await viewerVideo.evaluate(
          (video: HTMLVideoElement) => video.currentTime
        )
      ).toBe(userPausedTime);
      await expect
        .poll(() =>
          cards
            .locator("video")
            .evaluateAll((videos) =>
              videos.every((video) => (video as HTMLVideoElement).paused)
            )
        )
        .toBe(true);
      await viewer
        .getByRole("button", { name: "Close viewer", exact: true })
        .click();
      await expect(viewer).toHaveCount(0);
      await expect
        .poll(() =>
          retainedViewerVideo!.evaluate(
            (video: HTMLVideoElement) =>
              !video.isConnected &&
              video.paused &&
              video.getAttribute("src") === null
          )
        )
        .toBe(true);
      await retainedViewerVideo!.dispose();
      await expectComparisonPlaying(page);
      expect(await pairIds(page)).toEqual(nextPair);
      expect(choices).toBe(1);
      await expect(
        page.getByRole("button", { name: "Undo last choice", exact: true })
      ).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  for (const mediaType of ["video", "image"] as const) {
    test(`uses saved ${mediaType === "video" ? "video" : "animation"} Bounce in full view from Ranking and Leaderboard (${phone ? "phone" : "desktop"})`, async ({
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
        await context.addInitScript(() => {
          const original = HTMLMediaElement.prototype.canPlayType;
          HTMLMediaElement.prototype.canPlayType = function (type) {
            return type.includes("hvc1") ? "" : original.call(this, type);
          };
        });
        const page = await context.newPage();
        for (const asset of assets.filter(
          (item) => item.mediaType === mediaType
        )) {
          await setPresentation(page, asset, {
            ...defaults,
            highlight:
              mediaType === "video" ? { startMs: 500, endMs: 2000 } : null,
            loopMode: "bounce",
            playbackRate: 1.5
          });
        }
        let choices = 0;
        page.on("request", (request) => {
          if (
            new URL(request.url()).pathname === "/api/comparisons" &&
            request.method() === "POST"
          )
            choices += 1;
        });
        for (const workspace of ["ranking", "leaderboard"]) {
          await page.goto(
            `${origin}/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=${workspace}&type=${mediaType}&highlight=1`
          );
          const cards = page.locator(".comparison-card");
          const before = workspace === "ranking" ? await pairIds(page) : [];
          if (workspace === "ranking" && mediaType === "video") {
            await expectComparisonPlaying(page);
            await expect(
              cards.locator("video[data-preview-source='original']")
            ).toHaveCount(2);
            await expect
              .poll(() =>
                cards
                  .locator("video")
                  .evaluateAll((videos) =>
                    videos.every(
                      (video) => (video as HTMLVideoElement).playbackRate === 1
                    )
                  )
              )
              .toBe(true);
          }
          const opener =
            workspace === "ranking"
              ? cards
                  .first()
                  .getByRole("button", { name: /^Open .* fullscreen$/ })
              : page
                  .locator("[data-leaderboard-asset-id]")
                  .first()
                  .getByRole("button", { name: /^Open .* fullscreen$/ });
          await opener.click();
          const viewer = page.locator(".viewer-dialog");
          await expect(viewer).toBeVisible();
          if (mediaType === "video") {
            const video = viewer.locator("video");
            await expect(video).toHaveAttribute(
              "src",
              /playback\?variant=bounce/
            );
            await expect
              .poll(() =>
                video.evaluate(
                  (node: HTMLVideoElement) =>
                    node.readyState >= 2 &&
                    !node.paused &&
                    node.currentTime > 0 &&
                    node.muted &&
                    node.playbackRate === 1.5
                )
              )
              .toBe(true);
            await expect(viewer.locator(".video-controls")).toContainText(
              "Bounce"
            );
          } else {
            const canvas = viewer.locator("canvas");
            await expect(canvas).toBeVisible();
            await expect(viewer.locator(".video-controls")).toContainText(
              "Bounce"
            );
            // Actual reverse frame order distinguishes Bounce from forward repeat.
            await expect
              .poll(
                async () =>
                  canvas.evaluate((node: HTMLCanvasElement) => {
                    const value = node
                      .getContext("2d")
                      ?.getImageData(0, 0, 1, 1).data[0];
                    if (value === undefined) return false;
                    const levels = JSON.parse(
                      node.dataset.observedLevels ?? "[]"
                    ) as number[];
                    const level = Math.round((value - 32) / 64);
                    if (levels.at(-1) !== level) levels.push(level);
                    node.dataset.observedLevels = JSON.stringify(
                      levels.slice(-12)
                    );
                    return levels.some(
                      (item, index) =>
                        item === 3 &&
                        levels[index + 1] === 2 &&
                        levels[index + 2] === 1
                    );
                  }),
                { intervals: [50], timeout: 10_000 }
              )
              .toBe(true);
          }
          await page.screenshot({
            path: test
              .info()
              .outputPath(
                `compare-${mediaType}-${workspace}-${phone ? "phone" : "desktop"}.png`
              ),
            animations: "disabled"
          });
          await viewer
            .getByRole("button", { name: "Close viewer", exact: true })
            .click();
          await expect(viewer).toHaveCount(0);
          if (workspace === "ranking") {
            expect(await pairIds(page)).toEqual(before);
            await expect(
              page.getByRole("button", {
                name: "Undo last choice",
                exact: true
              })
            ).toBeDisabled();
            if (mediaType === "video") await expectComparisonPlaying(page);
          }
        }
        expect(choices).toBe(0);
      } finally {
        await context.close();
      }
    });
  }
  test(`retains the poster without a spinner or extra controls when browser policy denies muted autoplay (${phone ? "phone" : "desktop"})`, async ({
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
      await context.addInitScript(() => {
        const setAttribute = HTMLMediaElement.prototype.setAttribute;
        HTMLMediaElement.prototype.setAttribute = function (name, value) {
          if (name.toLowerCase() !== "autoplay")
            setAttribute.call(this, name, value);
        };
        const autoplay = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          "autoplay"
        )!;
        Object.defineProperty(HTMLMediaElement.prototype, "autoplay", {
          ...autoplay,
          set() {
            autoplay.set!.call(this, false);
          }
        });
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (this.closest(".comparison-card"))
            return Promise.reject(
              new DOMException("Autoplay is disabled", "NotAllowedError")
            );
          return play.call(this);
        };
      });
      const page = await context.newPage();
      let choices = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/comparisons" &&
          request.method() === "POST"
        )
          choices += 1;
      });
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking&type=video`
      );
      const cards = page.locator(".comparison-card");
      await expect(cards).toHaveCount(2);
      const before = await pairIds(page);
      await expect(
        cards.locator(".media-video-shell.poster-ready")
      ).toHaveCount(2);
      await expect(cards.locator(".media-loading-bar")).toHaveCount(0);
      await expect(cards.getByRole("button", { name: /^Play / })).toHaveCount(
        0
      );
      await expect
        .poll(() =>
          cards.locator("video").evaluateAll((videos) =>
            videos.every((element) => {
              const video = element as HTMLVideoElement;
              return (
                video.readyState >= 2 &&
                video.paused &&
                video.muted &&
                video.defaultMuted
              );
            })
          )
        )
        .toBe(true);
      expect(await pairIds(page)).toEqual(before);
      expect(choices).toBe(0);
      await expect(
        page.getByRole("button", { name: "Undo last choice", exact: true })
      ).toBeDisabled();
    } finally {
      await context.close();
    }
  });
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
      const jobs = (await (
        await page.request.get(`${origin}/api/admin/jobs`)
      ).json()) as { jobs: ScanJob[] };
      return jobs.jobs.find((job) => job.id === jobId)?.status;
    })
    .toBe("completed");
}

async function pairIds(page: Page) {
  const cards = page.locator(".comparison-card[data-asset-id]");
  await expect(cards).toHaveCount(2);
  return cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-asset-id")!)
  );
}

function pairAssetIds(pair: ComparisonPairResponse): string[] {
  return [pair.left.id, pair.right.id];
}

async function observeComparisonVisibilityBatches(context: BrowserContext) {
  await context.addInitScript(() => {
    const observers = new Set<ComparisonIntersectionObserver>();
    const NativeIntersectionObserver = window.IntersectionObserver;
    class ComparisonIntersectionObserver extends NativeIntersectionObserver {
      readonly observedTargets = new Set<Element>();
      readonly callback: IntersectionObserverCallback;

      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit
      ) {
        super(callback, options);
        this.callback = callback;
      }

      observe(target: Element) {
        this.observedTargets.add(target);
        observers.add(this);
        super.observe(target);
      }

      unobserve(target: Element) {
        this.observedTargets.delete(target);
        super.unobserve(target);
      }

      disconnect() {
        this.observedTargets.clear();
        observers.delete(this);
        super.disconnect();
      }
    }
    window.IntersectionObserver = ComparisonIntersectionObserver;
    const target = window as unknown as PlaybackWindow;
    target.publishComparisonVisibilityBatch = (states) => {
      let published = 0;
      for (const observer of observers) {
        for (const surface of observer.observedTargets) {
          if (
            !surface.isConnected ||
            !surface.closest(".comparison-card") ||
            !surface.matches(".media-image-shell, .media-video-shell")
          )
            continue;
          // Retain native observation, while draining an older queued delivery
          // before publishing a valid chronological batch for this same target.
          observer.takeRecords();
          const bounds = surface.getBoundingClientRect();
          const rootBounds = new DOMRectReadOnly(0, 0, innerWidth, innerHeight);
          const time = performance.now() - states.length;
          observer.callback(
            states.map((visible, index): IntersectionObserverEntry => ({
              target: surface,
              time: time + index,
              rootBounds,
              boundingClientRect: bounds,
              intersectionRect: visible
                ? bounds
                : new DOMRectReadOnly(bounds.x, bounds.y, 0, 0),
              intersectionRatio: visible ? 1 : 0,
              isIntersecting: visible
            })),
            observer
          );
          published += 1;
        }
      }
      return published;
    };
  });
}

async function publishComparisonVisibilityBatch(page: Page, states: boolean[]) {
  expect(
    await page.evaluate(
      (batch) =>
        (window as unknown as PlaybackWindow).publishComparisonVisibilityBatch(
          batch
        ),
      states
    )
  ).toBe(2);
}

async function expectComparisonPlaying(page: Page) {
  const videos = page.locator(".comparison-card video");
  await expect(videos).toHaveCount(2);
  await expect
    .poll(() =>
      videos.evaluateAll((nodes) =>
        nodes.every((node) => {
          const video = node as HTMLVideoElement;
          const box = video.getBoundingClientRect();
          const style = getComputedStyle(video);
          const assetId = video
            .closest(".comparison-card")
            ?.getAttribute("data-asset-id");
          return (
            Boolean(video.currentSrc) &&
            new URL(video.currentSrc).pathname ===
              `/api/assets/${assetId}/media` &&
            video.readyState >= 2 &&
            !video.paused &&
            video.currentTime > 0 &&
            video.muted &&
            video.defaultMuted &&
            video.playsInline &&
            video.videoWidth === 160 &&
            video.videoHeight === 96 &&
            box.width > 0 &&
            box.height > 0 &&
            box.right > 0 &&
            box.bottom > 0 &&
            box.left < innerWidth &&
            box.top < innerHeight &&
            style.visibility === "visible" &&
            Number(style.opacity) === 1
          );
        })
      )
    )
    .toBe(true);
}

async function expectComparisonAnimationsAdvance(
  page: Page,
  expectedPair: string[]
) {
  const canvases = page.locator(".comparison-card canvas");
  await expect(canvases).toHaveCount(2);
  await expect(
    page.locator(".comparison-card .media-image-shell.animation-ready")
  ).toHaveCount(2);
  const expectedBlue = expectedPair.map((id) => {
    const asset = assets.find((candidate) => candidate.id === id)!;
    return 32 + Number(/^animation-(\d+)\.webp$/.exec(asset.name)![1]) * 32;
  });
  const seen = [new Set<number>(), new Set<number>()];
  await expect
    .poll(
      async () => {
        const pixels = await canvases.evaluateAll((nodes) =>
          nodes.map((node) => {
            const canvas = node as HTMLCanvasElement;
            const pixel = canvas
              .getContext("2d")
              ?.getImageData(0, 0, 1, 1).data;
            return canvas.width === 40 &&
              canvas.height === 40 &&
              getComputedStyle(canvas).opacity === "1" &&
              pixel
              ? { red: pixel[0], blue: pixel[2] }
              : null;
          })
        );
        return pixels.map((pixel, index) => {
          if (!pixel || pixel.blue !== expectedBlue[index]) return false;
          seen[index]!.add(pixel.red);
          return seen[index]!.size >= 3;
        });
      },
      { intervals: [50], timeout: 10_000 }
    )
    .toEqual([true, true]);
}

async function expectComparisonFramesAdvance(page: Page) {
  const videos = page.locator(".comparison-card video");
  await expect(
    page.locator(".comparison-card .media-video-shell.ready")
  ).toHaveCount(2);
  const advancing = await videos.evaluateAll((nodes) =>
    Promise.all(
      nodes.map(
        (node) =>
          new Promise<boolean>((resolve) => {
            const video = node as HTMLVideoElement;
            const source = video.currentSrc;
            let firstTime: number | null = null;
            let frameId: number | null = null;
            const timeoutId = window.setTimeout(() => finish(false), 4_000);
            function finish(success: boolean) {
              window.clearTimeout(timeoutId);
              if (frameId !== null) video.cancelVideoFrameCallback(frameId);
              resolve(success);
            }
            function frame(_now: number, metadata: VideoFrameCallbackMetadata) {
              frameId = null;
              if (
                !video.isConnected ||
                video.paused ||
                video.currentSrc !== source
              ) {
                finish(false);
                return;
              }
              if (firstTime !== null && metadata.mediaTime !== firstTime) {
                finish(true);
                return;
              }
              firstTime = metadata.mediaTime;
              frameId = video.requestVideoFrameCallback(frame);
            }
            frameId = video.requestVideoFrameCallback(frame);
          })
      )
    )
  );
  expect(advancing).toEqual([true, true]);
}

async function setPresentation(
  page: Page,
  asset: AssetRecord,
  values: PresentationValues
) {
  const current = await page.request.get(`${origin}/api/assets/${asset.id}`);
  expect(current.ok()).toBe(true);
  const record = (await current.json()) as AssetRecord;
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.put(
    `${origin}/api/assets/${asset.id}/presentation`,
    {
      headers: { "x-csrf-token": token },
      data: { expectedRevision: record.presentation?.revision ?? 0, ...values }
    }
  );
  expect(response.ok()).toBe(true);
}
