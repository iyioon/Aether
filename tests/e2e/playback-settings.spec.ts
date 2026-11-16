import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  PresentationValues,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";
import { chooseAccountAction } from "./account-menu";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "playback-settings-fixture";
const directory = path.resolve(".e2e/media", folderName);
const preferenceKey = "aether.playback.v1";
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let assets: AssetRecord[];
const presentation: PresentationValues = {
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

type SoundMode = "Muted" | "Sound on" | "Remember last";

interface SoundTestWindow extends Window {
  soundTest: {
    blockAudible: boolean;
    attempts: Array<{ surface: string; muted: boolean; source: string }>;
    nextViewerFailure: "deferred-policy" | "abort" | null;
    rejectViewer: (() => void) | null;
  };
}

interface ViewerGestureTestWindow extends Window {
  viewerGestureTest: {
    holdFrames: boolean;
    pendingFrames: Array<() => void>;
    touchStarted: boolean;
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
    await mkdir(directory, { recursive: true });
    const first = path.join(directory, "sound-0.mp4");
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
      "4",
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
      first
    ]);
    await copyFile(first, path.join(directory, "sound-1.mp4"));
    await copyFile(first, path.join(directory, "sound-2.mp4"));
    await scan(page);
    const treeResponse = await page.request.get(`${origin}/api/tree`);
    expect(treeResponse.ok()).toBe(true);
    const tree = (await treeResponse.json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === folderName
    )!.id;
    const response = await page.request.get(
      `${origin}/api/folders/${folderId}/assets?type=video&sort=filename&limit=10`
    );
    expect(response.ok()).toBe(true);
    assets = ((await response.json()) as AssetListResponse).items;
    expect(assets).toHaveLength(3);
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
  const layout = phone ? "phone" : "desktop";

  test(`saves independent sound defaults and reapplies them for each new media (${layout})`, async ({
    browser
  }, testInfo) => {
    const context = await newContext(browser, phone);
    try {
      const page = await context.newPage();
      await openGallery(page);
      const viewer = await openViewer(page, 0);
      await expectSound(viewer.locator("video"), true);
      await closeViewer(page);
      const first = await openFeed(page, 0);
      await expectSound(first.locator("video"), true);
      await openSettings(page);
      const fullView = page.getByRole("combobox", {
        name: "Full view",
        exact: true
      });
      const feed = page.getByRole("combobox", { name: "Feed", exact: true });
      await expect(fullView).toHaveText("Muted");
      await expect(feed).toHaveText("Muted");
      await chooseMode(page, "Full view", "Sound on");
      await page.reload();
      await expect(
        page.getByRole("tab", { name: "Playback", exact: true })
      ).toHaveAttribute("aria-selected", "true");
      await expect(fullView).toHaveText("Sound on");
      await expect(feed).toHaveText("Muted");
      await expectSettingsLayout(page);
      await page.screenshot({
        path: testInfo.outputPath(`playback-settings-${layout}.png`)
      });
      if (phone) {
        await page.setViewportSize({ width: 320, height: 568 });
        await expectSettingsLayout(page);
        await page.screenshot({
          path: testInfo.outputPath("playback-settings-320.png")
        });
        await page.setViewportSize({ width: 393, height: 852 });
      }

      await openGallery(page);
      await openViewer(page, 0);
      await expectSound(viewer.locator("video"), false);
      await viewer
        .getByRole("button", { name: "Mute video", exact: true })
        .click();
      await expectSound(viewer.locator("video"), true);
      await nextViewerMedia(page, "sound-1.mp4");
      await expectSound(viewer.locator("video"), false);
      await closeViewer(page);
      await openViewer(page, 2);
      await expectSound(viewer.locator("video"), false);
      await closeViewer(page);
      await expectSound((await openFeed(page, 0)).locator("video"), true);
      await expectSound(
        (await activateFeedItem(page, 1)).locator("video"),
        true
      );

      await openSettings(page);
      await chooseMode(page, "Full view", "Muted");
      await chooseMode(page, "Feed", "Sound on");
      const audibleFeed = await openFeed(page, 0);
      await expectSound(audibleFeed.locator("video"), false);
      await audibleFeed
        .getByRole("button", { name: "Mute video", exact: true })
        .click();
      await expectSound(audibleFeed.locator("video"), true);
      await expectSound(
        (await activateFeedItem(page, 1)).locator("video"),
        false
      );
      await openGallery(page);
      await openViewer(page, 0);
      await expectSound(viewer.locator("video"), true);
    } finally {
      await context.close();
    }
  });

  test(`remembers explicit sound choices across navigation, closing and reload independently (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    try {
      const page = await context.newPage();
      await openGallery(page);
      await setModes(page, "Remember last", "Remember last");
      await openGallery(page);
      const viewer = await openViewer(page, 0);
      await expectSound(viewer.locator("video"), true);
      await viewer
        .getByRole("button", { name: "Unmute video", exact: true })
        .click();
      await expectSound(viewer.locator("video"), false);
      await nextViewerMedia(page, "sound-1.mp4");
      await expectSound(viewer.locator("video"), false);
      await closeViewer(page);
      await page.reload();
      await openViewer(page, 2);
      await expectSound(viewer.locator("video"), false);
      await closeViewer(page);

      const first = await openFeed(page, 0);
      await expectSound(first.locator("video"), true);
      await first
        .getByRole("button", { name: "Unmute video", exact: true })
        .click();
      await expectSound(first.locator("video"), false);
      const second = await activateFeedItem(page, 1);
      await expectSound(second.locator("video"), false);
      await second
        .getByRole("button", { name: "Mute video", exact: true })
        .click();
      await expectSound(
        (await activateFeedItem(page, 2)).locator("video"),
        true
      );
      await page.reload();
      await expectSound(
        (await activateFeedItem(page, 2)).locator("video"),
        true
      );
      await page
        .locator('.feed-item[data-feed-index="2"]')
        .getByRole("button", { name: / in viewer$/ })
        .click();
      await expectSound(viewer.locator("video"), false);
      await viewer
        .getByRole("button", { name: "Mute video", exact: true })
        .click();
      await closeViewer(page);
      await openGallery(page);
      await openViewer(page, 0);
      await expectSound(viewer.locator("video"), true);
      await closeViewer(page);
      await openSettings(page);
      await expect(
        page.getByRole("combobox", { name: "Full view", exact: true })
      ).toHaveText("Remember last");
      await expect(
        page.getByRole("combobox", { name: "Feed", exact: true })
      ).toHaveText("Remember last");
    } finally {
      await context.close();
    }
  });

  test(`falls back to muted playback without replacing remembered sound or recording Bounce silence (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    let page: Page | undefined;
    try {
      page = await context.newPage();
      await openGallery(page);
      await setModes(page, "Remember last", "Remember last");
      await openGallery(page);
      const viewer = await openViewer(page, 0);
      await viewer
        .getByRole("button", { name: "Unmute video", exact: true })
        .click();
      await expectSound(viewer.locator("video"), false);
      await closeViewer(page);
      const first = await openFeed(page, 0);
      await first
        .getByRole("button", { name: "Unmute video", exact: true })
        .click();
      await expectSound(first.locator("video"), false);
      await expectRememberedSound(page, false, false);
      await page.evaluate(() => {
        (window as unknown as SoundTestWindow).soundTest.blockAudible = true;
        sessionStorage.setItem("aether.e2e.blockAudible", "true");
      });
      await openGallery(page);
      await openViewer(page, 0);
      await expectSound(viewer.locator("video"), true);
      await expectAudibleAttempt(page, "viewer");
      await expectRememberedSound(page, false, false);
      await closeViewer(page);
      await expectSound((await openFeed(page, 0)).locator("video"), true);
      await expectAudibleAttempt(page, "feed");
      await expectRememberedSound(page, false, false);

      await setPresentation(page, assets[2]!, {
        ...presentation,
        loopMode: "bounce"
      });
      await openGallery(page);
      await openViewer(page, 2);
      await expect(viewer.locator("video")).toHaveAttribute(
        "src",
        /playback\?variant=bounce/
      );
      await expectSound(viewer.locator("video"), true);
      await expectRememberedSound(page, false, false);
      await closeViewer(page);
      const bounceFeed = await openFeed(page, 2, "bounce");
      await expect(bounceFeed.locator("video")).toHaveAttribute(
        "src",
        /playback\?variant=bounce/
      );
      await expectSound(bounceFeed.locator("video"), true);
      await expectRememberedSound(page, false, false);
      await page.goto(libraryUrl("compare") + "&workspace=ranking");
      const cards = page.locator(".comparison-card video");
      await expect(cards).toHaveCount(2);
      await expect
        .poll(() =>
          cards.evaluateAll((nodes) =>
            nodes.every((node) => (node as HTMLVideoElement).muted)
          )
        )
        .toBe(true);
      await expectRememberedSound(page, false, false);
    } finally {
      if (page) await setPresentation(page, assets[2]!, presentation);
      await context.close();
    }
  });

  test(`applies framing defaults on open and keeps temporary viewer choices during navigation (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    const page = await context.newPage();
    try {
      for (const asset of assets)
        await setPresentation(page, asset, {
          ...presentation,
          fit: "cover",
          zoom: 1.6,
          focalX: 0.3,
          aspectFraming: {
            Square: { fit: "cover", zoom: 1.6, focalX: 0.3, focalY: 0.5 }
          }
        });
      await openGallery(page);
      await openSettings(page);
      await chooseDisplayMode(page, "Full view framing", "Original");
      await page.reload();
      await expect(
        page.getByRole("combobox", { name: "Full view framing", exact: true })
      ).toHaveText("Original");
      await openGallery(page);
      const viewer = await openViewer(page, 0);
      await expectViewerFraming(viewer, false);
      await setViewerOption(page, "Use saved framing", true);
      await expectViewerFraming(viewer, true);
      await nextViewerMedia(page, "sound-1.mp4");
      await expectViewerFraming(viewer, true);
      await page.keyboard.press("ArrowLeft");
      await expect(
        viewer.getByRole("heading", { name: "sound-0.mp4", exact: true })
      ).toBeVisible();
      await expectViewerFraming(viewer, true);
      await closeViewer(page);
      await openViewer(page, 2);
      await expectViewerFraming(viewer, false);
      await closeViewer(page);

      await openSettings(page);
      await chooseDisplayMode(page, "Full view framing", "Saved framing");
      await openGallery(page);
      await openViewer(page, 0);
      await expectViewerFraming(viewer, true);
      await setViewerOption(page, "Use saved framing", false);
      await expectViewerFraming(viewer, false);
      await nextViewerMedia(page, "sound-1.mp4");
      await expectViewerFraming(viewer, false);
      await closeViewer(page);
      await openViewer(page, 2);
      await expectViewerFraming(viewer, true);
      await closeViewer(page);

      await openSettings(page);
      await chooseDisplayMode(page, "Full view framing", "Remember last");
      await openGallery(page);
      await openViewer(page, 0);
      // Applying a fixed default does not overwrite the last explicit choice.
      await expectViewerFraming(viewer, false);
      await setViewerOption(page, "Use saved framing", true);
      await closeViewer(page);
      await page.reload();
      await openViewer(page, 1);
      await expectViewerFraming(viewer, true);
      await setViewerOption(page, "Use saved framing", false);
      await nextViewerMedia(page, "sound-2.mp4");
      await expectViewerFraming(viewer, false);
      await closeViewer(page);
      await openViewer(page, 0);
      await expectViewerFraming(viewer, false);
    } finally {
      for (const asset of assets)
        await setPresentation(page, asset, presentation);
      await context.close();
    }
  });

  test(`persists playback range defaults without replacing explicit links or resumed choices (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    const page = await context.newPage();
    try {
      await setPresentation(page, assets[0]!, {
        ...presentation,
        highlight: { startMs: 1000, endMs: 2000 }
      });
      await setPresentation(page, assets[2]!, {
        ...presentation,
        highlight: { startMs: 500, endMs: 1500 }
      });
      await openGallery(page);
      await openSettings(page);
      await chooseDisplayMode(page, "Playback range", "Highlights only");
      await page.reload();
      await expect(
        page.getByRole("combobox", { name: "Playback range", exact: true })
      ).toHaveText("Highlights only");
      await openGallery(page);
      const viewer = await openViewer(page, 0);
      await expectPlaybackRange(viewer, 1, 2);
      await nextViewerMedia(page, "sound-1.mp4");
      await expectPlaybackRange(viewer, 0, 4);
      await nextViewerMedia(page, "sound-2.mp4");
      await expectPlaybackRange(viewer, 0.5, 1.5);
      await closeViewer(page);

      const feed = await openFeed(page, 0);
      await expectPlaybackRange(feed, 1, 2);
      await openGallery(page);
      await openViewer(page, 0);
      await setViewerOption(page, "Play highlights only", false);
      await expectPlaybackRange(viewer, 0, 4);
      await page.reload();
      await expect(viewer).toBeVisible();
      await expectPlaybackRange(viewer, 0, 4);
      await page.goto(`${origin}/?launch=resume`);
      await expect(viewer).toBeVisible();
      await expectPlaybackRange(viewer, 0, 4);
      await page.goto(
        `${libraryUrl("gallery")}&highlight=0&asset=${encodeURIComponent(assets[0]!.id)}`
      );
      await expect(viewer).toBeVisible();
      await expectPlaybackRange(viewer, 0, 4);
      await closeViewer(page);

      await openSettings(page);
      await chooseDisplayMode(page, "Playback range", "Remember last");
      await openGallery(page);
      await openViewer(page, 0);
      await expectPlaybackRange(viewer, 0, 4);
      await setViewerOption(page, "Play highlights only", true);
      await expectPlaybackRange(viewer, 1, 2);
      await page.reload();
      await expectPlaybackRange(viewer, 1, 2);
      await closeViewer(page);

      await openSettings(page);
      await chooseDisplayMode(page, "Playback range", "Full media");
      await openGallery(page);
      await openViewer(page, 0);
      await expectPlaybackRange(viewer, 0, 4);
    } finally {
      for (const asset of assets)
        await setPresentation(page, asset, presentation);
      await context.close();
    }
  });
}

