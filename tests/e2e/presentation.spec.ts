import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  expect,
  test,
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

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureFolder = "presentation-fixture";
const directory = path.resolve(".e2e", "media", fixtureFolder);
const defaults: PresentationValues = {
  highlight: null,
  fit: "auto",
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  playbackRate: 1,
  loopMode: "repeat"
};
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
    await sharp({
      create: { width: 240, height: 120, channels: 3, background: "#9cb7aa" }
    })
      .png()
      .toFile(path.join(directory, "photo.png"));
    await sharp(
      Buffer.concat([
        Buffer.alloc(40 * 40 * 3, 32),
        Buffer.alloc(40 * 40 * 3, 128),
        Buffer.alloc(40 * 40 * 3, 240)
      ]),
      {
        raw: { width: 40, height: 120, channels: 3, pageHeight: 40 },
        animated: true
      }
    )
      .webp({ loop: 0, delay: [300, 600, 900], effort: 0 })
      .toFile(path.join(directory, "sequence.webp"));
    await promisify(execFile)("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=240x120:rate=24",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      path.join(directory, "clip.mp4")
    ]);
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (entry) => entry.relativePath === fixtureFolder
    )!.id;
    assets = (
      (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse
    ).items;
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

test("saves and cancels framing and keeps the comparison pair while changing its shape", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, defaults);
    await open(page, "gallery", "image");
    const card = page.locator(".media-tile").filter({ hasText: photo.name });
    await card.hover();
    await card
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: testInfo.outputPath("presentation-editor-desktop.png")
    });
    await editor
      .getByRole("combobox", { name: "Framing", exact: true })
      .click();
    await page.getByRole("option", { name: "Fill", exact: true }).click();
    await editor.getByRole("slider", { name: "Media zoom" }).focus();
    await page.keyboard.press("ArrowRight");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await getAsset(page, photo.id)).presentation).toMatchObject(
      defaults
    );

    await card.hover();
    await card
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    await editor.getByRole("slider", { name: "Media zoom" }).focus();
    await page.keyboard.press("ArrowRight");
    await editor
      .getByRole("application", { name: /^Media position/ })
      .press("ArrowRight");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const saved = (await getAsset(page, photo.id)).presentation!;
    expect(saved.zoom).toBeGreaterThan(1);
    expect(saved.focalX).not.toBe(0.5);
    await page.reload();
    await card.hover();
    await card
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    await expect(
      editor.getByRole("slider", { name: "Media zoom" })
    ).toHaveAttribute("aria-valuenow", String(saved.zoom));
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);

    const timedAssets = [fixture("clip.mp4"), fixture("sequence.webp")];
    for (const timedAsset of timedAssets)
      await setPresentation(page, timedAsset, {
        ...defaults,
        highlight: { startMs: 300, endMs: 1200 },
        playbackRate: 2,
        loopMode: "bounce"
      });
    await open(page, "compare", "all", "", true);
    await page
      .locator(".leaderboard-header")
      .getByRole("button", { name: "Rank media", exact: true })
      .click();
    const cards = page.locator(".comparison-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.locator(".comparison-choose-surface")).toHaveCount(2);
    const pairNames = await cards
      .locator(".comparison-choose-surface")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label"))
      );
    const timedAsset = timedAssets.find((item) =>
      pairNames.includes(`Choose ${item.name}`)
    )!;
    await cards
      .filter({
        has: page.getByRole("button", {
          name: `Choose ${timedAsset.name}`,
          exact: true
        })
      })
      .getByRole("button", {
        name: `Open ${timedAsset.name} fullscreen`,
        exact: true
      })
      .click();
    const viewer = page.getByRole("dialog", {
      name: timedAsset.name,
      exact: true
    });
    await expect(viewer).toBeVisible();
    if (timedAsset.mediaType === "video") {
      const video = viewer.locator("video");
      await expect(video).toHaveAttribute("src", /media$/);
      await expect
        .poll(() =>
          video.evaluate((node: HTMLVideoElement) => node.playbackRate)
        )
        .toBe(1);
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.duration))
        .toBeGreaterThan(5.9);
    } else {
      const seek = viewer.getByRole("slider", {
        name: "Seek animation",
        exact: true
      });
      await expect(seek).toHaveAttribute("max", "1.8");
      await expect(seek).toHaveAttribute("min", "0");
      await expect(viewer.locator(".video-controls__section")).toHaveCount(0);
    }
    await viewer
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();
    await expect(viewer).toHaveCount(0);
    expect(
      await cards
        .locator(".comparison-choose-surface")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label"))
        )
    ).toEqual(pairNames);
    await page
      .getByRole("button", { name: "Comparison aspect ratio", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Square", exact: true })
      .click();
    await expect(cards.first()).toHaveAttribute("data-aspect", "Square");
    const bounds = (await cards.first().boundingBox())!;
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(2);
    await cards
      .first()
      .getByRole("button", { name: /^Edit / })
      .click();
    await expect(editor).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await cards
        .locator(".comparison-choose-surface")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label"))
        )
    ).toEqual(pairNames);
    await page.reload();
    await expect(page.locator(".comparison-card").first()).toHaveAttribute(
      "data-aspect",
      "Square"
    );
  } finally {
    await context.close();
  }
});

