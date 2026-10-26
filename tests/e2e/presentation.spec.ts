import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
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
  aspectFraming: {},
  feedFraming: {},
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
    await expect(
      card.getByRole("button", { name: `Edit ${photo.name}`, exact: true })
    ).toHaveCount(0);
    await expect(card.getByRole("link", { name: /Download/ })).toHaveCount(0);
    await openGalleryEditor(page, photo);
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
    await expect(page.getByRole("option")).toHaveText(["Fit", "Fill"]);
    await page.getByRole("option", { name: "Fill", exact: true }).click();
    await expect(editor.locator(".media-editor-grid")).toBeVisible();
    await editor
      .getByRole("combobox", { name: "Framing", exact: true })
      .click();
    await page.getByRole("option", { name: "Fit", exact: true }).click();
    await expect(editor.locator(".media-editor-grid")).toBeVisible();
    await expect(
      editor.getByRole("application", { name: /^Media position/ })
    ).toHaveCount(0);
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

    await openGalleryEditor(page, photo);
    await editor.getByRole("slider", { name: "Media zoom" }).focus();
    await page.keyboard.press("ArrowRight");
    await editor
      .getByRole("application", { name: /^Media position/ })
      .press("ArrowRight");
    const zoom = editor.getByRole("slider", {
      name: "Media zoom",
      exact: true
    });
    for (const [aspect, expected] of [
      ["Portrait", "1"],
      ["Landscape", "1"],
      ["Square", "1.01"]
    ]) {
      await editor
        .getByRole("combobox", { name: "Media layout", exact: true })
        .click();
      await page.getByRole("option", { name: aspect, exact: true }).click();
      await expect(zoom).toHaveAttribute("aria-valuenow", expected);
      if (aspect === "Landscape") await zoom.press("ArrowRight");
      if (aspect === "Portrait" || aspect === "Landscape") {
        await zoom.press("ArrowRight");
        await zoom.press("ArrowRight");
      }
    }
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const saved = (await getAsset(page, photo.id)).presentation!;
    expect(saved.aspectFraming?.Square?.zoom).toBeGreaterThan(1);
    expect(saved.aspectFraming?.Square?.focalX).not.toBe(0.5);
    expect(saved.zoom).toBe(1);
    expect(saved.aspectFraming?.Portrait?.zoom).toBe(1.02);
    expect(saved.aspectFraming?.Landscape?.zoom).toBe(1.03);
    const viewerPhoto = page
      .getByRole("dialog", { name: photo.name, exact: true })
      .locator(".viewer-media-frame > img");
    await expect(viewerPhoto).toHaveCSS("object-fit", "contain");
    await expect(viewerPhoto).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 0, 0)"
    );
    await page.reload();
    await openGalleryEditor(page, photo);
    await expect(
      editor.getByRole("slider", { name: "Media zoom" })
    ).toHaveAttribute(
      "aria-valuenow",
      String(saved.aspectFraming!.Square!.zoom)
    );
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);

    await page
      .getByRole("dialog", { name: photo.name, exact: true })
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();
    for (const [shape, scale] of [
      ["Square", 1.01],
      ["Portrait", 1.02],
      ["Landscape", 1.03],
      ["Original", 1]
    ] as const) {
      await setLayoutAspect(page, shape);
      await expect(card.locator(".media-image").first()).toHaveCSS(
        "transform",
        `matrix(${scale}, 0, 0, ${scale}, 0, 0)`
      );
    }
    await open(page, "feed", "image", photo.name);
    await expect(page.locator(".feed-item .media-image").first()).toHaveCSS(
      "transform",
      "matrix(1.02, 0, 0, 1.02, 0, 0)"
    );

    const timedAssets = [fixture("clip.mp4"), fixture("sequence.webp")];
    for (const timedAsset of timedAssets)
      await setPresentation(page, timedAsset, {
        ...defaults,
        highlight: { startMs: 300, endMs: 1200 },
        playbackRate: 2,
        loopMode: "bounce"
      });
    await open(page, "compare", "all");
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
      await expect(video).toHaveAttribute("src", /media(?:\?|$)/);
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
    await page.getByRole("button", { name: /^View options/ }).click();
    const options = page.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await options.getByRole("tab", { name: "Layout", exact: true }).click();
    await options
      .getByRole("combobox", { name: "Media layout", exact: true })
      .click();
    await page.getByRole("option", { name: "Square", exact: true }).click();
    await options
      .getByRole("button", { name: "Close view options", exact: true })
      .click();
    await expect(cards.first()).toHaveAttribute("data-aspect", "Square");
    const bounds = (await cards.first().boundingBox())!;
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(2);
    await expect(cards.getByRole("button", { name: /^Edit / })).toHaveCount(0);
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
    await openGalleryEditor(page, photo);
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
      aspectFraming: {
        Square: { zoom: 1.8, fit: "cover", focalX: 0.5, focalY: 0.5 }
      }
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
      aspectFraming: { Square: { zoom: 1.81 } },
      revision: concurrent.presentation!.revision + 1
    });
  } finally {
    await context.close();
  }
});