test("keeps an in-progress phone swipe when the first video frame replaces its poster", async ({
  browser
}) => {
  const context = await newContext(browser, true);
  await context.addInitScript(() => {
    const target = window as unknown as ViewerGestureTestWindow;
    target.viewerGestureTest = {
      holdFrames: true,
      pendingFrames: [],
      touchStarted: false
    };
    const requestFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      return requestFrame.call(this, (now, metadata) => {
        if (
          target.viewerGestureTest.holdFrames &&
          this.closest(".viewer-dialog")
        )
          target.viewerGestureTest.pendingFrames.push(() =>
            callback(now, metadata)
          );
        else callback(now, metadata);
      });
    };
    document.addEventListener(
      "touchstart",
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(".viewer-fit-area")
        )
          target.viewerGestureTest.touchStarted = true;
      },
      { capture: true }
    );
  });
  try {
    const page = await context.newPage();
    await openGallery(page);
    const viewer = await openViewer(page, 0);
    const poster = viewer.locator(".viewer-video-poster");
    await expect(poster).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as ViewerGestureTestWindow).viewerGestureTest
              .pendingFrames.length
        )
      )
      .toBeGreaterThan(0);
    await nextViewerMedia(page, "sound-1.mp4", async () => {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as ViewerGestureTestWindow).viewerGestureTest
                .touchStarted
          )
        )
        .toBe(true);
      await page.evaluate(() => {
        const state = (window as unknown as ViewerGestureTestWindow)
          .viewerGestureTest;
        state.holdFrames = false;
        for (const present of state.pendingFrames.splice(0)) present();
      });
      await expect(poster).toHaveCount(0);
    });
    await expectSound(viewer.locator("video"), true);
  } finally {
    await context.close();
  }
});