test("preserves the draft after a concurrent edit and reloads explicitly before saving", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, defaults);
    await open(page, "gallery", "image", photo.name);
    const card = page.locator(".media-tile").filter({ hasText: photo.name });
    await card.hover();
    await card
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    const zoom = editor.getByRole("slider", {
      name: "Media zoom",
      exact: true
    });
    await zoom.press("ArrowRight");
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
    await setPresentation(page, photo, {
      ...defaults,
      zoom: 1.8,
      fit: "cover"
    });
    const concurrent = await getAsset(page, photo.id);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      editor.getByText(
        "These settings changed in another window. Reload them before saving.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
    await zoom.press("ArrowRight");
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.02");
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
    expect((await getAsset(page, photo.id)).presentation?.revision).toBe(
      concurrent.presentation!.revision
    );
    await editor
      .getByRole("button", { name: "Reload saved settings", exact: true })
      .click();
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.8");
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
    await zoom.press("ArrowRight");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await getAsset(page, photo.id)).presentation).toMatchObject({
      zoom: 1.81,
      revision: concurrent.presentation!.revision + 1
    });
  } finally {
    await context.close();
  }
});

test("reconciles a committed save after its response is lost without issuing another write", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, defaults);
    const before = await getAsset(page, photo.id);
    await open(page, "gallery", "image", photo.name);
    const card = page.locator(".media-tile").filter({ hasText: photo.name });
    await card.hover();
    await card
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await editor
      .getByRole("slider", { name: "Media zoom", exact: true })
      .press("ArrowRight");
    let writes = 0;
    await page.route(
      `**/api/assets/${photo.id}/presentation`,
      async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        writes += 1;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("connectionreset");
      }
    );
    const reconciled = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith(`/api/assets/${photo.id}`)
    );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    expect((await reconciled).ok()).toBe(true);
    await expect(editor).toHaveCount(0);
    expect(writes).toBe(1);
    expect((await getAsset(page, photo.id)).presentation).toMatchObject({
      zoom: 1.01,
      revision: before.presentation!.revision + 1
    });
  } finally {
    await context.close();
  }
});