for (const status of [415, 422]) {
  test(`reloads concurrent framing edits when playback capabilities return ${status}`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState });
    try {
      const page = await context.newPage();
      const photo = fixture("photo.png");
      await setPresentation(page, photo, defaults);
      await page.route(
        `**/api/assets/${photo.id}/presentation-media`,
        (route) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                status === 415
                  ? "presentation_source_not_supported"
                  : "presentation_limit_exceeded"
            })
          })
      );
      await open(page, "gallery", "image", photo.name);
      await openGalleryEditor(page, photo);
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await expect(
        editor.getByText("Playback editing is unavailable for this file.", {
          exact: true
        })
      ).toBeVisible();
      const zoom = editor.getByRole("slider", {
        name: "Media zoom",
        exact: true
      });
      await zoom.press("ArrowRight");
      await setPresentation(page, photo, {
        ...defaults,
        aspectFraming: {
          Square: { zoom: 1.8, fit: "cover", focalX: 0.5, focalY: 0.5 }
        }
      });
      const concurrent = await getAsset(page, photo.id);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      const reload = editor.getByRole("button", {
        name: "Reload saved settings",
        exact: true
      });
      await expect(reload).toBeVisible();
      await reload.click();
      await expect(zoom).toHaveAttribute("aria-valuenow", "1.8");
      await expect(reload).toHaveCount(0);
      await expect(
        editor.getByRole("button", { name: "Save", exact: true })
      ).toBeDisabled();
      await zoom.press("ArrowRight");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, photo.id)).presentation).toMatchObject({
        aspectFraming: { Square: { zoom: 1.81 } },
        revision: concurrent.presentation!.revision + 1
      });
    } finally {
      await context.close();
    }
  });
}

for (const view of ["gallery", "compare"] as const) {
  test(`offers only Fit and Fill and preserves legacy framing from ${view}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      reducedMotion: "reduce",
      hasTouch: view === "compare",
      viewport:
        view === "compare"
          ? { width: 393, height: 852 }
          : { width: 1440, height: 980 }
    });
    try {
      const page = await context.newPage();
      const photo = fixture("photo.png");
      await setPresentation(page, photo, { ...defaults, zoom: 2, focalX: 0.2 });
      const saved = (await getAsset(page, photo.id)).presentation;
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=${view}&type=image&aspect=original&asset=${photo.id}`
      );
      await openGalleryEditor(page, photo);
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      const framing = editor.getByRole("combobox", {
        name: "Framing",
        exact: true
      });
      const zoom = editor.getByRole("slider", {
        name: "Media zoom",
        exact: true
      });
      await expect(framing).toHaveText(view === "compare" ? "Fit" : "Fill");
      await expect(zoom).toHaveAttribute(
        "aria-valuenow",
        view === "compare" ? "1" : "2"
      );
      await expect(
        editor.getByRole("button", { name: "Save", exact: true })
      ).toBeDisabled();
      await framing.click();
      await expect(page.getByRole("option")).toHaveText(["Fit", "Fill"]);
      await page.keyboard.press("Escape");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, photo.id)).presentation).toEqual(saved);
      await openGalleryEditor(page, photo);
      await framing.click();
      await page
        .getByRole("option", {
          name: view === "compare" ? "Fill" : "Fit",
          exact: true
        })
        .click();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, photo.id)).presentation?.fit).toBe(
        view === "compare" ? "cover" : "contain"
      );
    } finally {
      await context.close();
    }
  });
}

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
    await openGalleryEditor(page, photo);
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
      aspectFraming: { Square: { zoom: 1.01 } },
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
    await expect(media).toHaveAttribute("src", /\/media(?:\?|$)/);
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
    await openGalleryEditor(page, animation);
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
    await page
      .getByRole("dialog", { name: animation.name, exact: true })
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();
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

test("keeps video and animation playback and seeking available across editor tabs", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    for (const name of ["clip.mp4", "sequence.webp"]) {
      const asset = fixture(name);
      await setPresentation(page, asset, defaults);
      await open(page, "feed", asset.mediaType, name);
      await page
        .getByRole("button", { name: `Edit ${name}`, exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      const preview = editor.locator(name.endsWith("mp4") ? "video" : "canvas");
      await expect(preview).toBeVisible();
      await preview.evaluate((node) => {
        node.dataset.continuity = "same-preview";
      });
      const timeline = editor.getByRole("slider", {
        name: "Preview position",
        exact: true
      });
      await editor
        .getByRole("button", { name: "Play preview", exact: true })
        .click();
      await expect
        .poll(async () => Number(await timeline.getAttribute("aria-valuenow")))
        .toBeGreaterThan(100);
      await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      await expect(
        editor.getByRole("button", { name: "Pause preview", exact: true })
      ).toBeVisible();
      await expect(preview).toHaveAttribute("data-continuity", "same-preview");
      await timeline.press("End");
      await expect(
        editor.getByRole("button", { name: "Play preview", exact: true })
      ).toBeVisible();
      await expect
        .poll(async () => Number(await timeline.getAttribute("aria-valuenow")))
        .toBeGreaterThan(name.endsWith("mp4") ? 5000 : 1500);
      await editor.getByRole("tab", { name: "Playback", exact: true }).click();
      await expect(preview).toHaveAttribute("data-continuity", "same-preview");
      await editor
        .getByRole("textbox", { name: "Start time", exact: true })
        .fill("invalid");
      await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      await editor
        .getByRole("slider", { name: "Media zoom", exact: true })
        .press("ArrowRight");
      await expect(
        editor.getByRole("button", { name: "Save", exact: true })
      ).toBeDisabled();
      await editor.getByRole("tab", { name: "Playback", exact: true }).click();
      await expect(
        editor.getByRole("textbox", { name: "Start time", exact: true })
      ).toHaveValue("invalid");
      await editor
        .getByRole("textbox", { name: "Start time", exact: true })
        .fill("0");
      await timeline.press("Home");
      if (name.endsWith("mp4")) {
        await preview.evaluate((node: HTMLVideoElement) => {
          node.play = () =>
            Promise.reject(
              new DOMException("Unavailable", "NotSupportedError")
            );
        });
        await editor
          .getByRole("button", { name: "Play preview", exact: true })
          .click();
        await expect(
          editor.getByText("Could not play this preview. Try Play again.", {
            exact: true
          })
        ).toBeVisible();
        await expect(
          editor.getByRole("button", { name: "Play preview", exact: true })
        ).toBeVisible();
        await preview.evaluate((node) => {
          Reflect.deleteProperty(node, "play");
        });
      }
      await editor
        .getByRole("button", { name: "Play preview", exact: true })
        .click();
      await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      await expect
        .poll(async () => Number(await timeline.getAttribute("aria-valuenow")))
        .toBeGreaterThan(100);
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      expect((await getAsset(page, asset.id)).presentation).toMatchObject(
        defaults
      );
    }
  } finally {
    await context.close();
  }
});