test("keeps newer viewer sound choices when an obsolete play request fails and preserves sound after an interrupted request", async ({
  browser
}) => {
  const context = await newContext(browser, false);
  try {
    const page = await context.newPage();
    await openGallery(page);
    await setModes(page, "Sound on", "Muted");
    await openGallery(page);
    await page.evaluate(() => {
      (window as unknown as SoundTestWindow).soundTest.nextViewerFailure =
        "deferred-policy";
    });
    const viewer = await openViewer(page, 0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as SoundTestWindow).soundTest.rejectViewer)
        )
      )
      .toBe(true);
    await viewer
      .getByRole("button", { name: "Mute video", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "Unmute video", exact: true })
      .click();
    await expectSound(viewer.locator("video"), false);
    await page.evaluate(async () => {
      (window as unknown as SoundTestWindow).soundTest.rejectViewer!();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await expectSound(viewer.locator("video"), false);
    await closeViewer(page);

    await page.evaluate(() => {
      (window as unknown as SoundTestWindow).soundTest.nextViewerFailure =
        "abort";
    });
    await openViewer(page, 1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as SoundTestWindow).soundTest.nextViewerFailure
        )
      )
      .toBeNull();
    await expectSound(viewer.locator("video"), false);
    await viewer.locator("video").evaluate((node: HTMLVideoElement) => {
      node.dispatchEvent(new Event("webkitbeginfullscreen"));
      node.muted = true;
      node.dispatchEvent(new Event("webkitendfullscreen"));
      node.dispatchEvent(new Event("volumechange"));
    });
    await expectRememberedSound(page, true, true);
    await closeViewer(page);
    await openSettings(page);
    await chooseMode(page, "Full view", "Remember last");
    await openGallery(page);
    await openViewer(page, 2);
    await expectSound(viewer.locator("video"), true);
  } finally {
    await context.close();
  }
});