test("edits playback from mobile Feed and keeps safe controls together through highlight and bounce playback", async ({
  browser,
  browserName
}, testInfo) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const cdp =
      browserName === "chromium" ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 59, bottom: 34, left: 0, right: 0 }
      });
    }
    const video = fixture("clip.mp4");
    await setPresentation(page, video, defaults);
    await open(page, "feed", "video");
    const rail = page.getByRole("group", {
      name: "Feed navigation",
      exact: true
    });
    const edit = rail.getByRole("button", {
      name: `Edit ${video.name}`,
      exact: true
    });
    await expect(edit).toBeVisible();
    await expect(
      rail.getByRole("button", { name: "Next feed item" })
    ).toBeHidden();
    const bounds = (await edit.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(852 - 34);
    await edit.tap();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("textbox", { name: "Start time", exact: true })
    ).toBeEnabled();
    await expectEditorBounds(editor, 393, 852, {
      top: cdp ? 59 : 0,
      bottom: cdp ? 34 : 0,
      left: 0,
      right: 0
    });
    await page.setViewportSize({ width: 852, height: 393 });
    if (cdp)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 0, bottom: 21, left: 59, right: 59 }
      });
    await expectEditorBounds(editor, 852, 393, {
      top: 0,
      bottom: cdp ? 21 : 0,
      left: cdp ? 59 : 0,
      right: cdp ? 59 : 0
    });
    await editor
      .getByRole("combobox", { name: "Loop", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(editor.locator(".media-editor-header")).toBeInViewport({
      ratio: 1
    });
    await expect(editor.locator(".media-editor-footer")).toBeInViewport({
      ratio: 1
    });
    await expect(
      editor.getByRole("button", { name: "Cancel", exact: true })
    ).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 393, height: 852 });
    if (cdp)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 59, bottom: 34, left: 0, right: 0 }
      });
    await expectEditorBounds(editor, 393, 852, {
      top: cdp ? 59 : 0,
      bottom: cdp ? 34 : 0,
      left: 0,
      right: 0
    });
    await page.screenshot({
      path: testInfo.outputPath("presentation-editor-phone.png")
    });
    await editor
      .getByRole("textbox", { name: "Start time", exact: true })
      .fill("0.5");
    await editor
      .getByRole("textbox", { name: "End time", exact: true })
      .fill("2");
    await editor.getByRole("combobox", { name: "Speed", exact: true }).click();
    await page.getByRole("option", { name: "1.5×", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).tap();
    await expect(editor).toHaveCount(0);
    expect((await getAsset(page, video.id)).presentation).toMatchObject({
      highlight: { startMs: 500, endMs: 2000 },
      playbackRate: 1.5,
      loopMode: "repeat"
    });
    await page.getByRole("button", { name: /^View options/ }).tap();
    const options = page.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await options
      .getByRole("checkbox", { name: "Play highlights only", exact: true })
      .check();
    await options.getByRole("button", { name: "Close view options" }).tap();
    const media = page.locator(".feed-item video").first();
    await expect(media).toHaveAttribute("src", /playback\?variant=highlight/);
    await expect
      .poll(() => media.evaluate((node: HTMLVideoElement) => node.playbackRate))
      .toBe(1.5);
    await expect(
      page.getByText("Looping highlight", { exact: true })
    ).toBeVisible();
    const toggle = page
      .locator(".feed-item .media-video-playback-toggle")
      .first();
    await toggle.tap();
    await expect(rail).toBeHidden();
    await expect(page.locator(".feed-view-controls")).toBeHidden();
    await expect(
      page.locator(".feed-item .video-controls").first()
    ).toBeHidden();
    await toggle.tap();
    await expect(edit).toBeVisible();
    await edit.tap();
    await editor.getByRole("combobox", { name: "Loop", exact: true }).click();
    await page.getByRole("option", { name: "Bounce", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).tap();
    await expect(editor).toHaveCount(0);
    await expect(media).toHaveAttribute("src", /playback\?variant=bounce/);
    await expect(page.getByText("Bounce", { exact: true })).toBeVisible();
    await expect
      .poll(() => media.evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(await page.locator("button button").count()).toBe(0);
  } finally {
    await context.close();
  }
});