test("keeps Feed portrait with attached controls, inline favorite info and saved Portrait edits", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    storageState,
    hasTouch: true,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    const frame = { fit: "cover" as const, focalX: 0.5, focalY: 0.5, zoom: 1 };
    const aspectFraming = {
      Portrait: { ...frame, zoom: 1.1 },
      Square: { ...frame, zoom: 1.3 }
    };
    await setPresentation(page, photo, {
      ...defaults,
      aspectFraming,
      feedFraming: { portrait: { ...frame, zoom: 3 } }
    });
    await open(page, "feed", "image", photo.name);
    await page.goto(`${page.url()}&aspect=fill`);
    const item = page.locator(".feed-item").first();
    const card = item.locator(".feed-frame");
    const media = card.locator(".media-image").first();
    await expect(item).toHaveAttribute("data-aspect", "Portrait");
    await expect(media).toHaveCSS("transform", "matrix(1.1, 0, 0, 1.1, 0, 0)");
    const rail = page.getByRole("group", {
      name: "Feed navigation",
      exact: true
    });
    const favorite = rail.locator(".favorite-button");
    if ((await favorite.getAttribute("aria-pressed")) === "false")
      await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^View options/ }).click();
    const options = page.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await options.getByRole("tab", { name: "Layout", exact: true }).click();
    await expect(
      options.getByRole("combobox", { name: "Media layout", exact: true })
    ).toHaveCount(0);
    await options.getByRole("checkbox", { name: "Title", exact: true }).check();
    await options.getByRole("checkbox", { name: "Heart", exact: true }).check();
    await options
      .getByRole("button", { name: "Close view options", exact: true })
      .click();
    const caption = card.locator(".media-card-favorite");
    await expect(caption).toBeVisible();
    await expect(caption).toHaveCSS("display", "flex");
    const captionBounds = (await caption.boundingBox())!;
    const iconBounds = (await caption.locator("svg").boundingBox())!;
    expect(
      Math.abs(
        iconBounds.y +
          iconBounds.height / 2 -
          captionBounds.y -
          captionBounds.height / 2
      )
    ).toBeLessThan(1);
    const cardBounds = (await card.boundingBox())!;
    const railBounds = (await rail.boundingBox())!;
    expect(cardBounds.width).toBeLessThanOrEqual(470);
    expect(cardBounds.width).toBeLessThan(cardBounds.height);
    expect(railBounds.x).toBeGreaterThan(cardBounds.x + cardBounds.width);
    await page.screenshot({
      path: testInfo.outputPath("feed-portrait-desktop.png")
    });
    await rail
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(
      editor.getByRole("combobox", { name: "Media layout", exact: true })
    ).toHaveText("Portrait");
    await editor
      .getByRole("slider", { name: "Media zoom", exact: true })
      .press("ArrowRight");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(media).toHaveCSS(
      "transform",
      "matrix(1.11, 0, 0, 1.11, 0, 0)"
    );
    const saved = (await getAsset(page, photo.id)).presentation!;
    expect(saved.aspectFraming?.Square?.zoom).toBe(1.3);
    expect(saved.feedFraming?.portrait?.zoom).toBe(3);
    await page.reload();
    await expect(item).toHaveAttribute("data-aspect", "Portrait");
    for (const viewport of [
      { width: 393, height: 852 },
      { width: 852, height: 393 }
    ]) {
      await page.setViewportSize(viewport);
      const cardBounds = (await card.boundingBox())!;
      const favoriteBounds = (await favorite.boundingBox())!;
      expect(cardBounds.width).toBeCloseTo(viewport.width, 0);
      expect(favoriteBounds.x).toBeGreaterThanOrEqual(cardBounds.x);
      expect(favoriteBounds.x + favoriteBounds.width).toBeLessThanOrEqual(
        cardBounds.x + cardBounds.width
      );
      await expect(caption).toHaveCSS("display", "flex");
    }
    await page.screenshot({
      path: testInfo.outputPath("feed-portrait-phone-landscape.png")
    });
  } finally {
    await context.close();
  }
});

test("keeps the fullscreen editor shell consistent through loading, cancellation, failure and retry", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce"
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await open(page, "feed", "image", photo.name);
    const endpoint = `**/api/assets/${photo.id}/presentation-media`;
    await page.route(
      "**/assets/MediaPresentationEditor-*.js",
      async (route) => {
        await gate;
        await route.continue().catch(() => undefined);
      }
    );
    await page.route(endpoint, async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await page
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(
      editor.getByText("Opening media…", { exact: true })
    ).toBeVisible();
    await expect(editor.locator(".media-editor-header")).toContainText(
      photo.name
    );
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
    await expectEditorBounds(editor, 393, 852, {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    });
    await page.screenshot({
      path: testInfo.outputPath("editor-loading-phone.png")
    });
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(editor).toHaveCount(0);
    let failCapabilities = true;
    await page.route(endpoint, async (route) => {
      if (failCapabilities) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"unavailable"}'
        });
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const retry = editor.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    const size = (await retry.boundingBox())!;
    expect(size.width).toBeLessThan(160);
    expect(size.height).toBeGreaterThanOrEqual(44);
    failCapabilities = false;
    await retry.click();
    await expect(
      editor.getByRole("slider", { name: "Media zoom", exact: true })
    ).toBeEnabled();
    await expect(
      editor.getByRole("heading", { name: "Edit media", exact: true })
    ).toHaveCount(1);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    release();
    await context.close();
  }
});