async function newContext(browser: Browser, phone: boolean) {
  const context = await browser.newContext({
    storageState,
    viewport: phone
      ? { width: 393, height: 852 }
      : { width: 1440, height: 980 },
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: "reduce"
  });
  await context.addInitScript(() => {
    const target = window as unknown as SoundTestWindow;
    target.soundTest = {
      blockAudible:
        sessionStorage.getItem("aether.e2e.blockAudible") === "true",
      attempts: [],
      nextViewerFailure: null,
      rejectViewer: null
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const surface = this.closest(".viewer-dialog")
        ? "viewer"
        : this.closest(".feed-item")
          ? "feed"
          : "other";
      target.soundTest.attempts.push({
        surface,
        muted: this.muted,
        source: this.getAttribute("src") ?? ""
      });
      if (
        surface === "viewer" &&
        !this.muted &&
        target.soundTest.nextViewerFailure
      ) {
        const failure = target.soundTest.nextViewerFailure;
        target.soundTest.nextViewerFailure = null;
        if (failure === "abort")
          return Promise.reject(
            new DOMException("Playback was interrupted", "AbortError")
          );
        void play.call(this).catch(() => undefined);
        return new Promise<void>((_, reject) => {
          target.soundTest.rejectViewer = () =>
            reject(
              new DOMException("Sound requires a gesture", "NotAllowedError")
            );
        });
      }
      if (target.soundTest.blockAudible && !this.muted)
        return Promise.reject(
          new DOMException("Sound requires a gesture", "NotAllowedError")
        );
      return play.call(this);
    };
  });
  return context;
}