test("controls an edited animation and selectively resets playback and framing while preserving annotations", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const animation = fixture("sequence.webp");
    const photo = fixture("photo.png");
    await setPresentation(page, animation, defaults);
    await setPresentation(page, photo, {
      ...defaults,
      fit: "cover",
      zoom: 1.6
    });
    await page.request.patch(`${origin}/api/assets/${photo.id}/score`, {
      headers: await csrf(page),
      data: { score: 9, favorite: true }
    });
    await page.request.put(`${origin}/api/assets/${photo.id}/tags`, {
      headers: await csrf(page),
      data: { tags: ["Keep"] }
    });
    await open(page, "gallery", "image");
    const card = page
      .locator(".media-tile")
      .filter({ hasText: animation.name });
    await card.hover();
    await card
      .getByRole("button", { name: `Edit ${animation.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await editor
      .getByRole("textbox", { name: "Start time", exact: true })
      .fill("0.2");
    await editor
      .getByRole("textbox", { name: "End time", exact: true })
      .fill("1.2");
    await editor.getByRole("combobox", { name: "Speed", exact: true }).click();
    await page.getByRole("option", { name: "0.5×", exact: true }).click();
    await editor.getByRole("combobox", { name: "Loop", exact: true }).click();
    await page.getByRole("option", { name: "Bounce", exact: true }).click();
    // Scrubbing remains on the complete source while playback auditions the highlight.
    await editor
      .getByRole("slider", { name: "Preview position", exact: true })
      .press("End");
    const previewCanvas = editor.locator("canvas");
    await expect(previewCanvas).toHaveCSS("opacity", "1");
    await expect
      .poll(() =>
        previewCanvas.evaluate(
          (node: HTMLCanvasElement) =>
            node.getContext("2d")!.getImageData(20, 20, 1, 1).data[0]
        )
      )
      .toBeGreaterThan(230);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const canvas = card.getByRole("img", { name: animation.name, exact: true });
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveCSS("opacity", "1");
    await open(page, "feed", "image", animation.name);
    const controls = page.locator(".feed-item .video-controls").first();
    await expect(controls).toBeVisible();
    await controls
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    await expect(page.locator(".feed-item").first()).not.toHaveClass(
      /details-hidden/
    );
    await page.locator(".feed-image-tap-surface").first().click();
    await expect(controls).toBeHidden();
    await page.locator(".feed-image-tap-surface").first().click();
    await expect(controls).toBeVisible();
    expect(await page.locator("button button").count()).toBe(0);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Database", exact: true }).click();
    await resetSelected(page, "Highlights and playback");
    expect((await getAsset(page, animation.id)).presentation).toMatchObject({
      highlight: null,
      playbackRate: 1,
      loopMode: "repeat"
    });
    expect((await getAsset(page, photo.id)).presentation?.zoom).toBe(1.6);
    await resetSelected(page, "Position and zoom");
    expect(await getAsset(page, photo.id)).toMatchObject({
      score: 9,
      favorite: true,
      tags: [{ displayName: "Keep" }],
      presentation: { fit: "auto", focalX: 0.5, focalY: 0.5, zoom: 1 }
    });
  } finally {
    await context.close();
  }
});

test("retries animation preparation in Feed and preserves an editor draft through recovery", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const animation = fixture("sequence.webp");
    await setPresentation(page, animation, defaults);
    let atlasReads = 0;
    await page.route(
      `**/api/assets/${animation.id}/animation/atlases/*`,
      async (route) => {
        atlasReads += 1;
        if (atlasReads === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "processing_busy" })
          });
        } else await route.continue();
      }
    );
    await open(page, "feed", "image", animation.name);
    const feedAnimation = page
      .locator(".feed-item .controlled-animation")
      .first();
    const retry = feedAnimation.getByRole("button", {
      name: "Retry",
      exact: true
    });
    await expect(retry).toBeVisible();
    expect(atlasReads).toBe(1);
    await retry.click();
    await expect(feedAnimation.locator("canvas")).toHaveCSS("opacity", "1");
    await expect(retry).toHaveCount(0);
    expect(atlasReads).toBe(2);

    let manifestReads = 0;
    await page.route(
      `**/api/assets/${animation.id}/animation?*`,
      async (route) => {
        manifestReads += 1;
        if (manifestReads === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "processing_busy" })
          });
        } else await route.continue();
      }
    );
    await page
      .getByRole("group", { name: "Feed navigation", exact: true })
      .getByRole("button", { name: `Edit ${animation.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    const end = editor.getByRole("textbox", { name: "End time", exact: true });
    await end.fill("1.2");
    const editorRetry = editor.getByRole("button", {
      name: "Retry",
      exact: true
    });
    await expect(editorRetry).toBeVisible();
    expect(manifestReads).toBe(1);
    await editor.getByRole("tab", { name: "Framing", exact: true }).click();
    await editorRetry.click();
    await expect(editor.locator("canvas")).toHaveCSS("opacity", "1");
    await expect(editorRetry).toHaveCount(0);
    await editor.getByRole("tab", { name: "Playback", exact: true }).click();
    await expect(end).toHaveValue("0:01.200");
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeEnabled();
    expect(manifestReads).toBe(2);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await getAsset(page, animation.id)).presentation).toMatchObject(
      defaults
    );
    expect(await page.locator("button button").count()).toBe(0);
  } finally {
    await context.close();
  }
});

