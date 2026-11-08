import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ScanJob, TreeResponse } from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "compare-playback-fixture";
const directory = path.resolve(".e2e/media", folderName);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;

interface PlaybackWindow extends Window {
  deferComparisonPlay: boolean;
  comparisonPlayFailures: Array<() => void>;
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
      "-an",
      "-y",
      first
    ]);
    await copyFile(first, path.join(directory, "video-1.mp4"));
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === folderName
    )!.id;
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
  test(`plays blocked comparisons without recording a choice and rejects stale play failures (${phone ? "phone" : "desktop"})`, async ({
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
        target.deferComparisonPlay = false;
        target.comparisonPlayFailures = [];
        const allowed = new WeakSet<HTMLMediaElement>();
        // Native autoplay does not call the overridden play() method.
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
        document.addEventListener(
          "click",
          (event) => {
            const button =
              event.target instanceof Element
                ? event.target.closest(".media-playback-recovery")
                : null;
            const video = button?.parentElement?.querySelector("video");
            if (event.isTrusted && video) allowed.add(video);
          },
          true
        );
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (this.closest(".comparison-card") && !allowed.has(this)) {
            const denied = () =>
              this.closest(".comparison-card") ===
              document.querySelector(".comparison-card")
                ? {
                    name: "NotAllowedError",
                    message: "Playback needs a user gesture"
                  }
                : new DOMException(
                    "Playback needs a user gesture",
                    "NotAllowedError"
                  );
            if (target.deferComparisonPlay) {
              return new Promise((_resolve, reject) => {
                target.comparisonPlayFailures.push(() => reject(denied()));
              });
            }
            return Promise.reject(denied());
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
        ) {
          choices += 1;
        }
      });
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking&type=video`
      );
      const cards = page.locator(".comparison-card");
      const playButtons = cards.getByRole("button", { name: /^Play / });
      await expect(cards).toHaveCount(2);
      await expect(playButtons).toHaveCount(2);
      await expect(cards.locator(".media-loading-bar")).toHaveCount(0);
      const originalPair = await cards.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-asset-id"))
      );
      await expect
        .poll(() =>
          cards.locator("video").evaluateAll((elements) =>
            elements.every((element) => {
              const video = element as HTMLVideoElement;
              return video.readyState >= 2 && video.paused && video.muted;
            })
          )
        )
        .toBe(true);
      await expect(
        cards.locator(".media-video-shell.poster-ready")
      ).toHaveCount(2);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`compare-blocked-${phone ? "phone" : "desktop"}.png`),
        animations: "disabled"
      });

      // Retain older automatic play requests to reject after the real gesture.
      await page.evaluate(() => {
        const target = window as unknown as PlaybackWindow;
        target.deferComparisonPlay = true;
        for (const video of document.querySelectorAll(".comparison-card video"))
          video.dispatchEvent(new Event("loadeddata"));
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as PlaybackWindow).comparisonPlayFailures
                .length
          )
        )
        .toBe(2);
      for (let index = 0; index < 2; index += 1) {
        const card = cards.nth(index);
        const button = card.getByRole("button", { name: /^Play / });
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        if (phone) await button.tap();
        else {
          await button.focus();
          await button.press("Enter");
        }
        await expect(button).toHaveCount(0);
        await expect
          .poll(() =>
            card
              .locator("video")
              .evaluate(
                (video: HTMLVideoElement) =>
                  !video.paused && video.currentTime > 0 && video.playsInline
              )
          )
          .toBe(true);
      }
      await page.evaluate(async () => {
        const target = window as unknown as PlaybackWindow;
        target.deferComparisonPlay = false;
        for (const fail of target.comparisonPlayFailures.splice(0)) fail();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });
      await expect(playButtons).toHaveCount(0);
      await expect(cards.locator(".media-video-shell.ready")).toHaveCount(2);
      expect(
        await cards.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-asset-id"))
        )
      ).toEqual(originalPair);
      expect(choices).toBe(0);
      await expect(
        page.getByRole("button", { name: "Undo last choice" })
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