function libraryUrl(view: "gallery" | "feed" | "compare") {
  return `${origin}/?folder=${encodeURIComponent(folderId)}&view=${view}&type=video&sort=filename&size=large`;
}

async function openGallery(page: Page) {
  await page.goto(libraryUrl("gallery"));
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
}

async function openViewer(page: Page, index: number) {
  await page
    .getByRole("button", { name: `Open sound-${index}.mp4`, exact: true })
    .click();
  const viewer = page.locator(".viewer-dialog");
  await expect(viewer).toBeVisible();
  await expect(
    viewer.getByRole("heading", { name: `sound-${index}.mp4`, exact: true })
  ).toBeVisible();
  return viewer;
}

async function closeViewer(page: Page) {
  await page.getByRole("button", { name: "Close viewer", exact: true }).click();
  await expect(page.locator(".viewer-dialog")).toHaveCount(0);
}

async function nextViewerMedia(
  page: Page,
  name: string,
  afterTouchStart?: () => Promise<void>
) {
  const viewer = page.locator(".viewer-dialog");
  const next = viewer.getByRole("button", { name: "Next media", exact: true });
  if (await next.isVisible()) {
    await next.click();
  } else {
    const bounds = (await viewer.locator(".viewer-fit-area").boundingBox())!;
    const y = bounds.y + bounds.height * 0.5;
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: bounds.x + bounds.width * 0.8, y }]
      });
      await afterTouchStart?.();
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: bounds.x + bounds.width * 0.2, y }]
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: []
      });
    } finally {
      await session.detach();
    }
  }
  await expect(
    viewer.getByRole("heading", { name, exact: true })
  ).toBeVisible();
}

async function openFeed(
  page: Page,
  index: number,
  expectedSource: "original" | "bounce" = "original"
) {
  await page.goto(libraryUrl("feed"));
  return activateFeedItem(page, index, expectedSource);
}

async function activateFeedItem(
  page: Page,
  index: number,
  expectedSource: "original" | "bounce" = "original"
) {
  const item = page.locator(`.feed-item[data-feed-index="${index}"]`);
  await item.scrollIntoViewIfNeeded();
  await expect(item.locator("video")).toHaveAttribute(
    "data-preview-source",
    expectedSource
  );
  await expect(item.getByRole("slider")).toBeEnabled();
  return item;
}