async function expectEditorBounds(
  editor: Locator,
  width: number,
  height: number,
  insets: { top: number; bottom: number; left: number; right: number }
) {
  await expect(editor).toBeInViewport({ ratio: 1 });
  const bounds = (await editor.boundingBox())!;
  expect(
    bounds.x,
    "Editor left edge respects the safe area"
  ).toBeGreaterThanOrEqual(insets.left - 1);
  expect(
    bounds.y,
    "Editor top edge respects the safe area"
  ).toBeGreaterThanOrEqual(insets.top - 1);
  expect(
    bounds.x + bounds.width,
    "Editor right edge stays in the viewport"
  ).toBeLessThanOrEqual(width - insets.right + 1);
  expect(
    bounds.y + bounds.height,
    "Editor bottom edge stays in the viewport"
  ).toBeLessThanOrEqual(height + 1);
  const save = (await editor
    .getByRole("button", { name: "Save", exact: true })
    .boundingBox())!;
  expect(
    save.y + save.height,
    "Save remains above the Home indicator"
  ).toBeLessThanOrEqual(height - insets.bottom + 1);
}

function fixture(name: string): AssetRecord {
  return assets.find((asset) => asset.name === name)!;
}
async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}
async function getAsset(page: Page, id: string): Promise<AssetRecord> {
  return (await page.request.get(`${origin}/api/assets/${id}`)).json();
}
async function setPresentation(
  page: Page,
  asset: AssetRecord,
  values: PresentationValues
) {
  const current = await getAsset(page, asset.id);
  const result = await page.request.put(
    `${origin}/api/assets/${asset.id}/presentation`,
    {
      headers: await csrf(page),
      data: { expectedRevision: current.presentation?.revision ?? 0, ...values }
    }
  );
  expect(result.ok()).toBe(true);
}
async function open(
  page: Page,
  view: string,
  type: string,
  search = "",
  highlightsOnly = false
) {
  await page.goto(
    `${origin}/?folder=${encodeURIComponent(folderId)}&view=${view}&type=${type}&sort=filename&size=large&q=${encodeURIComponent(search)}${highlightsOnly ? "&highlight=1" : ""}`
  );
}
async function resetSelected(page: Page, label: string) {
  await page.getByRole("checkbox", { name: new RegExp(label) }).check();
  await page
    .getByRole("button", { name: "Reset selected data", exact: true })
    .click();
  await page
    .getByLabel("Type RESET to continue", { exact: true })
    .fill("RESET");
  const done = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/database/reset") &&
      response.request().method() === "POST"
  );
  await page
    .getByRole("button", { name: "Reset permanently", exact: true })
    .click();
  expect((await done).ok()).toBe(true);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
}
async function scan(page: Page) {
  const result = await page.request.post(`${origin}/api/admin/scan`, {
    headers: await csrf(page)
  });
  expect(result.status()).toBe(202);
  const { jobId } = (await result.json()) as { jobId: string };
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