test("keeps editor code-loading failures inside a dismissible dialog", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    serviceWorkers: "block"
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await page.route("**/assets/MediaPresentationEditor-*.js", (route) =>
      route.fulfill({ status: 503, contentType: "text/javascript", body: "" })
    );
    await open(page, "feed", "image", photo.name);
    await page
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(
      editor.getByText("Could not open the editor. Reload and try again.", {
        exact: true
      })
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Reload", exact: true })
    ).toBeEnabled();
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Feed view", exact: true })
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("retains a sharp, identically framed thumbnail until the original image decodes", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, {
      ...defaults,
      aspectFraming: {
        Portrait: { fit: "cover", focalX: 0.2, focalY: 0.8, zoom: 1.4 }
      }
    });
    await page.route(`**/api/assets/${photo.id}/media?*`, async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await open(page, "feed", "image", photo.name);
    const shell = page.locator(".feed-item .media-image-shell").first();
    const thumbnail = shell.locator(".media-image-thumbnail");
    const original = shell.locator(".media-image-original");
    await expect(shell).toHaveClass(/thumbnail-ready/);
    await expect(thumbnail).toHaveCSS("filter", "none");
    await expect(thumbnail).toHaveCSS("opacity", "1");
    await expect(original).toHaveCSS("opacity", "0");
    for (const property of ["object-fit", "object-position", "transform"])
      expect(
        await thumbnail.evaluate(
          (node, property) => getComputedStyle(node).getPropertyValue(property),
          property
        )
      ).toBe(
        await original.evaluate(
          (node, property) => getComputedStyle(node).getPropertyValue(property),
          property
        )
      );
    release();
    await expect(shell).toHaveClass(/(?:^| )ready(?: |$)/);
    await expect(original).toHaveCSS("opacity", "1");
    await expect(thumbnail).toHaveCSS("opacity", "0");
    await expect(original).toHaveCSS("transition-duration", "0s");
    await expect(original).toHaveAttribute("data-preview-source", "original");
  } finally {
    release();
    await context.close();
  }
});

test("remembers viewer framing across items and reloads while using independent presets", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    const animation = fixture("sequence.webp");
    await setPresentation(page, photo, {
      ...defaults,
      fit: "cover",
      zoom: 1.5,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.2, focalY: 0.8, zoom: 1.8 },
        Portrait: { fit: "cover", focalX: 0.4, focalY: 0.6, zoom: 1.1 }
      }
    });
    await setPresentation(page, animation, {
      ...defaults,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.7, focalY: 0.3, zoom: 1.2 }
      }
    });
    await open(page, "gallery", "image");
    await page
      .locator(".media-tile")
      .filter({ hasText: photo.name })
      .locator(".media-preview-button")
      .click();
    let viewer = page.getByRole("dialog", { name: photo.name, exact: true });
    const image = viewer.locator(".viewer-media-frame > img");
    await expect(image).toHaveCSS("object-fit", "contain");
    await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    let menu = await openViewerOptions(viewer);
    const framing = menu.getByRole("menuitemcheckbox", {
      name: "Use saved framing",
      exact: true
    });
    await expect(framing).toHaveAttribute("aria-checked", "false");
    await expect(
      menu.getByRole("menuitemcheckbox", {
        name: "Play highlights only",
        exact: true
      })
    ).toBeDisabled();
    await framing.click();
    await expect(menu).toBeVisible();
    await expect(image).toHaveCSS("object-position", "20% 80%");
    await expect(image).toHaveCSS("transform", "matrix(1.8, 0, 0, 1.8, 0, 0)");
    await expectFrameAspect(viewer, 1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(viewer).toBeVisible();
    await viewer
      .getByRole("button", { name: "Next media", exact: true })
      .click();
    viewer = page.getByRole("dialog", { name: animation.name, exact: true });
    await expect(viewer.locator("canvas")).toHaveCSS(
      "transform",
      "matrix(1.2, 0, 0, 1.2, 0, 0)"
    );
    menu = await openViewerOptions(viewer);
    await expect(
      menu.getByRole("menuitemcheckbox", {
        name: "Use saved framing",
        exact: true
      })
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await viewer
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();
    await expect(viewer).toHaveCount(0);
    await page
      .locator(".media-tile")
      .filter({ hasText: photo.name })
      .locator(".media-preview-button")
      .click();
    viewer = page.getByRole("dialog", { name: photo.name, exact: true });
    menu = await openViewerOptions(viewer);
    await expect(
      menu.getByRole("menuitemcheckbox", {
        name: "Use saved framing",
        exact: true
      })
    ).toHaveAttribute("aria-checked", "true");
    await expect(image).toHaveCSS("transform", "matrix(1.8, 0, 0, 1.8, 0, 0)");
    await page.reload();
    viewer = page.getByRole("dialog", { name: photo.name, exact: true });
    menu = await openViewerOptions(viewer);
    const rememberedFraming = menu.getByRole("menuitemcheckbox", {
      name: "Use saved framing",
      exact: true
    });
    await expect(rememberedFraming).toHaveAttribute("aria-checked", "true");
    await rememberedFraming.click();
    await page.reload();
    viewer = page.getByRole("dialog", { name: photo.name, exact: true });
    menu = await openViewerOptions(viewer);
    await expect(rememberedFraming).toHaveAttribute("aria-checked", "false");
    await expect(image).toHaveCSS("object-fit", "contain");
    await rememberedFraming.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    const rememberedPage = await context.newPage();
    await rememberedPage.goto(page.url());
    const rememberedViewer = rememberedPage.getByRole("dialog", {
      name: photo.name,
      exact: true
    });
    const rememberedMenu = await openViewerOptions(rememberedViewer);
    await expect(
      rememberedMenu.getByRole("menuitemcheckbox", {
        name: "Use saved framing",
        exact: true
      })
    ).toHaveAttribute("aria-checked", "true");
    await rememberedPage.close();
    await viewer
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();
    await expect(viewer).toHaveCount(0);

    // Missing indexed dimensions must use decoded dimensions, not crop to the viewport.
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() !== "GET" ||
        (!url.pathname.endsWith(`/assets/${photo.id}`) &&
          !url.pathname.endsWith("/assets"))
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      if (body.items) {
        body.items = body.items.map((item: AssetRecord) =>
          item.id === photo.id ? { ...item, width: null, height: null } : item
        );
      } else if (body.id === photo.id) {
        body.width = null;
        body.height = null;
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto(
      `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=image&sort=filename&aspect=original&asset=${photo.id}`
    );
    viewer = page.getByRole("dialog", { name: photo.name, exact: true });
    await expect(viewer.locator(".viewer-media-frame > img")).toHaveJSProperty(
      "naturalWidth",
      240
    );
    menu = await openViewerOptions(viewer);
    await expect(
      menu.getByRole("menuitemcheckbox", {
        name: "Use saved framing",
        exact: true
      })
    ).toHaveAttribute("aria-checked", "true");
    await expectFrameAspect(viewer, 2);
    await expect(viewer.locator(".viewer-media-frame > img")).toHaveCSS(
      "transform",
      "matrix(1.5, 0, 0, 1.5, 0, 0)"
    );
  } finally {
    await context.close();
  }
});