async function openSettings(page: Page) {
  const sidebarToggle = page.getByRole("button", {
    name: "Toggle Sidebar",
    exact: true
  });
  if (!(await sidebarToggle.isVisible())) {
    await page
      .getByRole("button", { name: "Gallery view", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Gallery view" })
    ).toBeVisible();
  }
  await chooseAccountAction(page, "Settings");
  await page.getByRole("tab", { name: "Playback", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Full view", exact: true })
  ).toBeVisible();
}

async function chooseMode(
  page: Page,
  surface: "Full view" | "Feed",
  mode: SoundMode
) {
  await page.getByRole("combobox", { name: surface, exact: true }).click();
  await page.getByRole("option", { name: mode, exact: true }).click();
}

async function chooseDisplayMode(
  page: Page,
  label: "Full view framing" | "Playback range",
  mode: string
) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: mode, exact: true }).click();
}

async function setViewerOption(
  page: Page,
  name: "Use saved framing" | "Play highlights only",
  enabled: boolean
) {
  const viewer = page.locator(".viewer-dialog");
  await viewer.getByRole("button", { name: "Viewer view options" }).click();
  const menu = viewer.locator(".viewer-view-options");
  const option = menu.getByRole("menuitemcheckbox", { name, exact: true });
  await expect(option).toBeEnabled();
  if ((await option.getAttribute("aria-checked")) !== String(enabled))
    await option.click();
  await expect(option).toHaveAttribute("aria-checked", String(enabled));
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}

async function expectViewerFraming(viewer: Locator, saved: boolean) {
  await expect(viewer.locator("video")).toHaveCSS(
    "object-fit",
    saved ? "cover" : "contain"
  );
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate(
          (video) => new DOMMatrixReadOnly(getComputedStyle(video).transform).a
        )
    )
    .toBeCloseTo(saved ? 1.6 : 1, 4);
}

async function expectPlaybackRange(
  surface: Locator,
  minimum: number,
  maximum: number
) {
  const slider = surface.getByRole("slider");
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveAttribute("min", String(minimum));
  await expect
    .poll(async () => Number(await slider.getAttribute("max")))
    .toBeCloseTo(maximum, 1);
}

async function setModes(page: Page, fullView: SoundMode, feed: SoundMode) {
  await openSettings(page);
  await chooseMode(page, "Full view", fullView);
  await chooseMode(page, "Feed", feed);
}

async function expectSound(video: Locator, muted: boolean) {
  await expect(video).toHaveJSProperty("muted", muted);
  await expect
    .poll(() =>
      video.evaluate(
        (node: HTMLVideoElement) => !node.paused && node.currentTime > 0
      )
    )
    .toBe(true);
}

async function expectSettingsLayout(page: Page) {
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await expect
    .poll(() =>
      settings.evaluate(
        (node) =>
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          node.scrollWidth <= node.clientWidth + 1
      )
    )
    .toBe(true);
  for (const control of await settings.getByRole("combobox").all()) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    const bounds = (await control.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(120);
  }
  const tabs = await settings.getByRole("tab").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height
      };
    })
  );
  expect(tabs).toHaveLength(4);
  for (const [index, tab] of tabs.entries()) {
    expect(tab.left).toBeGreaterThanOrEqual(0);
    expect(tab.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(tab.height).toBeGreaterThanOrEqual(
      page.viewportSize()!.width < 768 ? 44 : 28
    );
    if (index > 0)
      expect(tab.left).toBeGreaterThanOrEqual(tabs[index - 1]!.right);
  }
}

async function expectRememberedSound(
  page: Page,
  fullView: boolean,
  feed: boolean
) {
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const value = JSON.parse(localStorage.getItem(key) ?? "null") as {
          fullView?: { lastMuted?: boolean };
          feed?: { lastMuted?: boolean };
        } | null;
        return [value?.fullView?.lastMuted, value?.feed?.lastMuted];
      }, preferenceKey)
    )
    .toEqual([fullView, feed]);
}

async function expectAudibleAttempt(page: Page, surface: "viewer" | "feed") {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          (window as unknown as SoundTestWindow).soundTest.attempts.some(
            (attempt) => attempt.surface === name && !attempt.muted
          ),
        surface
      )
    )
    .toBe(true);
}

async function setPresentation(
  page: Page,
  asset: AssetRecord,
  values: PresentationValues
) {
  const response = await page.request.get(`${origin}/api/assets/${asset.id}`);
  expect(response.ok()).toBe(true);
  const current = (await response.json()) as AssetRecord;
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const saved = await page.request.put(
    `${origin}/api/assets/${asset.id}/presentation`,
    {
      headers: { "x-csrf-token": token },
      data: { expectedRevision: current.presentation?.revision ?? 0, ...values }
    }
  );
  expect(saved.ok()).toBe(true);
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