test("keeps viewer framing across reopen when browser storage is blocked", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    hasTouch: true,
    viewport: { width: 393, height: 852 },
    reducedMotion: "reduce"
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Blocked", "SecurityError");
        }
      });
    });
    const page = await context.newPage();
    await page.goto(
      `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=image&sort=filename&size=compact`
    );
    for (const [name, before] of [
      ["photo.png", false],
      ["sequence.webp", true],
      ["photo.png", false]
    ] as const) {
      await page
        .getByRole("button", { name: `Open ${name}`, exact: true })
        .tap();
      const viewer = page.getByRole("dialog", { name, exact: true });
      const menu = await openViewerOptions(viewer, true);
      const framing = menu.getByRole("menuitemcheckbox", {
        name: "Use saved framing",
        exact: true
      });
      await expect(framing).toHaveAttribute("aria-checked", String(before));
      await framing.tap();
      await expect(framing).toHaveAttribute("aria-checked", String(!before));
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await viewer
        .getByRole("button", { name: "Close viewer", exact: true })
        .tap();
      await expect(viewer).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

for (const hasTouch of [false, true]) {
  test(`changes viewer framing without restarting playback with ${hasTouch ? "touch" : "mouse"}`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext({
      storageState,
      hasTouch,
      reducedMotion: "reduce",
      viewport: hasTouch
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 }
    });
    try {
      const page = await context.newPage();
      for (const name of ["clip.mp4", "sequence.webp"]) {
        const asset = fixture(name);
        await setPresentation(page, asset, {
          ...defaults,
          highlight: { startMs: 300, endMs: 1200 },
          aspectFraming: {
            Portrait: { fit: "cover", focalX: 0.2, focalY: 0.8, zoom: 1.4 },
            Square: { fit: "cover", focalX: 0.8, focalY: 0.2, zoom: 1.8 }
          }
        });
        await open(page, "feed", asset.mediaType, name);
        await activate(
          page.getByRole("button", {
            name:
              asset.mediaType === "video"
                ? `Open ${name} in viewer`
                : "Enter fullscreen",
            exact: true
          }),
          hasTouch
        );
        const viewer = page.getByRole("dialog", { name, exact: true });
        const transport = viewer.locator(".video-controls");
        const media = viewer.locator(
          asset.mediaType === "video" ? "video" : "canvas"
        );
        await expect(transport).toHaveAttribute("data-paused", "false");
        if (asset.mediaType === "video") {
          await expect
            .poll(() =>
              media.evaluate((node: HTMLVideoElement) => node.currentTime)
            )
            .toBeGreaterThan(0.2);
          await media.evaluate((node) => {
            node.setAttribute("data-framing-seeks", "0");
            node.addEventListener("seeking", () => {
              node.setAttribute(
                "data-framing-seeks",
                String(Number(node.getAttribute("data-framing-seeks")) + 1)
              );
            });
          });
        }
        await media.evaluate((node) => {
          node.setAttribute("data-continuity", "original");
        });
        const source = await media.getAttribute("src");
        let menu = await openViewerOptions(viewer, hasTouch);
        const framing = menu.getByRole("menuitemcheckbox", {
          name: "Use saved framing",
          exact: true
        });
        if ((await framing.getAttribute("aria-checked")) === "true")
          await activate(framing, hasTouch);
        await activate(framing, hasTouch);
        await expectFrameAspect(viewer, 9 / 16);
        await expect(media).toHaveCSS(
          "transform",
          "matrix(1.4, 0, 0, 1.4, 0, 0)"
        );
        await expect(media).toHaveAttribute("data-continuity", "original");
        expect(await media.getAttribute("src")).toBe(source);
        await expect(transport).toHaveAttribute("data-paused", "false");
        if (asset.mediaType === "video")
          await expect(media).toHaveAttribute("data-framing-seeks", "0");
        await framing.focus();
        await page.keyboard.press("Space");
        await expect(framing).toHaveAttribute("aria-checked", "false");
        await expect(transport).toHaveAttribute("data-paused", "false");
        const score = (await getAsset(page, asset.id)).score;
        await page.keyboard.press("m");
        await page.keyboard.press("i");
        await page.keyboard.press("ArrowUp");
        expect((await getAsset(page, asset.id)).score).toBe(score);
        await expect(viewer).toBeVisible();
        await expect(page.locator(".media-info-sheet")).toHaveCount(0);
        if (asset.mediaType === "video")
          await expect(media).toHaveJSProperty("muted", true);
        // Keep the menu open longer than the viewer's idle-hide delay.
        await page.waitForTimeout(2000);
        await expect(menu).toBeVisible();
        await expect(viewer).toHaveClass(/controls-visible/);
        if (hasTouch) {
          await expect
            .poll(async () => (await framing.boundingBox())!.height)
            .toBeGreaterThanOrEqual(44);
          const bounds = (await menu.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(393);
        }
        await page.screenshot({
          path: testInfo.outputPath(
            `${hasTouch ? "phone" : "desktop"}-${asset.mediaType}-viewer-options.png`
          )
        });
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(viewer).toBeVisible();
        await activate(
          transport.getByRole("button", { name: "Pause video", exact: true }),
          hasTouch
        );
        await expect(transport).toHaveAttribute("data-paused", "true");
        menu = await openViewerOptions(viewer, hasTouch);
        const pausedPosition = await transport.locator("input").inputValue();
        await activate(
          menu.getByRole("menuitemcheckbox", {
            name: "Use saved framing",
            exact: true
          }),
          hasTouch
        );
        await expect(transport).toHaveAttribute("data-paused", "true");
        expect(await transport.locator("input").inputValue()).toBe(
          pausedPosition
        );
        await expect(media).toHaveAttribute("data-continuity", "original");
        if (hasTouch) {
          await page.setViewportSize({ width: 852, height: 393 });
          await expectFrameAspect(viewer, 9 / 16);
          await expect
            .poll(async () => {
              const [anchor, popup] = await Promise.all([
                viewer
                  .getByRole("button", {
                    name: "Viewer view options",
                    exact: true
                  })
                  .boundingBox(),
                menu.boundingBox()
              ]);
              return Math.abs(
                anchor!.x + anchor!.width - (popup!.x + popup!.width)
              );
            })
            .toBeLessThanOrEqual(2);
          const bounds = (await menu.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(852);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(393);
          await page.screenshot({
            path: testInfo.outputPath(
              `phone-landscape-${asset.mediaType}-viewer-options.png`
            )
          });
          await page.setViewportSize({ width: 393, height: 852 });
          await expectFrameAspect(viewer, 9 / 16);
          await expect(transport).toHaveAttribute("data-paused", "true");
        }
        if (
          asset.mediaType === "video" &&
          (await page.evaluate(() => document.fullscreenEnabled))
        ) {
          await page.keyboard.press("Escape");
          await expect(menu).toHaveCount(0);
          await transport
            .getByRole("button", { name: "Enter fullscreen", exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(() =>
                document.fullscreenElement?.classList.contains("viewer-dialog")
              )
            )
            .toBe(true);
          const fullscreenViewer = page.locator(".viewer-dialog");
          await expect(
            fullscreenViewer.getByRole("button", {
              name: "Exit fullscreen",
              exact: true
            })
          ).toBeVisible();
          menu = await openViewerOptions(fullscreenViewer, hasTouch);
          expect(
            await menu.evaluate((node) =>
              document.fullscreenElement?.contains(node)
            )
          ).toBe(true);
          await activate(
            menu.getByRole("menuitemcheckbox", {
              name: "Use saved framing",
              exact: true
            }),
            hasTouch
          );
          await expect(transport).toHaveAttribute("data-paused", "true");
          await page.keyboard.press("Escape");
          await expect(menu).toHaveCount(0);
          await fullscreenViewer
            .getByRole("button", { name: "Exit fullscreen", exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(() => document.fullscreenElement === null)
            )
            .toBe(true);
        } else {
          await page.keyboard.press("Escape");
        }
        await viewer
          .getByRole("button", { name: "Close viewer", exact: true })
          .click();
        await expect(viewer).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
}

for (const hasTouch of [false, true]) {
  test(`toggles viewer overlays and keeps video and animation playing behind Info with ${hasTouch ? "touch" : "mouse"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      hasTouch,
      reducedMotion: "reduce",
      viewport: hasTouch
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 }
    });
    try {
      const page = await context.newPage();
      for (const name of ["clip.mp4", "sequence.webp"]) {
        const asset = fixture(name);
        await setPresentation(page, asset, {
          ...defaults,
          highlight: { startMs: 300, endMs: 1200 }
        });
        await open(page, "gallery", asset.mediaType, name);
        await page.locator(".media-preview-button").first().click();
        const viewer = page.getByRole("dialog", { name, exact: true });
        const surface = viewer.locator(".viewer-fit-area");
        const transport = viewer.locator(".video-controls");
        await expect(transport).toBeVisible();
        if (hasTouch) await surface.tap();
        else await surface.click();
        await expect(viewer).toHaveClass(/controls-hidden/);
        if (hasTouch) await surface.tap();
        else await surface.click();
        await expect(viewer).toHaveClass(/controls-visible/);
        await setViewerHighlights(page, viewer, true, hasTouch);
        await expect(transport.locator("input")).toHaveAttribute("min", "0.3");
        await expect(transport.locator("input")).toHaveAttribute("max", "1.2");
        await setViewerHighlights(page, viewer, false, hasTouch);
        await expect(transport.locator("input")).toHaveAttribute("min", "0");
        if (asset.mediaType === "video") {
          await expect(viewer.locator(".viewer-media-frame")).toHaveClass(
            /is-video-ready/
          );
          await expect(viewer.locator("video")).toHaveCSS("opacity", "1");
        }
        await setViewerHighlights(page, viewer, true, hasTouch);
        await viewer
          .getByRole("button", { name: `Show info for ${name}`, exact: true })
          .click();
        const info = page.locator(".media-info-sheet");
        await expect(info).toBeVisible();
        if (asset.mediaType === "video") {
          const video = viewer.locator("video");
          await expect
            .poll(() => video.evaluate((node: HTMLVideoElement) => node.paused))
            .toBe(false);
          const before = await video.evaluate(
            (node: HTMLVideoElement) => node.currentTime
          );
          await expect
            .poll(() =>
              video.evaluate((node: HTMLVideoElement) => node.currentTime)
            )
            .not.toBe(before);
        } else {
          await expect(transport).toHaveAttribute("data-paused", "false");
          await expect(viewer.locator("canvas")).toHaveCSS("opacity", "1");
        }
        await info.getByRole("button", { name: "Close", exact: true }).click();
        await expect(info).toHaveCount(0);
        // A stationary pointer and unfocused controls still auto-hide.
        await surface.focus();
        const bounds = (await surface.boundingBox())!;
        await page.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        await expect(viewer).toHaveClass(/controls-hidden/, { timeout: 5000 });
        if (hasTouch) await surface.tap();
        else await surface.click();
        await expect(viewer).toHaveClass(/controls-visible/);
        await transport
          .getByRole("button", { name: "Pause video", exact: true })
          .click();
        await viewer
          .getByRole("button", { name: `Show info for ${name}`, exact: true })
          .click();
        await expect(info).toBeVisible();
        await expect(transport).toHaveAttribute("data-paused", "true");
        await info.getByRole("button", { name: "Close", exact: true }).click();
        await expect(info).toHaveCount(0);
        await expect(transport).toHaveAttribute("data-paused", "true");
        for (const checked of [false, true]) {
          await setViewerHighlights(page, viewer, checked, hasTouch);
          await expect(transport).toHaveAttribute("data-paused", "true");
          if (asset.mediaType === "video")
            await expect(viewer.locator(".viewer-media-frame")).toHaveClass(
              /is-video-ready/
            );
        }
        await viewer
          .getByRole("button", { name: "Close viewer", exact: true })
          .click();
        await expect(viewer).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
}

test("loops original video sections in Feed and Comparison, with an explicit codec fallback", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const asset = fixture("clip.mp4");
    await setPresentation(page, asset, {
      ...defaults,
      highlight: { startMs: 2000, endMs: 3500 },
      playbackRate: 1.5
    });
    let encodedReads = 0;
    page.on("request", (request) => {
      if (request.url().includes(`/api/assets/${asset.id}/playback?`))
        encodedReads += 1;
    });
    await open(page, "feed", "video", asset.name, true);
    const video = page.locator(".feed-item video").first();
    await expect(video).toHaveAttribute("src", /\/media(?:\?|$)/);
    await expect(video).toHaveAttribute("data-presentation-timeline", "source");
    await expect(
      page.locator(".feed-item .media-video-shell").first()
    ).toHaveClass(/ready/);
    await video.evaluate((node: HTMLVideoElement) => {
      node.dataset.wraps = "0";
      node.addEventListener("seeking", () => {
        if (node.currentTime < 2.1)
          node.dataset.wraps = String(Number(node.dataset.wraps) + 1);
      });
    });
    await expect.poll(() => video.getAttribute("data-wraps")).not.toBe("0");
    expect(encodedReads).toBe(0);
    await copyFile(
      path.join(directory, "clip.mp4"),
      path.join(directory, "comparison-clip.mp4")
    );
    await scan(page);
    await open(page, "compare", "video");
    await page
      .locator(".leaderboard-header")
      .getByRole("button", { name: "Rank media", exact: true })
      .click();
    const pair = page.locator(".comparison-choose-surface");
    await expect(pair).toHaveCount(2);
    const names = await pair.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label"))
    );
    await page.getByRole("button", { name: /^View options/ }).click();
    const options = page.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await options
      .getByRole("checkbox", { name: "Play highlights only", exact: true })
      .check();
    await options
      .getByRole("button", { name: "Close view options", exact: true })
      .click();
    expect(
      await pair.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label"))
      )
    ).toEqual(names);
    const comparisonVideo = page.locator(
      `.comparison-card[data-asset-id="${asset.id}"] video`
    );
    await expect(comparisonVideo).toHaveCount(1);
    await expect(comparisonVideo).toHaveAttribute("src", /\/media(?:\?|$)/);
    await expect
      .poll(() =>
        comparisonVideo.evaluate((node: HTMLVideoElement) => node.playbackRate)
      )
      .toBe(1);
    await expect
      .poll(() =>
        comparisonVideo.evaluate((node: HTMLVideoElement) => node.currentTime)
      )
      .toBeGreaterThanOrEqual(2);
    await page.route(`**/api/assets/${asset.id}/media?*`, (route) =>
      route.abort("failed")
    );
    await open(page, "feed", "video", asset.name, true);
    await expect(video).toHaveAttribute("src", /playback\?variant=highlight/);
    await expect(video).toHaveAttribute("data-presentation-timeline", "local");
    await expect(
      page.locator(".feed-item .media-video-shell").first()
    ).toHaveClass(/ready/);
    await expect(
      page.getByRole("slider", { name: `Seek ${asset.name}`, exact: true })
    ).toHaveAttribute("min", "2");
  } finally {
    await context.close();
  }
});

test("retains original animation dimensions in the viewer and releases hidden canvases", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const size = 1280 * 720 * 4;
    await sharp(
      Buffer.concat([Buffer.alloc(size, 64), Buffer.alloc(size, 192)]),
      {
        raw: { width: 1280, height: 1440, channels: 4, pageHeight: 720 },
        animated: true
      }
    )
      .webp({ lossless: true, loop: 0, delay: [300, 600], effort: 0 })
      .toFile(path.join(directory, "large-sequence.webp"));
    await scan(page);
    await open(page, "gallery", "image", "large-sequence.webp");
    const card = page.locator(".media-tile").first();
    const preview = card.locator("canvas");
    await expect(preview).toHaveCSS("opacity", "1");
    await expect
      .poll(() => preview.evaluate((node: HTMLCanvasElement) => node.width))
      .toBeLessThanOrEqual(640);
    await card.locator(".media-preview-button").click();
    const viewer = page.getByRole("dialog", {
      name: "large-sequence.webp",
      exact: true
    });
    const canvas = viewer.locator("canvas");
    await expect(canvas).toHaveCSS("opacity", "1");
    await expect(canvas).toHaveAttribute("width", "1280");
    await expect(canvas).toHaveAttribute("height", "720");
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide"))
    );
    await expect(canvas).toHaveAttribute("width", "0");
    await expect(canvas).toHaveAttribute("height", "0");
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow"))
    );
    await expect(canvas).toHaveAttribute("width", "1280");
    await expect(canvas).toHaveAttribute("height", "720");
    await expect(canvas).toHaveCSS("opacity", "1");
  } finally {
    await context.close();
  }
});

test("auto-hides viewer controls after a delayed original starts without revealing them on each loop", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    const asset = fixture("clip.mp4");
    await setPresentation(page, asset, {
      ...defaults,
      highlight: { startMs: 500, endMs: 1200 }
    });
    await page.route(`**/api/assets/${asset.id}/media?*`, async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await open(page, "gallery", "video", asset.name, true);
    await page.locator(".media-preview-button").first().click();
    const viewer = page.getByRole("dialog", { name: asset.name, exact: true });
    await expect(viewer).toBeVisible();
    await page.waitForTimeout(2100);
    release();
    await expect
      .poll(() =>
        viewer
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.paused)
      )
      .toBe(false);
    await expect(viewer).toHaveClass(/controls-hidden/, { timeout: 5000 });
    await expect(viewer.locator(".viewer-media-frame")).toHaveClass(
      /is-video-ready/
    );
  } finally {
    release();
    await context.close();
  }
});

async function setLayoutAspect(page: Page, aspect: string) {
  await page.getByRole("button", { name: /^View options/ }).click();
  const options = page.getByRole("dialog", {
    name: "View options",
    exact: true
  });
  await options.getByRole("tab", { name: "Layout", exact: true }).click();
  await options
    .getByRole("combobox", { name: "Media layout", exact: true })
    .click();
  await page.getByRole("option", { name: aspect, exact: true }).click();
  await options
    .getByRole("button", { name: "Close view options", exact: true })
    .click();
}

async function expectEditorBounds(
  editor: Locator,
  width: number,
  height: number,
  insets: { top: number; bottom: number; left: number; right: number }
) {
  await expect(editor).toBeInViewport({ ratio: 1 });
  const bounds = (await editor.boundingBox())!;
  expect(bounds.x).toBeCloseTo(0, 0);
  expect(bounds.y).toBeCloseTo(0, 0);
  expect(bounds.width).toBeCloseTo(width, 0);
  expect(bounds.height).toBeCloseTo(height, 0);
  const heading = (await editor
    .getByRole("heading", { name: "Edit media", exact: true })
    .boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(insets.top);
  expect(heading.x).toBeGreaterThanOrEqual(insets.left);
  const save = (await editor
    .getByRole("button", { name: "Save", exact: true })
    .boundingBox())!;
  expect(save.x + save.width).toBeLessThanOrEqual(width - insets.right);
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
async function openGalleryEditor(page: Page, asset: AssetRecord) {
  if (new URL(page.url()).searchParams.get("asset") !== asset.id) {
    await page
      .locator(".media-tile")
      .filter({ hasText: asset.name })
      .locator(".media-preview-button")
      .click();
  }
  const viewer = page.getByRole("dialog", { name: asset.name, exact: true });
  await expect(
    viewer.getByRole("link", { name: `Download ${asset.name}`, exact: true })
  ).toBeVisible();
  await viewer
    .getByRole("button", { name: `Edit ${asset.name}`, exact: true })
    .click();
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

async function activate(control: Locator, hasTouch = false) {
  if (hasTouch) await control.tap();
  else await control.click();
}
async function openViewerOptions(viewer: Locator, hasTouch = false) {
  await activate(
    viewer.getByRole("button", { name: "Viewer view options", exact: true }),
    hasTouch
  );
  const menu = viewer.getByRole("menu", {
    name: "Viewer view options",
    exact: true
  });
  await expect(menu).toHaveAttribute("data-state", "open");
  await expect(menu).toBeVisible();
  return menu;
}
async function setViewerHighlights(
  page: Page,
  viewer: Locator,
  checked: boolean,
  hasTouch = false
) {
  const menu = await openViewerOptions(viewer, hasTouch);
  const item = menu.getByRole("menuitemcheckbox", {
    name: "Play highlights only",
    exact: true
  });
  if ((await item.getAttribute("aria-checked")) !== String(checked))
    await activate(item, hasTouch);
  await expect(item).toHaveAttribute("aria-checked", String(checked));
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}
async function expectFrameAspect(viewer: Locator, ratio: number) {
  await expect
    .poll(async () => {
      const bounds = await viewer.locator(".viewer-media-frame").boundingBox();
      return bounds ? bounds.width / bounds.height : 0;
    })
    .toBeCloseTo(ratio, 2);
}

test("falls back between lossless Bounce codecs when a reported decoder fails", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    await context.addInitScript(() => {
      const original = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type) {
        return type.includes("hvc1") ? "probably" : original.call(this, type);
      };
    });
    const page = await context.newPage();
    const video = fixture("clip.mp4");
    await setPresentation(page, video, {
      ...defaults,
      highlight: { startMs: 500, endMs: 1500 },
      loopMode: "bounce"
    });
    let failedDecoderRequests = 0;
    await page.route("**/api/assets/*/playback?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("codec") === "hevc") {
        failedDecoderRequests++;
        await route.fulfill({
          status: 415,
          contentType: "application/json",
          body: '{"error":"playback_not_supported"}'
        });
      } else await route.continue();
    });
    await open(page, "feed", "video", video.name, true);
    const media = page.locator(".feed-item video").first();
    await expect(media).toHaveAttribute("src", /codec=h264/);
    await expect
      .poll(() => media.evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => media.evaluate((node: HTMLVideoElement) => node.paused))
      .toBe(false);
    expect(failedDecoderRequests).toBeGreaterThan(0);
    await expect(page.getByText("Bounce", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Playback unavailable|supported video decoder/)
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
