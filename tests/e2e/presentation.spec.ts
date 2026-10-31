import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, utimes } from "node:fs/promises";
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
  PresentationMediaCapabilities,
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

for (const phone of [false, true]) {
  const layout = phone ? "phone" : "desktop";
  test(`uses framing shortcuts throughout the ${layout} editor without stealing control keys`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      ...(phone
        ? {
            viewport: { width: 393, height: 852 },
            isMobile: true,
            hasTouch: true
          }
        : {})
    });
    const saveGate = loadingGate();
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
      const cancel = editor.getByRole("button", {
        name: "Cancel",
        exact: true
      });
      const zoom = editor.getByRole("slider", {
        name: "Media zoom",
        exact: true
      });
      const position = () =>
        editor
          .locator(".media-editor-frame img")
          .evaluate((node) =>
            getComputedStyle(node).objectPosition.split(" ").map(parseFloat)
          );
      await expect(zoom).toBeVisible();
      await cancel.focus();
      await page.keyboard.press("=");
      await expect(zoom).toHaveAttribute("aria-valuenow", "1.05");
      await page.keyboard.press("-");
      await page.keyboard.press("Shift+Equal");
      await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
      await page.keyboard.press("Shift+Minus");
      await expect(zoom).toHaveAttribute("aria-valuenow", "1");
      await cancel.evaluate((button) => {
        for (let index = 0; index < 20; index++)
          button.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "=",
              code: "Equal",
              repeat: index > 0,
              bubbles: true,
              cancelable: true
            })
          );
      });
      await expect(zoom).toHaveAttribute("aria-valuenow", "2");
      await page.keyboard.press("ArrowRight");
      const right = (await position())[0]!;
      expect(right).toBeGreaterThan(50);
      await page.keyboard.press("Shift+ArrowLeft");
      expect((await position())[0]!).toBeCloseTo(
        50 + ((right - 50) * 11) / 12,
        3
      );
      await page.keyboard.press("ArrowDown");
      expect((await position())[1]!).toBeGreaterThan(50);
      const moved = await position();
      await zoom.press("ArrowRight");
      await expect(zoom).toHaveAttribute("aria-valuenow", "2.01");
      expect(await position()).toEqual(moved);
      await cancel.focus();
      for (const extra of [
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { isComposing: true }
      ])
        await cancel.dispatchEvent("keydown", {
          key: "=",
          bubbles: true,
          ...extra
        });
      await expect(zoom).toHaveAttribute("aria-valuenow", "2.01");
      const aspect = editor.getByRole("combobox", {
        name: "Media layout",
        exact: true
      });
      await aspect.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      expect(await position()).toEqual(moved);
      const fit = editor.getByRole("combobox", {
        name: "Framing",
        exact: true
      });
      await fit.click();
      await page.getByRole("option", { name: "Fit", exact: true }).click();
      await cancel.focus();
      await page.keyboard.press("=");
      await page.keyboard.press("ArrowRight");
      await expect(zoom).toHaveAttribute("aria-valuenow", "1");
      expect(await position()).toEqual([50, 50]);
      await fit.click();
      await page.getByRole("option", { name: "Fill", exact: true }).click();
      await cancel.focus();
      await page.keyboard.press("=");
      await page.route(
        `**/api/assets/${photo.id}/presentation`,
        async (route) => {
          await saveGate.promise;
          await route.continue().catch(() => undefined);
        }
      );
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        editor.getByRole("button", { name: "Saving…", exact: true })
      ).toBeDisabled();
      await editor.press("=");
      await editor.press("ArrowRight");
      await expect(zoom).toHaveAttribute("aria-valuenow", "1.05");
      saveGate.release();
      await expect(editor).toHaveCount(0);
      expect(
        (await getAsset(page, photo.id)).presentation?.aspectFraming?.Square
      ).toMatchObject({
        fit: "cover",
        zoom: 1.05,
        focalX: 0.5,
        focalY: 0.5
      });
    } finally {
      saveGate.release();
      await context.close();
    }
  });

  test(`adjusts only the focused playback or highlight control in the ${layout} editor`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      ...(phone
        ? {
            viewport: { width: 393, height: 852 },
            isMobile: true,
            hasTouch: true
          }
        : {})
    });
    try {
      const page = await context.newPage();
      for (const name of ["clip.mp4", "sequence.webp"]) {
        const asset = fixture(name);
        await setPresentation(page, asset, {
          ...defaults,
          highlight: { startMs: 500, endMs: 1500 }
        });
        await open(page, "feed", asset.mediaType, name);
        await page
          .getByRole("button", { name: `Edit ${name}`, exact: true })
          .click();
        const editor = page.getByRole("dialog", {
          name: "Edit media",
          exact: true
        });
        const timeline = editor.getByRole("slider", {
          name: "Preview position",
          exact: true
        });
        const start = editor.getByRole("slider", {
          name: "Highlight start",
          exact: true
        });
        const end = editor.getByRole("slider", {
          name: "Highlight end",
          exact: true
        });
        const startTime = editor.getByRole("textbox", {
          name: "Start time",
          exact: true
        });
        const endTime = editor.getByRole("textbox", {
          name: "End time",
          exact: true
        });
        const preview = editor.locator(
          name.endsWith("mp4") ? "video" : "canvas"
        );
        await expect(preview).toBeVisible();
        await expect(timeline).toHaveAccessibleDescription(/Shift.*1\s?ms/);
        await timeline.press("Home");
        await timeline.press("ArrowRight");
        await expect(timeline).toHaveAttribute("aria-valuenow", "100");
        await timeline.press("Shift+ArrowRight");
        await expect(timeline).toHaveAttribute("aria-valuenow", "101");
        await timeline.press("ArrowUp");
        await expect(timeline).toHaveAttribute("aria-valuenow", "201");
        await timeline.press("ArrowDown");
        await timeline.press("PageUp");
        await expect(timeline).toHaveAttribute("aria-valuenow", "1101");
        await timeline.press("PageDown");
        await timeline.press("Shift+ArrowLeft");
        await expect(timeline).toHaveAttribute("aria-valuenow", "100");
        for (const extra of [
          { ctrlKey: true },
          { metaKey: true },
          { altKey: true },
          { isComposing: true }
        ])
          await timeline.dispatchEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            ...extra
          });
        await expect(timeline).toHaveAttribute("aria-valuenow", "100");
        await expect(startTime).toHaveValue("0:00.500");
        await expect(endTime).toHaveValue("0:01.500");
        await editor
          .getByRole("button", { name: "Play preview", exact: true })
          .click();
        await expect(
          editor.getByRole("button", { name: "Pause preview", exact: true })
        ).toBeVisible();
        await timeline.press("Home");
        await expect(
          editor.getByRole("button", { name: "Play preview", exact: true })
        ).toBeVisible();
        await timeline.press("Shift+ArrowRight");
        await expect(timeline).toHaveAttribute("aria-valuenow", "1");
        if (name.endsWith("mp4")) {
          await expect
            .poll(() =>
              preview.evaluate((node: HTMLVideoElement) => node.currentTime)
            )
            .toBeCloseTo(0.001, 5);
        } else {
          const pixel = () =>
            preview.evaluate(
              (node: HTMLCanvasElement) =>
                node.getContext("2d")!.getImageData(20, 20, 1, 1).data[0]
            );
          await timeline.press("Home");
          for (let index = 0; index < 3; index++)
            await timeline.press("ArrowRight");
          await timeline.press("Shift+ArrowLeft");
          await expect.poll(pixel).toBeLessThan(40);
          await timeline.press("Shift+ArrowRight");
          await expect.poll(pixel).toBeGreaterThan(120);
        }
        await start.press("ArrowRight");
        await expect(startTime).toHaveValue("0:00.600");
        await start.press("Shift+ArrowRight");
        await expect(startTime).toHaveValue("0:00.601");
        await expect(timeline).toHaveAttribute("aria-valuenow", "601");
        await expect(endTime).toHaveValue("0:01.500");
        await end.press("Shift+ArrowLeft");
        await expect(endTime).toHaveValue("0:01.499");
        await expect(timeline).toHaveAttribute("aria-valuenow", "1498");
        await start.press("End");
        await expect(startTime).toHaveValue("0:01.399");
        await expect(start).toHaveAttribute("aria-valuemax", "1399");
        await expect(end).toHaveAttribute("aria-valuemin", "1499");
        await start.press("ArrowRight");
        await expect(startTime).toHaveValue("0:01.399");
        await start.press("Home");
        await expect(startTime).toHaveValue("0:00.000");
        await end.press("Home");
        await expect(endTime).toHaveValue("0:00.100");
        await end.press("Shift+ArrowLeft");
        await expect(endTime).toHaveValue("0:00.100");
        await start.focus();
        await page.keyboard.press("Tab");
        await expect(end).toBeFocused();
        await startTime.press("ArrowRight");
        await expect(startTime).toHaveValue("0:00.000");
        await startTime.press("Shift+ArrowRight");
        await expect(startTime).toHaveValue("0:00.000");
        const speed = editor.getByRole("combobox", {
          name: "Speed",
          exact: true
        });
        await speed.focus();
        await page.keyboard.press("ArrowDown");
        await expect(page.getByRole("listbox")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(startTime).toHaveValue("0:00.000");
        await editor.getByRole("tab", { name: "Framing", exact: true }).click();
        const zoom = editor.getByRole("slider", {
          name: "Media zoom",
          exact: true
        });
        await expect(zoom).toHaveAttribute("aria-valuenow", "1");
        await timeline.press("Home");
        await timeline.press("ArrowRight");
        await expect(timeline).toHaveAttribute("aria-valuenow", "100");
        await expect(zoom).toHaveAttribute("aria-valuenow", "1");
        await editor.getByRole("tab", { name: "Framing", exact: true }).focus();
        await page.keyboard.press("ArrowLeft");
        await expect(
          editor.getByRole("tab", { name: "Playback", exact: true })
        ).toHaveAttribute("aria-selected", "true");
        await editor
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        expect(
          (await getAsset(page, asset.id)).presentation?.highlight
        ).toEqual({ startMs: 500, endMs: 1500 });
      }
    } finally {
      await context.close();
    }
  });
}

for (const phone of [false, true]) {
  test(`shows compact actionable Bounce failures on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      hasTouch: phone,
      isMobile: phone,
      reducedMotion: "reduce"
    });
    let release = loadingGate();
    try {
      const page = await context.newPage();
      const asset = fixture("clip.mp4");
      await setPresentation(page, asset, {
        ...defaults,
        highlight: { startMs: 300, endMs: 2300 },
        loopMode: "bounce"
      });
      let mode: "tools" | "busy" | "browser" | "ready" = "tools";
      let headRequests = 0;
      await page.route(
        `**/api/assets/${asset.id}/playback?*`,
        async (route) => {
          await release.promise;
          if (mode === "ready") {
            await route.continue().catch(() => undefined);
            return;
          }
          if (route.request().method() === "HEAD") headRequests++;
          const code =
            mode === "tools" ? "media_tool_unavailable" : "processing_busy";
          await route
            .fulfill({
              status: mode === "browser" ? 200 : 503,
              headers:
                mode === "browser"
                  ? { "content-type": "video/mp4" }
                  : {
                      "content-type": "application/json",
                      "x-aether-media-error": code
                    },
              body:
                mode === "browser"
                  ? "invalid media"
                  : JSON.stringify({ error: code })
            })
            .catch(() => undefined);
        }
      );
      for (const surfaceName of ["gallery", "feed", "viewer"] as const) {
        mode = "tools";
        release = loadingGate();
        if (surfaceName === "viewer")
          await page.goto(
            `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=video&highlight=1&asset=${asset.id}`
          );
        else await open(page, surfaceName, "video", asset.name, true);
        const viewer = page.getByRole("dialog", {
          name: asset.name,
          exact: true
        });
        const frame =
          surfaceName === "viewer"
            ? viewer.locator(".viewer-media-frame")
            : page
                .locator(
                  surfaceName === "feed"
                    ? ".feed-item .media-video-shell"
                    : ".media-tile .media-video-shell"
                )
                .first();
        await expect(frame).toBeVisible();
        await frame.evaluate(async (node) => {
          const finished: Promise<unknown>[] = [];
          for (
            let element: Element | null = node;
            element;
            element = element.parentElement
          )
            finished.push(
              ...element
                .getAnimations()
                .filter((animation) =>
                  Number.isFinite(animation.effect?.getComputedTiming().endTime)
                )
                .map((animation) => animation.finished.catch(() => undefined))
            );
          await Promise.all(finished);
        });
        const initialBounds = (await frame.boundingBox())!;
        release.release();
        const host =
          surfaceName === "viewer"
            ? viewer
            : surfaceName === "gallery"
              ? page.locator(".media-tile .media-preview-frame").first()
              : frame;
        const notice = host.locator(".media-error-notice");
        await expect(notice).toHaveCount(1);
        await expect(notice).toContainText(
          "Server media tools are unavailable."
        );
        await expect(notice).not.toContainText(/shorter|too long/i);
        await expect(notice).toHaveCSS(
          "font-size",
          surfaceName === "gallery" ? "12px" : "13px"
        );
        const frameBounds = (await frame.boundingBox())!;
        expect(frameBounds.height).toBeCloseTo(initialBounds.height, 0);
        const noticeBounds = (await notice.boundingBox())!;
        const hostBounds = (await host.boundingBox())!;
        expect(noticeBounds.x).toBeGreaterThanOrEqual(hostBounds.x);
        expect(noticeBounds.x + noticeBounds.width).toBeLessThanOrEqual(
          hostBounds.x + hostBounds.width
        );
        expect(noticeBounds.width).toBeLessThanOrEqual(416);
        expect(noticeBounds.y).toBeGreaterThanOrEqual(hostBounds.y);
        expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(
          hostBounds.y + hostBounds.height
        );
        await page.screenshot({
          path: testInfo.outputPath(
            `bounce-error-${surfaceName}-${phone ? "phone" : "desktop"}.png`
          )
        });
        const retry = notice.getByRole("button", {
          name: "Retry",
          exact: true
        });
        await expect(retry).toBeVisible();
        const retryBounds = (await retry.boundingBox())!;
        expect(retryBounds.width).toBeGreaterThanOrEqual(44);
        expect(retryBounds.height).toBeGreaterThanOrEqual(44);
        mode = surfaceName === "viewer" ? "browser" : "busy";
        await activate(retry, phone);
        await expect(notice).toContainText(
          surfaceName === "viewer"
            ? "This browser cannot play Bounce."
            : "Media preparation is busy."
        );
        mode = "ready";
        await activate(retry, phone);
        await expect(notice).toHaveCount(0);
        const video = frame.locator("video");
        await expect
          .poll(() =>
            video.evaluate((node: HTMLVideoElement) => node.readyState)
          )
          .toBeGreaterThanOrEqual(2);
        await expect
          .poll(() =>
            video.evaluate((node: HTMLVideoElement) => node.currentTime)
          )
          .toBeGreaterThan(0);
        if (surfaceName !== "viewer") await expect(viewer).toHaveCount(0);
        expect(await page.locator("button button").count()).toBe(0);
      }
      expect(headRequests).toBeGreaterThanOrEqual(5);
    } finally {
      release.release();
      await context.close();
    }
  });
}

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
      .locator(".viewer-image-original");
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

for (const phone of [false, true]) {
  const view = phone ? "feed" : "gallery";
  test(`shows a saved Bounce immediately in ${view} and preserves full-source playback for framing edits`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      reducedMotion: "reduce",
      ...(phone
        ? {
            viewport: { width: 393, height: 852 },
            hasTouch: true,
            isMobile: true
          }
        : {})
    });
    try {
      const page = await context.newPage();
      const asset = fixture("clip.mp4");
      await setPresentation(page, asset, defaults);
      await open(page, view, "video", asset.name);
      const viewer = page.getByRole("dialog", {
        name: asset.name,
        exact: true
      });
      const edit = async () => {
        if (phone)
          await page
            .getByRole("button", { name: `Edit ${asset.name}`, exact: true })
            .tap();
        else await openGalleryEditor(page, asset);
      };
      await edit();
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await editor
        .getByRole("textbox", { name: "Start time", exact: true })
        .fill("0.5");
      await editor
        .getByRole("textbox", { name: "End time", exact: true })
        .fill("2");
      await editor.getByRole("combobox", { name: "Loop", exact: true }).click();
      await page.getByRole("option", { name: "Bounce", exact: true }).click();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      const media = phone
        ? page.locator(".feed-item video").first()
        : viewer.locator("video");
      await expect(media).toHaveAttribute("src", /playback\?variant=bounce/);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("highlight"))
        .toBe("1");
      await edit();
      await expect(
        editor.getByRole("combobox", { name: "Loop", exact: true })
      ).toHaveText("Bounce");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      if (phone) {
        await page.getByRole("button", { name: /^View options/ }).tap();
        const options = page.getByRole("dialog", {
          name: "View options",
          exact: true
        });
        await options
          .getByRole("checkbox", { name: "Play highlights only", exact: true })
          .uncheck();
        await options
          .getByRole("button", { name: "Close view options", exact: true })
          .tap();
      } else await setViewerHighlights(page, viewer, false);
      await expect(media).toHaveAttribute("src", /\/media(?:\?|$)/);
      await edit();
      await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      await editor
        .getByRole("slider", { name: "Media zoom", exact: true })
        .press("ArrowRight");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(media).toHaveAttribute("src", /\/media(?:\?|$)/);
      expect(new URL(page.url()).searchParams.get("highlight")).not.toBe("1");
      expect((await getAsset(page, asset.id)).presentation).toMatchObject({
        loopMode: "bounce",
        highlight: { startMs: 500, endMs: 2000 }
      });
    } finally {
      await context.close();
    }
  });
}

for (const viewport of [
  { width: 1440, height: 980 },
  { width: 320, height: 568 }
]) {
  test(`keeps save failures and retry beside Save at ${viewport.width}px`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext({
      storageState,
      viewport,
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {})
    });
    const gate = loadingGate();
    try {
      const page = await context.newPage();
      const asset = fixture("photo.png");
      await setPresentation(page, asset, defaults);
      await open(page, "gallery", "image", asset.name);
      await openGalleryEditor(page, asset);
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      const zoom = editor.getByRole("slider", {
        name: "Media zoom",
        exact: true
      });
      await zoom.press("ArrowRight");
      let fail = true;
      await page.route(
        `**/api/assets/${asset.id}/presentation`,
        async (route) => {
          if (route.request().method() !== "PUT" || !fail) {
            await route.continue();
            return;
          }
          await gate.promise;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "presentation_save_failed" })
          });
        }
      );
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        editor.getByRole("button", { name: "Saving…", exact: true })
      ).toBeDisabled();
      await expect(
        editor.getByRole("button", { name: "Cancel", exact: true })
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(editor).toBeVisible();
      gate.release();
      const alert = editor.getByRole("alert");
      await expect(alert).toHaveText("Could not save these edits. Try again.");
      await expect(alert).toBeInViewport({ ratio: 1 });
      await expect(editor.locator(".media-editor-footer")).toBeInViewport({
        ratio: 1
      });
      expect(
        await editor.locator(".media-editor-footer").getByRole("alert").count()
      ).toBe(1);
      await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
      await expect(
        editor.getByRole("button", { name: "Save", exact: true })
      ).toBeEnabled();
      if (viewport.width < 768) {
        await page.setViewportSize({ width: 568, height: 320 });
        await expect(alert).toBeInViewport({ ratio: 1 });
        await expect(editor.locator(".media-editor-footer")).toBeInViewport({
          ratio: 1
        });
      }
      await page.screenshot({ path: testInfo.outputPath("save-error.png") });
      fail = false;
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(
        (await getAsset(page, asset.id)).presentation?.aspectFraming.Square
          ?.zoom
      ).toBe(1.01);
    } finally {
      gate.release();
      await context.close();
    }
  });
}

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

test("reconciles a delayed commit on retry after a response is lost before saving", async ({
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
    const zoom = editor.getByRole("slider", {
      name: "Media zoom",
      exact: true
    });
    await zoom.press("ArrowRight");
    let writes = 0;
    let delayedWrite:
      (PresentationValues & { expectedRevision: number }) | undefined;
    await page.route(
      `**/api/assets/${photo.id}/presentation`,
      async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        writes += 1;
        if (writes === 1) {
          delayedWrite = route.request().postDataJSON();
          await route.abort("connectionreset");
        } else await route.continue();
      }
    );
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(
      "Could not save these edits. Check your connection and try again."
    );
    await expect(save).toBeEnabled();
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
    expect((await getAsset(page, photo.id)).presentation?.revision).toBe(
      before.presentation!.revision
    );
    expect(delayedWrite).toBeDefined();
    const committed = await page.request.put(
      `${origin}/api/assets/${photo.id}/presentation`,
      { headers: await csrf(page), data: delayedWrite }
    );
    expect(committed.ok()).toBe(true);
    let readbacks = 0;
    await page.route(`**/api/assets/${photo.id}`, async (route) => {
      readbacks += 1;
      await route.continue();
    });
    await save.click();
    await expect(editor).toHaveCount(0);
    expect(readbacks).toBeGreaterThan(0);
    expect(writes).toBe(1);
    expect((await getAsset(page, photo.id)).presentation).toMatchObject({
      aspectFraming: { Square: { zoom: 1.01 } },
      revision: before.presentation!.revision + 1
    });
  } finally {
    await context.close();
  }
});

test("recognizes its earlier commit when an uncertain retry receives a conflict", async ({
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
    let delayedWrite:
      (PresentationValues & { expectedRevision: number }) | undefined;
    await page.route(
      `**/api/assets/${photo.id}/presentation`,
      async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        writes += 1;
        if (writes === 1) {
          delayedWrite = route.request().postDataJSON();
          await route.abort("connectionreset");
        } else await route.continue();
      }
    );
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(
      "Could not save these edits. Check your connection and try again."
    );
    await expect(save).toBeEnabled();
    expect(delayedWrite).toBeDefined();
    let readbacks = 0;
    await page.route(`**/api/assets/${photo.id}`, async (route) => {
      readbacks += 1;
      if (readbacks !== 1) {
        await route.continue();
        return;
      }
      const unchanged = await route.fetch();
      expect(unchanged.ok()).toBe(true);
      const committed = await page.request.put(
        `${origin}/api/assets/${photo.id}/presentation`,
        { headers: await csrf(page), data: delayedWrite }
      );
      expect(committed.ok()).toBe(true);
      // The original write completes after this retry's read was taken.
      await route.fulfill({ response: unchanged });
    });
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/assets/${photo.id}/presentation`) &&
        response.status() === 409
    );
    await save.click();
    expect((await conflict).status()).toBe(409);
    await expect(editor).toHaveCount(0);
    expect(readbacks).toBeGreaterThanOrEqual(2);
    expect(writes).toBe(2);
    expect((await getAsset(page, photo.id)).presentation).toMatchObject({
      aspectFraming: { Square: { zoom: 1.01 } },
      revision: before.presentation!.revision + 1
    });
  } finally {
    await context.close();
  }
});

for (const outcome of ["stale", "conflicting"] as const) {
  test(`retains the draft after a ${outcome} successful save response`, async ({
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
      const zoom = editor.getByRole("slider", {
        name: "Media zoom",
        exact: true
      });
      await zoom.press("ArrowRight");
      await page.route(
        `**/api/assets/${photo.id}/presentation`,
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              asset:
                outcome === "stale"
                  ? before
                  : {
                      ...before,
                      presentation: {
                        ...before.presentation,
                        revision: before.presentation!.revision + 1,
                        aspectFraming: {
                          Square: {
                            zoom: 1.8,
                            fit: "cover",
                            focalX: 0.5,
                            focalY: 0.5
                          }
                        }
                      }
                    }
            })
          });
        }
      );
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText(
        "These settings changed in another window. Reload them before saving."
      );
      await expect(editor).toBeVisible();
      await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
      await expect(
        editor.getByRole("button", { name: "Save", exact: true })
      ).toBeDisabled();
      await expect(
        editor.getByRole("button", {
          name: "Reload saved settings",
          exact: true
        })
      ).toBeVisible();
      const cancel = editor.getByRole("button", {
        name: "Cancel",
        exact: true
      });
      await expect(cancel).toBeEnabled();
      expect((await getAsset(page, photo.id)).presentation).toEqual(
        before.presentation
      );
      await cancel.click();
      await expect(editor).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

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
  let atlasGate = loadingGate();
  try {
    const page = await context.newPage();
    const animation = fixture("sequence.webp");
    await setPresentation(page, animation, defaults);
    let atlasReads = 0;
    await page.route(
      `**/api/assets/${animation.id}/animation/atlases/*`,
      async (route) => {
        atlasReads += 1;
        await atlasGate.promise;
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
    await expectSlimMediaLoading(feedAnimation);
    atlasGate.release();
    await expect(retry).toBeVisible();
    await expect(feedAnimation.getByRole("progressbar")).toHaveCount(0);
    expect(atlasReads).toBe(1);
    atlasGate = loadingGate();
    await retry.click();
    await expectSlimMediaLoading(feedAnimation);
    atlasGate.release();
    await expect(feedAnimation.locator("canvas")).toHaveCSS("opacity", "1");
    await expect(retry).toHaveCount(0);
    await expect(feedAnimation.getByRole("progressbar")).toHaveCount(0);
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
    atlasGate.release();
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
          editor.getByText("Preview couldn’t play. Press Play to retry.", {
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

test("does not start another save after an uncertain retry is unmounted by navigation", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  const gate = loadingGate();
  const readStarted = loadingGate();
  const readReleased = loadingGate();
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
        await route.abort("connectionreset");
      }
    );
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(
      "Could not save these edits."
    );
    await expect(save).toBeEnabled();
    await page.route(`**/api/assets/${photo.id}`, async (route) => {
      readStarted.release();
      await gate.promise;
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(before)
        })
        .catch(() => undefined);
      readReleased.release();
    });
    await save.click();
    await readStarted.promise;
    await expect(
      editor.getByRole("button", { name: "Saving…", exact: true })
    ).toBeDisabled();
    await page.evaluate(() => {
      const next = new URL(window.location.href);
      next.searchParams.delete("asset");
      next.searchParams.set("view", "feed");
      window.history.pushState(null, "", next);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Feed view", exact: true })
    ).toBeVisible();
    gate.release();
    await readReleased.promise;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect(writes).toBe(1);
    expect((await getAsset(page, photo.id)).presentation).toEqual(
      before.presentation
    );
  } finally {
    gate.release();
    await context.close();
  }
});

test("keeps a removed media save error beside the retained draft until the editor is closed", async ({
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
    const zoom = editor.getByRole("slider", {
      name: "Media zoom",
      exact: true
    });
    await zoom.press("ArrowRight");
    let writes = 0;
    await page.route(
      `**/api/assets/${photo.id}/presentation`,
      async (route) => {
        writes += 1;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "asset_not_found" })
        });
      }
    );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toHaveText(
      "This media is no longer available. Close the editor and check the library."
    );
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", { name: "Reload saved settings", exact: true })
    ).toHaveCount(0);
    const cancel = editor.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeEnabled();
    expect(writes).toBe(1);
    expect((await getAsset(page, photo.id)).presentation).toEqual(
      before.presentation
    );
    await cancel.click();
    await expect(editor).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("refetches mixed editor settings once before exposing playback controls", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const video = fixture("clip.mp4");
    await setPresentation(page, video, defaults);
    await open(page, "gallery", "video", video.name);
    let metadataReads = 0;
    let assetReads = 0;
    await page.route(`**/api/assets/${video.id}`, async (route) => {
      assetReads += 1;
      await route.continue();
    });
    await page.route(
      `**/api/assets/${video.id}/presentation-media`,
      async (route) => {
        metadataReads += 1;
        const response = await route.fetch();
        const capabilities =
          (await response.json()) as PresentationMediaCapabilities;
        await route.fulfill({
          response,
          json:
            metadataReads === 1
              ? {
                  ...capabilities,
                  durationMs: 1000,
                  renditionKeys: {
                    ...capabilities.renditionKeys,
                    full: "0".repeat(32)
                  }
                }
              : capabilities
        });
      }
    );
    await openGalleryEditor(page, video);
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(
      editor.getByRole("slider", { name: "Preview position", exact: true })
    ).toHaveAttribute("aria-valuemax", "6000");
    expect(metadataReads).toBe(2);
    expect(assetReads).toBe(2);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await context.close();
  }
});

test("keeps persistently mixed editor settings behind a dismissible bounded loading failure", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const video = fixture("clip.mp4");
    await setPresentation(page, video, defaults);
    await open(page, "gallery", "video", video.name);
    let metadataReads = 0;
    let assetReads = 0;
    let mismatch = true;
    await page.route(`**/api/assets/${video.id}`, async (route) => {
      assetReads += 1;
      await route.continue();
    });
    await page.route(
      `**/api/assets/${video.id}/presentation-media`,
      async (route) => {
        metadataReads += 1;
        const response = await route.fetch();
        const capabilities =
          (await response.json()) as PresentationMediaCapabilities;
        await route.fulfill({
          response,
          json: mismatch
            ? {
                ...capabilities,
                durationMs: 1000,
                renditionKeys: {
                  ...capabilities.renditionKeys,
                  bounce: "0".repeat(32)
                }
              }
            : capabilities
        });
      }
    );
    await openGalleryEditor(page, video);
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(
      editor.getByText("Could not open this file’s settings.", { exact: true })
    ).toBeVisible();
    expect(metadataReads).toBe(2);
    expect(assetReads).toBe(2);
    await expect(editor.getByRole("slider")).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", { name: "Cancel", exact: true })
    ).toBeEnabled();
    mismatch = false;
    await editor.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      editor.getByRole("slider", { name: "Preview position", exact: true })
    ).toHaveAttribute("aria-valuemax", "6000");
    expect(metadataReads).toBe(3);
    expect(assetReads).toBe(3);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await context.close();
  }
});

test("preserves the current draft when reloading receives inconsistent media settings", async ({
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
    await setPresentation(page, photo, {
      ...defaults,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.5, focalY: 0.5, zoom: 1.8 }
      }
    });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const reload = editor.getByRole("button", {
      name: "Reload saved settings",
      exact: true
    });
    await expect(reload).toBeVisible();
    let mismatch = true;
    let metadataReads = 0;
    await page.route(
      `**/api/assets/${photo.id}/presentation-media`,
      async (route) => {
        metadataReads += 1;
        const response = await route.fetch();
        const capabilities =
          (await response.json()) as PresentationMediaCapabilities;
        await route.fulfill({
          response,
          json: mismatch
            ? {
                ...capabilities,
                renditionKeys: {
                  ...capabilities.renditionKeys,
                  highlight: "0".repeat(32)
                }
              }
            : capabilities
        });
      }
    );
    const preview = editor.locator(".media-editor-frame img");
    const retainedNode = await preview.elementHandle();
    expect(retainedNode).not.toBeNull();
    await reload.click();
    await expect(editor.getByRole("alert").locator("p")).toHaveText(
      "Could not reload saved settings. Check your connection and try again."
    );
    expect(metadataReads).toBe(2);
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
    expect(
      await preview.evaluate(
        (node, previous) => node === previous,
        retainedNode
      )
    ).toBe(true);
    await expect(reload).toBeEnabled();
    await expect(
      editor.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
    mismatch = false;
    await reload.click();
    await expect(zoom).toHaveAttribute("aria-valuenow", "1.8");
    await expect(editor.getByRole("alert")).toHaveCount(0);
    expect(metadataReads).toBe(3);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await context.close();
  }
});

test("does not confirm an uncertain Reset save against a replacement source with matching defaults", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, {
      ...defaults,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.5, focalY: 0.5, zoom: 2 }
      }
    });
    const before = await getAsset(page, photo.id);
    const capabilities = (await (
      await page.request.get(
        `${origin}/api/assets/${photo.id}/presentation-media`
      )
    ).json()) as PresentationMediaCapabilities;
    await open(page, "gallery", "image", photo.name);
    await openGalleryEditor(page, photo);
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    const replacement: AssetRecord = {
      ...before,
      mtimeMs: before.mtimeMs + 1,
      sizeBytes: before.sizeBytes + 1,
      presentation: {
        ...defaults,
        revision: before.presentation!.revision + 1,
        renditionKeys: {
          full: "a".repeat(32),
          highlight: "b".repeat(32),
          bounce: "c".repeat(32)
        }
      }
    };
    await page.route(`**/api/assets/${photo.id}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(replacement)
      })
    );
    await page.route(`**/api/assets/${photo.id}/presentation-media`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...capabilities,
          renditionKeys: replacement.presentation!.renditionKeys
        })
      })
    );
    let writes = 0;
    await page.route(
      `**/api/assets/${photo.id}/presentation`,
      async (route) => {
        writes += 1;
        await route.abort("connectionreset");
      }
    );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toHaveText(
      "The source file changed. Close this editor and scan the library before editing again."
    );
    await expect(editor).toBeVisible();
    expect(writes).toBe(1);
    await expect(
      editor.getByRole("button", { name: "Reload saved settings", exact: true })
    ).toHaveCount(0);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await openGalleryEditor(page, photo);
    await expect(
      editor.getByRole("slider", { name: "Media zoom", exact: true })
    ).toHaveAttribute("aria-valuenow", "1");
    await expect(editor.locator(".media-editor-frame img")).toHaveAttribute(
      "src",
      `/api/assets/${photo.id}/media?v=${replacement.mtimeMs}-${replacement.sizeBytes}`
    );
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await getAsset(page, photo.id)).presentation).toEqual(
      before.presentation
    );
  } finally {
    await context.close();
  }
});

for (const mediaType of ["image", "video"] as const) {
  test(`recovers a failed ${mediaType} editor preview after a source version change and explicit reload`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    const name = `editor-reload-recovery.${mediaType === "image" ? "png" : "mp4"}`;
    const sourcePath = path.join(directory, name);
    try {
      if (mediaType === "image")
        await sharp({
          create: {
            width: 260,
            height: 130,
            channels: 3,
            background: "#7797bb"
          }
        })
          .png()
          .toFile(sourcePath);
      else
        await promisify(execFile)("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:size=256x128:rate=24",
          "-t",
          "4",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-y",
          sourcePath
        ]);
      await scan(page);
      const current = (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse;
      const asset = current.items.find((entry) => entry.name === name)!;
      expect(asset).toBeTruthy();
      await open(page, "gallery", mediaType, name);
      await openGalleryEditor(page, asset);
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      const preview = editor.locator(
        `.media-editor-frame ${mediaType === "image" ? "img" : "video"}`
      );
      await expect
        .poll(() =>
          preview.evaluate((node) =>
            node instanceof HTMLVideoElement
              ? node.readyState >= 1
              : (node as HTMLImageElement).complete &&
                (node as HTMLImageElement).naturalWidth > 0
          )
        )
        .toBe(true);
      if (mediaType === "video")
        await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      await editor
        .getByRole("slider", { name: "Media zoom", exact: true })
        .press("ArrowRight");
      await preview.dispatchEvent("error");
      const unavailable = editor.getByText(
        mediaType === "image"
          ? "Preview unavailable."
          : "Video preview unavailable.",
        { exact: true }
      );
      await expect(unavailable).toBeVisible();
      if (mediaType === "video")
        await expect(
          editor.getByRole("button", { name: "Play preview", exact: true })
        ).toBeDisabled();
      await editor
        .getByRole("combobox", { name: "Media layout", exact: true })
        .click();
      await page.getByRole("option", { name: "Portrait", exact: true }).click();
      await expect(unavailable).toBeVisible();
      if (mediaType === "video") {
        await editor
          .getByRole("tab", { name: "Playback", exact: true })
          .click();
        await editor.getByRole("tab", { name: "Framing", exact: true }).click();
        await expect(preview).toHaveCount(0);
      } else await expect(preview).toHaveCount(0);
      const touched = new Date(asset.mtimeMs + 2000);
      await utimes(sourcePath, touched, touched);
      await scan(page);
      const refreshed = await getAsset(page, asset.id);
      expect(refreshed.id).toBe(asset.id);
      expect(`${refreshed.mtimeMs}-${refreshed.sizeBytes}`).not.toBe(
        `${asset.mtimeMs}-${asset.sizeBytes}`
      );
      await setPresentation(page, asset, {
        ...defaults,
        aspectFraming: {
          Square: { fit: "cover", focalX: 0.5, focalY: 0.5, zoom: 1.8 }
        }
      });
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      const reload = editor.getByRole("button", {
        name: "Reload saved settings",
        exact: true
      });
      await expect(reload).toBeVisible();
      await reload.click();
      await expect(unavailable).toHaveCount(0);
      await expect(preview).toHaveAttribute(
        "src",
        `/api/assets/${asset.id}/media?v=${refreshed.mtimeMs}-${refreshed.sizeBytes}`
      );
      await expect
        .poll(() =>
          preview.evaluate((node) =>
            node instanceof HTMLVideoElement
              ? node.readyState >= 1 && Math.abs(node.duration - 4) < 0.05
              : (node as HTMLImageElement).complete &&
                (node as HTMLImageElement).naturalWidth === 260
          )
        )
        .toBe(true);
      if (mediaType === "video") {
        const play = editor.getByRole("button", {
          name: "Play preview",
          exact: true
        });
        await expect(play).toBeEnabled();
        await expect(
          editor.getByRole("slider", { name: "Preview position", exact: true })
        ).toHaveAttribute("aria-valuemax", "4000");
        await play.click();
        await expect
          .poll(() =>
            preview.evaluate((node: HTMLVideoElement) => node.currentTime)
          )
          .toBeGreaterThan(0.1);
      }
      const retainedNode = await preview.elementHandle();
      expect(retainedNode).not.toBeNull();
      await editor
        .getByRole("combobox", { name: "Media layout", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Landscape", exact: true })
        .click();
      if (mediaType === "video") {
        await editor
          .getByRole("tab", { name: "Playback", exact: true })
          .click();
        await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      }
      expect(
        await preview.evaluate(
          (node, previous) => node === previous,
          retainedNode
        )
      ).toBe(true);
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally {
      await rm(sourcePath, { force: true });
      try {
        await scan(page);
      } finally {
        await context.close();
      }
    }
  });
}

test("shows current time validation after a failed save and retries the corrected draft", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const video = fixture("clip.mp4");
    await setPresentation(page, video, defaults);
    await open(page, "gallery", "video", video.name);
    await openGalleryEditor(page, video);
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await editor.getByRole("combobox", { name: "Speed", exact: true }).click();
    await page.getByRole("option", { name: "0.5×", exact: true }).click();
    let failureCode: string | null = "presentation_save_failed";
    await page.route(
      `**/api/assets/${video.id}/presentation`,
      async (route) => {
        if (route.request().method() !== "PUT" || failureCode === null) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: failureCode })
        });
      }
    );
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await save.click();
    const alert = editor.getByRole("alert");
    await expect(alert).toHaveText("Could not save these edits. Try again.");
    const start = editor.getByRole("textbox", {
      name: "Start time",
      exact: true
    });
    await start.fill("invalid");
    await expect(start).toHaveAttribute("aria-invalid", "true");
    await expect(alert).toHaveText(
      "Enter a valid time within the selected range."
    );
    await expect(save).toBeDisabled();
    await start.fill("0:00.500");
    await expect(start).toHaveAttribute("aria-invalid", "false");
    const end = editor.getByRole("textbox", { name: "End time", exact: true });
    await end.fill("invalid");
    await expect(end).toHaveAttribute("aria-invalid", "true");
    await expect(alert).toHaveText(
      "Enter a valid time within the selected range."
    );
    await end.fill("0:02.000");
    await expect(end).toHaveAttribute("aria-invalid", "false");
    await expect(alert).toHaveCount(0);
    await expect(save).toBeEnabled();
    failureCode = "processing_busy";
    await save.click();
    await expect(alert).toHaveText(
      "The server is busy. Try again in a moment."
    );
    await expect(save).toBeEnabled();
    failureCode = null;
    await save.click();
    await expect(editor).toHaveCount(0);
    expect((await getAsset(page, video.id)).presentation).toMatchObject({
      playbackRate: 0.5,
      highlight: { startMs: 500, endMs: 2000 }
    });
  } finally {
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
    await expectSlimMediaLoading(shell);
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
    await expect(shell.getByRole("progressbar")).toHaveCount(0);
  } finally {
    release();
    await context.close();
  }
});

test("retains the viewer thumbnail through capability checks and original image decoding", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  const capabilitiesGate = loadingGate();
  const originalGate = loadingGate();
  try {
    const page = await context.newPage();
    const asset = fixture("photo.png");
    await setPresentation(page, asset, {
      ...defaults,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.2, focalY: 0.8, zoom: 1.4 }
      }
    });
    await page.route(
      `**/api/assets/${asset.id}/presentation-media`,
      async (route) => {
        await capabilitiesGate.promise;
        await route.continue().catch(() => undefined);
      }
    );
    await page.route(`**/api/assets/${asset.id}/media?*`, async (route) => {
      await originalGate.promise;
      await route.continue().catch(() => undefined);
    });
    await page.goto(
      `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&asset=${asset.id}`
    );
    const viewer = page.getByRole("dialog", { name: asset.name, exact: true });
    const frame = viewer.locator(".viewer-media-frame");
    const thumbnail = frame.locator(".viewer-image-thumbnail");
    const original = frame.locator(".viewer-image-original");
    await expect(thumbnail).toHaveAttribute("src", /\/thumbnail\?/);
    await expect
      .poll(() =>
        thumbnail.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0
        )
      )
      .toBe(true);
    await expect(frame).toHaveClass(/is-ready/);
    await expect(frame).not.toHaveClass(/is-image-ready/);
    await expect(thumbnail).toHaveCSS("opacity", "1");
    await expect(original).toHaveCount(0);
    await thumbnail.evaluate((node) => {
      node.setAttribute("data-continuity", "retained-thumbnail");
    });
    const menu = await openViewerOptions(viewer);
    await menu
      .getByRole("menuitemcheckbox", { name: "Use saved framing", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(thumbnail).toHaveCSS("object-position", "20% 80%");
    const loadingBounds = await expectSlimMediaLoading(frame);
    capabilitiesGate.release();
    await expect(original).toHaveAttribute("src", /\/media\?/);
    await expect(frame).toHaveClass(/is-ready/);
    await expect(frame).not.toHaveClass(/is-image-ready/);
    await expect(thumbnail).toHaveAttribute(
      "data-continuity",
      "retained-thumbnail"
    );
    await expect(thumbnail).toHaveAttribute("src", /\/thumbnail\?/);
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
    await expectSlimMediaLoading(frame);
    originalGate.release();
    await expect(frame).toHaveClass(/is-image-ready/);
    await expect(original).toHaveCSS("opacity", "1");
    await expect(thumbnail).toHaveCSS("opacity", "0");
    await expect(frame.getByRole("progressbar")).toHaveCount(0);
    const readyBounds = (await frame.boundingBox())!;
    for (const property of ["x", "y", "width", "height"] as const)
      expect(readyBounds[property]).toBeCloseTo(loadingBounds[property], 0);
  } finally {
    capabilitiesGate.release();
    originalGate.release();
    await context.close();
  }
});

for (const format of ["jpg", "heic"] as const) {
  test(`retains a ${format.toUpperCase()} viewer thumbnail through failure, retry and interrupted navigation`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    const name = `loading-photo.${format}`;
    const sourcePath = path.join(directory, name);
    let originalGate = loadingGate();
    let failOriginal = true;
    try {
      if (format === "heic")
        await copyFile(
          path.resolve(".e2e/aether-data/cache/e2e-fixtures/heic/source.heic"),
          sourcePath
        );
      else
        await sharp(path.join(directory, "photo.png"))
          .jpeg()
          .toFile(sourcePath);
      await scan(page);
      const current = (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse;
      const asset = current.items.find((entry) => entry.name === name)!;
      expect(asset).toBeTruthy();
      const endpoint = format === "heic" ? "display" : "media";
      await page.route(
        `**/api/assets/${asset.id}/${endpoint}?*`,
        async (route) => {
          await originalGate.promise;
          if (failOriginal)
            await route.fulfill({ status: 503, body: "Image unavailable" });
          else await route.continue().catch(() => undefined);
        }
      );
      const url = `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=image&sort=filename&asset=${asset.id}`;
      await page.goto(url);
      const viewer = page.getByRole("dialog", { name, exact: true });
      const frame = viewer.locator(".viewer-media-frame");
      const thumbnail = frame.locator(".viewer-image-thumbnail");
      const original = frame.locator(".viewer-image-original");
      await expect(thumbnail).toHaveAttribute(
        "src",
        new RegExp(`/api/assets/${asset.id}/thumbnail\\?`)
      );
      await expect
        .poll(() =>
          thumbnail.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0
          )
        )
        .toBe(true);
      await expect(thumbnail).toHaveCSS("opacity", "1");
      await expect(original).toHaveCSS("opacity", "0");
      await expectSlimMediaLoading(frame);
      originalGate.release();
      const retry = viewer.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await expect(
        viewer.getByText("Image unavailable.", { exact: true })
      ).toBeVisible();
      await expect(frame).not.toHaveClass(/is-image-ready/);
      await expect(thumbnail).toHaveCSS("opacity", "1");
      await expect(original).toHaveCount(0);
      await expect(frame.getByRole("progressbar")).toHaveCount(0);

      failOriginal = false;
      originalGate = loadingGate();
      await retry.click();
      await expectSlimMediaLoading(frame);
      await expect(thumbnail).toHaveCSS("opacity", "1");
      await expect(original).toHaveCSS("opacity", "0");
      originalGate.release();
      await expect(frame).toHaveClass(/is-image-ready/);
      await expect(original).toHaveCSS("opacity", "1");
      await expect(thumbnail).toHaveCSS("opacity", "0");
      await expect(retry).toHaveCount(0);

      originalGate = loadingGate();
      await page.reload();
      await expect(thumbnail).toHaveCSS("opacity", "1");
      await expectSlimMediaLoading(frame);
      await viewer
        .getByRole("button", { name: "Next media", exact: true })
        .click();
      const nextViewer = page.getByRole("dialog", {
        name: "photo.png",
        exact: true
      });
      const nextFrame = nextViewer.locator(".viewer-media-frame");
      await expect(nextFrame).toHaveClass(/is-image-ready/);
      const nextOriginal = nextFrame.locator(".viewer-image-original");
      const nextSource = await nextOriginal.getAttribute("src");
      expect(nextSource).toContain(
        `/api/assets/${fixture("photo.png").id}/media?`
      );
      originalGate.release();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      await expect(nextOriginal).toHaveAttribute("src", nextSource!);
      await expect(nextFrame).toHaveClass(/is-image-ready/);
      await nextViewer
        .getByRole("button", { name: "Previous media", exact: true })
        .click();
      await expect(frame).toHaveClass(/is-image-ready/);
      await expect(original).toHaveAttribute(
        "src",
        new RegExp(`/api/assets/${asset.id}/${endpoint}\\?`)
      );
    } finally {
      originalGate.release();
      try {
        await rm(sourcePath, { force: true });
        await scan(page);
      } finally {
        await context.close();
      }
    }
  });
}

test("rejects mixed playback metadata without caching it and recovers on Retry", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const asset = fixture("clip.mp4");
    await setPresentation(page, asset, {
      ...defaults,
      highlight: { startMs: 500, endMs: 2000 },
      loopMode: "bounce"
    });
    const current = await getAsset(page, asset.id);
    const mismatched = "f".repeat(32);
    expect(current.presentation!.renditionKeys.bounce).not.toBe(mismatched);
    let reads = 0;
    let wrongPlaybackRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.endsWith(`/assets/${asset.id}/playback`) &&
        url.searchParams.get("v") === mismatched
      )
        wrongPlaybackRequests += 1;
    });
    await page.route(
      `**/api/assets/${asset.id}/presentation-media`,
      async (route) => {
        reads += 1;
        const response = await route.fetch();
        if (reads !== 1) {
          await route.fulfill({ response });
          return;
        }
        const capabilities = await response.json();
        await route.fulfill({
          response,
          json: {
            ...capabilities,
            renditionKeys: { ...capabilities.renditionKeys, bounce: mismatched }
          }
        });
      }
    );
    await open(page, "feed", "video", asset.name, true);
    const item = page.locator(".feed-item").first();
    await expect(
      item.getByText("Media changed. Try again.", { exact: true })
    ).toBeVisible();
    expect(wrongPlaybackRequests).toBe(0);
    expect(reads).toBe(1);
    await item.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(item.locator("video")).toHaveAttribute(
      "src",
      new RegExp(
        `playback\\?variant=bounce&v=${current.presentation!.renditionKeys.bounce}`
      )
    );
    await expect.poll(() => reads).toBe(2);
    await expect(
      item.getByText("Media changed. Try again.", { exact: true })
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("loads the viewer original when its thumbnail is unavailable", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  const originalGate = loadingGate();
  try {
    const page = await context.newPage();
    const asset = fixture("photo.png");
    await page.route(`**/api/assets/${asset.id}/thumbnail?*`, (route) =>
      route.fulfill({ status: 404, body: "Thumbnail unavailable" })
    );
    await page.route(`**/api/assets/${asset.id}/media?*`, async (route) => {
      await originalGate.promise;
      await route.continue().catch(() => undefined);
    });
    await page.goto(
      `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=image&asset=${asset.id}`
    );
    const viewer = page.getByRole("dialog", { name: asset.name, exact: true });
    const frame = viewer.locator(".viewer-media-frame");
    await expect(frame).toBeVisible();
    await expect(frame.locator(".viewer-image-thumbnail")).toHaveCount(0);
    await expect(frame).not.toHaveClass(/is-image-ready/);
    await expectSlimMediaLoading(frame);
    originalGate.release();
    await expect(frame).toHaveClass(/is-image-ready/);
    await expect(frame.locator(".viewer-image-original")).toHaveCSS(
      "opacity",
      "1"
    );
    await expect(frame.getByRole("progressbar")).toHaveCount(0);
  } finally {
    originalGate.release();
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
    const image = viewer.locator(".viewer-image-original");
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
    await expect(viewer.locator(".viewer-image-original")).toHaveJSProperty(
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
    await expect(viewer.locator(".viewer-image-original")).toHaveCSS(
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
    let incompatibleCodec = false;
    await page.route(`**/api/assets/${asset.id}/media?*`, async (route) => {
      if (!incompatibleCodec) await route.abort("failed");
      else if (route.request().method() === "HEAD") await route.continue();
      else
        await route.fulfill({
          status: 200,
          contentType: "video/mp4",
          body: "unplayable"
        });
    });
    await open(page, "feed", "video", asset.name, true);
    const notice = page.locator(".feed-item .media-error-notice").first();
    await expect(notice).toContainText("Media could not be reached.");
    await expect(video).toHaveAttribute("src", /\/media(?:\?|$)/);
    expect(encodedReads).toBe(0);
    incompatibleCodec = true;
    await notice.getByRole("button", { name: "Retry", exact: true }).click();
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
  const response = await page.request.get(`${origin}/api/assets/${id}`);
  expect(response.ok(), `Asset ${id} remains indexed`).toBe(true);
  return response.json();
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

function loadingGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function expectSlimMediaLoading(surface: Locator) {
  const bar = surface.getByRole("progressbar", {
    name: "Loading media",
    exact: true
  });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS("opacity", "1");
  expect(await bar.getAttribute("aria-valuenow")).toBeNull();
  const bounds = (await bar.boundingBox())!;
  const frame = (await surface.boundingBox())!;
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.height).toBeLessThanOrEqual(3);
  expect(Math.abs(bounds.y - frame.y)).toBeLessThanOrEqual(1);
  expect(bounds.x).toBeGreaterThanOrEqual(frame.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    frame.x + frame.width + 1
  );
  await expect(bar).toHaveCSS("pointer-events", "none");
  await expect(bar).toHaveCSS("position", "absolute");
  return frame;
}

for (const hasPoster of [true, false]) {
  test(`prepares an in-place animation highlight ${hasPoster ? "above its retained poster" : "without a thumbnail"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState });
    const selectedAtlasGate = loadingGate();
    try {
      const page = await context.newPage();
      const asset = fixture("sequence.webp");
      if (!hasPoster)
        await page.route(/\/(?:thumbnail|presentation-poster)\?/, (route) =>
          route.fulfill({ status: 404, body: "Thumbnail unavailable" })
        );
      await setPresentation(page, asset, {
        ...defaults,
        highlight: { startMs: 600, endMs: 1200 }
      });
      const frames = await Promise.all(
        [32, 240].map((value) =>
          sharp({
            create: {
              width: 96,
              height: 64,
              channels: 4,
              background: { r: value, g: value, b: value, alpha: 0.5 }
            }
          })
            .png()
            .toBuffer()
        )
      );
      await page.route(
        `**/api/assets/${asset.id}/animation?*`,
        async (route) => {
          const key = new URL(route.request().url()).searchParams.get("v")!;
          await route.fulfill({
            json: {
              kind: "animation",
              width: 96,
              height: 64,
              durationMs: 1200,
              atlases: [0, 1].map((index) => ({
                url: `/api/assets/${asset.id}/animation/atlases/${index}?v=${encodeURIComponent(key)}`,
                width: 96,
                height: 64
              })),
              frames: [0, 1].map((index) => ({
                startMs: index * 600,
                durationMs: 600,
                atlas: index,
                x: 0,
                y: 0,
                width: 96,
                height: 64
              }))
            }
          });
        }
      );
      await page.route(
        `**/api/assets/${asset.id}/animation/atlases/*`,
        async (route) => {
          const selected = new URL(route.request().url()).pathname.endsWith(
            "/1"
          );
          if (selected) await selectedAtlasGate.promise;
          await route
            .fulfill({
              contentType: "image/png",
              body: frames[selected ? 1 : 0]!
            })
            .catch(() => undefined);
        }
      );
      await page.goto(
        `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=image&highlight=0&asset=${asset.id}`
      );
      const viewer = page.getByRole("dialog", {
        name: asset.name,
        exact: true
      });
      const canvas = viewer.locator("canvas");
      await expect(canvas).toHaveCSS("opacity", "1");
      await expect(
        page
          .locator(".media-tile")
          .filter({
            has: page.getByRole("button", {
              name: `Open ${asset.name}`,
              exact: true,
              includeHidden: true
            })
          })
          .locator(".media-image-loading")
      ).toHaveCSS("opacity", "0");
      await viewer
        .getByRole("button", { name: "Pause video", exact: true })
        .click();
      const menu = await openViewerOptions(viewer);
      await menu
        .getByRole("menuitemcheckbox", {
          name: "Play highlights only",
          exact: true
        })
        .click();
      await page.keyboard.press("Escape");
      const thumbnail = viewer.locator(".viewer-image-thumbnail");
      if (hasPoster) {
        await expect(thumbnail).toHaveAttribute(
          "src",
          /presentation-poster\?variant=highlight/
        );
        await expect(thumbnail).toHaveCSS("opacity", "1");
      } else await expect(thumbnail).toHaveCount(0);
      await expect(canvas).toHaveCSS("opacity", "0");
      await expect(viewer.locator(".controlled-animation__poster")).toHaveCount(
        0
      );
      await expectSlimMediaLoading(viewer.locator(".viewer-media-frame"));
      selectedAtlasGate.release();
      await expect(canvas).toHaveCSS("opacity", "1");
      if (hasPoster) await expect(thumbnail).toHaveCSS("opacity", "0");
      await expect
        .poll(() =>
          canvas.evaluate((node: HTMLCanvasElement) => {
            const pixel = node.getContext("2d")!.getImageData(0, 0, 1, 1).data;
            return { selectedFrame: pixel[0]! > 230, alpha: pixel[3] };
          })
        )
        .toEqual({ selectedFrame: true, alpha: 128 });
      await expect(viewer.getByRole("progressbar")).toHaveCount(0);
    } finally {
      selectedAtlasGate.release();
      await context.close();
    }
  });
}

test("retains the selected animation frame through capability checks and atlas loading", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  let capabilitiesGate = loadingGate();
  let atlasGate = loadingGate();
  try {
    const page = await context.newPage();
    const asset = fixture("sequence.webp");
    await setPresentation(page, asset, {
      ...defaults,
      highlight: { startMs: 300, endMs: 1200 }
    });
    await page.route(
      `**/api/assets/${asset.id}/presentation-media`,
      async (route) => {
        await capabilitiesGate.promise;
        await route.continue().catch(() => undefined);
      }
    );
    await page.route(
      `**/api/assets/${asset.id}/animation/atlases/*`,
      async (route) => {
        await atlasGate.promise;
        await route.continue().catch(() => undefined);
      }
    );
    for (const surfaceName of ["gallery", "viewer"] as const) {
      capabilitiesGate = loadingGate();
      atlasGate = loadingGate();
      if (surfaceName === "viewer")
        await page.goto(
          `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=image&highlight=1&asset=${asset.id}`
        );
      else await open(page, "gallery", "image", asset.name, true);
      const surface =
        surfaceName === "viewer"
          ? page
              .getByRole("dialog", { name: asset.name, exact: true })
              .locator(".viewer-media-frame")
          : page
              .locator(".media-tile")
              .filter({
                has: page.getByRole("button", {
                  name: `Open ${asset.name}`,
                  exact: true,
                  includeHidden: true
                })
              })
              .locator(".media-image-shell");
      const thumbnail = surface.locator(
        surfaceName === "viewer" ? ".viewer-image-thumbnail" : ":scope > img"
      );
      await expect(thumbnail).toHaveAttribute(
        "src",
        /\/presentation-poster\?variant=highlight/
      );
      await expect
        .poll(() =>
          thumbnail.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0
          )
        )
        .toBe(true);
      const posterSource = await thumbnail.getAttribute("src");
      const selectedPixel = await thumbnail.evaluate(
        (node: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const drawing = canvas.getContext("2d")!;
          drawing.drawImage(node, 0, 0, 1, 1);
          return drawing.getImageData(0, 0, 1, 1).data[0];
        }
      );
      expect(selectedPixel).toBeGreaterThan(100);
      expect(selectedPixel).toBeLessThan(170);
      await expect(thumbnail).toHaveCSS("opacity", "1");
      await thumbnail.evaluate((node) => {
        node.setAttribute("data-continuity", "retained-animation-poster");
      });
      await expect(thumbnail).toHaveCSS("transition-duration", "0s");
      await expectSlimMediaLoading(surface);
      capabilitiesGate.release();
      const animation = surface.locator(".controlled-animation");
      await expect(animation).toBeVisible();
      const poster = animation.locator(".controlled-animation__poster");
      await expect(poster).toHaveCount(0);
      await expect(animation.locator("canvas")).toHaveCSS("opacity", "0");
      await expect(thumbnail).toHaveAttribute("src", posterSource!);
      await expect(thumbnail).toHaveAttribute(
        "data-continuity",
        "retained-animation-poster"
      );
      await expect(thumbnail).toHaveCSS("opacity", "1");
      atlasGate.release();
      await expect(animation.locator("canvas")).toHaveCSS("opacity", "1");
      await expect(thumbnail).toHaveCSS("opacity", "0");
      await expect(surface.getByRole("progressbar")).toHaveCount(0);
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
      await expect(animation.locator("canvas")).toHaveJSProperty("width", 0);
      await expect(thumbnail).toHaveCSS("opacity", "1");
      await expect(surface.getByRole("progressbar")).toHaveCount(0);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible"
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(animation.locator("canvas")).toHaveCSS("opacity", "1");
      await expect(thumbnail).toHaveCSS("opacity", "0");
    }
  } finally {
    capabilitiesGate.release();
    atlasGate.release();
    await context.close();
  }
});

for (const surfaceName of ["gallery", "feed", "viewer"] as const) {
  test(`shows a slim loading bar above the retained Bounce poster in ${surfaceName}`, async ({
    browser
  }, testInfo) => {
    const phone = surfaceName === "feed";
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      hasTouch: phone,
      isMobile: phone,
      reducedMotion: phone ? "reduce" : "no-preference"
    });
    let capabilitiesGate = loadingGate();
    let playbackGate = loadingGate();
    let failCapabilities = phone;
    let failPlayback = phone;
    try {
      const page = await context.newPage();
      const asset = fixture("clip.mp4");
      await setPresentation(page, asset, {
        ...defaults,
        highlight: { startMs: 300, endMs: 1300 },
        loopMode: "bounce"
      });
      await page.route(
        `**/api/assets/${asset.id}/presentation-media`,
        async (route) => {
          await capabilitiesGate.promise;
          if (failCapabilities) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: '{"error":"processing_busy"}'
            });
          } else await route.continue().catch(() => undefined);
        }
      );
      await page.route(
        `**/api/assets/${asset.id}/playback?*`,
        async (route) => {
          await playbackGate.promise;
          if (failPlayback) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: '{"error":"processing_busy"}'
            });
          } else await route.continue().catch(() => undefined);
        }
      );
      if (surfaceName === "viewer") {
        await page.goto(
          `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&sort=filename&highlight=1&asset=${asset.id}`
        );
      } else await open(page, surfaceName, "video", asset.name, true);
      const viewer = page.getByRole("dialog", {
        name: asset.name,
        exact: true
      });
      const surface =
        surfaceName === "viewer"
          ? viewer.locator(".viewer-media-frame")
          : page
              .locator(
                surfaceName === "feed"
                  ? ".feed-item .media-video-shell"
                  : ".media-tile .media-video-shell"
              )
              .first();
      const poster = surface.locator(
        surfaceName === "viewer"
          ? ".viewer-video-poster"
          : ".media-video-poster"
      );
      await expect(poster).toHaveAttribute(
        "src",
        /\/presentation-poster\?variant=highlight/
      );
      const initialPosterSource = await poster.getAttribute("src");
      await expect
        .poll(() =>
          poster.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0
          )
        )
        .toBe(true);
      await expect(poster).toHaveCSS("opacity", "1");
      const loadingBounds = await expectSlimMediaLoading(surface);
      if (surfaceName === "gallery") {
        const card = page.locator(".media-tile").first();
        await expect(card).toHaveCSS("overflow", "hidden");
        expect(
          await card.evaluate((node) =>
            Number.parseFloat(getComputedStyle(node).borderTopLeftRadius)
          )
        ).toBeGreaterThan(0);
      }
      await expect(surface.locator("video")).not.toHaveAttribute("src");
      capabilitiesGate.release();
      if (phone) {
        const retry = surface.getByRole("button", {
          name: "Retry",
          exact: true
        });
        await expect(retry).toBeVisible();
        await expect(surface.getByRole("progressbar")).toHaveCount(0);
        await expect(surface.locator("video")).not.toHaveAttribute("src");
        await expect(poster).toHaveCSS("opacity", "1");
        failCapabilities = false;
        capabilitiesGate = loadingGate();
        await retry.tap();
        await expectSlimMediaLoading(surface);
        await expect(surface.locator("video")).not.toHaveAttribute("src");
        capabilitiesGate.release();
      }
      await expect(surface.locator("video")).toHaveAttribute(
        "src",
        /playback\?variant=bounce/
      );
      await expect(poster).toHaveAttribute("src", initialPosterSource!);
      await expectSlimMediaLoading(surface);
      await expect(poster).toHaveCSS("opacity", "1");
      if (surfaceName !== "viewer")
        await page.screenshot({
          path: testInfo.outputPath(`media-loading-${surfaceName}.png`)
        });
      if (phone) {
        const bar = surface.getByRole("progressbar");
        expect(
          await bar.evaluate((element) =>
            [element, ...element.querySelectorAll("*")].every((node) =>
              [null, "::before", "::after"].every(
                (pseudo) =>
                  getComputedStyle(node, pseudo).animationName === "none"
              )
            )
          )
        ).toBe(true);
        for (const hidden of [true, false]) {
          await page.evaluate((hidden) => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: hidden ? "hidden" : "visible"
            });
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: hidden
            });
            document.dispatchEvent(new Event("visibilitychange"));
          }, hidden);
          if (hidden) await expect(bar).toHaveCount(0);
          else await expectSlimMediaLoading(surface);
        }
        playbackGate.release();
        const retry = surface.getByRole("button", {
          name: "Retry",
          exact: true
        });
        await expect(retry).toBeVisible();
        await expect(bar).toHaveCount(0);
        await expect(poster).toHaveCSS("opacity", "1");
        failPlayback = false;
        playbackGate = loadingGate();
        await retry.tap();
        await expectSlimMediaLoading(surface);
      }
      playbackGate.release();
      await expect
        .poll(() =>
          surface
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0);
      await expect(surface).toHaveClass(
        surfaceName === "viewer" ? /is-video-ready/ : /(?:^| )ready(?: |$)/
      );
      await expect(surface.getByRole("progressbar")).toHaveCount(0);
      const readyBounds = (await surface.boundingBox())!;
      for (const property of ["x", "y", "width", "height"] as const)
        expect(readyBounds[property]).toBeCloseTo(loadingBounds[property], 0);

      const playingVideo = surface.locator("video");
      const playingSource = await playingVideo.getAttribute("src");
      await playingVideo.evaluate((video: HTMLVideoElement) => {
        video.dataset.bufferingProbe = "same-element";
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 2
        });
        video.dispatchEvent(new Event("waiting"));
      });
      await expectSlimMediaLoading(surface);
      await expect(surface).toHaveClass(
        surfaceName === "viewer" ? /is-video-ready/ : /(?:^| )ready(?: |$)/
      );
      if (surfaceName === "viewer") await expect(poster).toHaveCount(0);
      else await expect(poster).toHaveCSS("opacity", "0");
      await expect(playingVideo).toHaveCSS("opacity", "1");
      await expect(playingVideo).toHaveAttribute("src", playingSource!);
      await playingVideo.evaluate((video: HTMLVideoElement) => {
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 4
        });
        video.dispatchEvent(new Event("playing"));
      });
      await expect(surface.getByRole("progressbar")).toHaveCount(0);
      await expect(playingVideo).toHaveAttribute(
        "data-buffering-probe",
        "same-element"
      );
      await playingVideo.evaluate((video: HTMLVideoElement) => {
        video.pause();
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 2
        });
        video.dispatchEvent(new Event("waiting"));
      });
      await expect(surface.getByRole("progressbar")).toHaveCount(0);
      await expect(playingVideo).toHaveJSProperty("paused", true);
      await playingVideo.evaluate((video: HTMLVideoElement) => {
        Reflect.deleteProperty(video, "readyState");
      });

      if (surfaceName === "viewer") {
        capabilitiesGate = loadingGate();
        playbackGate = loadingGate();
        await page.reload();
        await expectSlimMediaLoading(surface);
        await viewer.getByRole("button", { name: "Next media" }).click();
        await expect(viewer).toHaveCount(0);
        const nextViewer = page.locator(".viewer-dialog");
        const nextName = await nextViewer.getByRole("heading").textContent();
        expect(nextName).not.toBe(asset.name);
        const nextFrame = nextViewer.locator(".viewer-media-frame");
        await expect(nextFrame).toHaveClass(
          (await nextFrame.locator("video").count())
            ? /is-video-ready/
            : /is-ready/
        );
        await expect(nextViewer.getByRole("progressbar")).toHaveCount(0);
        const mediaSources = () =>
          nextFrame
            .locator("video, :scope > img")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute("src"))
            );
        const nextSources = await mediaSources();
        capabilitiesGate.release();
        playbackGate.release();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            )
        );
        await expect(nextViewer.getByRole("heading")).toHaveText(nextName!);
        await expect(nextViewer.getByRole("progressbar")).toHaveCount(0);
        expect(await mediaSources()).toEqual(nextSources);
      }
    } finally {
      capabilitiesGate.release();
      playbackGate.release();
      await context.close();
    }
  });
}

for (const phone of [false, true]) {
  test(`prepares only bounded next-item Bounce bytes in the ${phone ? "phone" : "desktop"} Feed`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      hasTouch: phone,
      isMobile: phone
    });
    const name = `feed-preload-${phone ? "phone" : "desktop"}`;
    const targetDirectory = path.join(directory, name);
    try {
      await context.addInitScript(() => {
        const original = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (type) {
          return type.includes("hvc1") ? "" : original.call(this, type);
        };
      });
      const page = await context.newPage();
      await mkdir(targetDirectory, { recursive: true });
      for (const filename of ["a.mp4", "b.mp4", "c.mp4"])
        await copyFile(
          path.join(directory, "clip.mp4"),
          path.join(targetDirectory, filename)
        );
      await scan(page);
      const tree = (await (
        await page.request.get(`${origin}/api/tree`)
      ).json()) as TreeResponse;
      const targetFolder = tree.folders.find(
        (folder) => folder.relativePath === `${fixtureFolder}/${name}`
      )!;
      const response = await page.request.get(
        `${origin}/api/folders/${targetFolder.id}/assets?sort=filename&limit=10`
      );
      const items = ((await response.json()) as AssetListResponse).items;
      expect(items.map((item) => item.name)).toEqual([
        "a.mp4",
        "b.mp4",
        "c.mp4"
      ]);
      const nextAsset = items[1]!;
      await setPresentation(page, nextAsset, {
        ...defaults,
        highlight: { startMs: 500, endMs: 1500 },
        loopMode: "bounce"
      });
      const nextPreparation = page.waitForResponse(
        (prepared) =>
          prepared.url().includes(`/api/assets/${nextAsset.id}/playback?`) &&
          prepared.request().headers().range === "bytes=0-524287"
      );
      await page.goto(
        `${origin}/?folder=${targetFolder.id}&view=feed&type=video&sort=filename&highlight=1`
      );
      const videos = page.locator(".feed-item video");
      await expect
        .poll(() =>
          videos
            .first()
            .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0);
      const prepared = await nextPreparation;
      expect(prepared.status()).toBe(206);
      expect((await prepared.body()).byteLength).toBeLessThanOrEqual(524288);
      await expect(videos.nth(1)).not.toHaveAttribute("src");
      await expect(videos.nth(1)).toHaveJSProperty("paused", true);
      await expect(videos.nth(2)).not.toHaveAttribute("src");
      await videos.first().evaluate((video: HTMLVideoElement) => {
        video.currentTime = 2.5;
      });
      await expect
        .poll(() =>
          videos.first().evaluate((video: HTMLVideoElement) => video.seeking)
        )
        .toBe(false);
      if (phone)
        await page
          .getByRole("region", { name: "Feed view" })
          .press("ArrowDown");
      else await page.getByRole("button", { name: "Next feed item" }).click();
      await expect(videos.nth(1)).toHaveAttribute(
        "src",
        /playback\?variant=bounce.*codec=h264/
      );
      await expect
        .poll(() =>
          videos.nth(1).evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0);
      await expect(videos.first()).not.toHaveAttribute("src");
      if (phone)
        await page.getByRole("region", { name: "Feed view" }).press("ArrowUp");
      else
        await page.getByRole("button", { name: "Previous feed item" }).click();
      await expect
        .poll(() =>
          videos
            .first()
            .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThanOrEqual(2.4);
    } finally {
      await context.close();
      await rm(targetDirectory, { recursive: true, force: true });
      const cleanupContext = await browser.newContext({ storageState });
      try {
        await scan(await cleanupContext.newPage());
      } finally {
        await cleanupContext.close();
      }
    }
  });
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
    await expect(page.locator(".media-error-notice")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const phone of [false, true]) {
  test(`edits and plays a full-range MOV Bounce on ${phone ? "phone" : "desktop"}`, async ({
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
    const page = await context.newPage();
    const name = "screen-recording.mov";
    const source = path.join(directory, name);
    try {
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=240x120:rate=24:duration=2",
        "-vf",
        "scale=in_range=tv:out_range=pc",
        "-color_range",
        "pc",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-y",
        source
      ]);
      await scan(page);
      const current = (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse;
      const asset = current.items.find((item) => item.name === name)!;
      expect(asset.mimeType).toBe("video/quicktime");
      await open(page, "gallery", "video", name, true);
      await openGalleryEditor(page, asset);
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await editor
        .getByRole("textbox", { name: "Start time", exact: true })
        .fill("0.25");
      await editor
        .getByRole("textbox", { name: "End time", exact: true })
        .fill("1.5");
      await editor.getByRole("combobox", { name: "Loop", exact: true }).click();
      const bounce = page.getByRole("option", { name: "Bounce", exact: true });
      await expect(bounce).toBeEnabled();
      await bounce.click();
      await activate(
        editor.getByRole("button", { name: "Save", exact: true }),
        phone
      );
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, asset.id)).presentation).toMatchObject({
        loopMode: "bounce",
        highlight: { startMs: 250, endMs: 1500 }
      });
      const assertBounce = async (video: Locator) => {
        await expect(video).toHaveAttribute("src", /playback\?variant=bounce/);
        await expect
          .poll(() =>
            video.evaluate((node: HTMLVideoElement) => node.currentTime)
          )
          .toBeGreaterThan(0);
        await expect(video).toHaveJSProperty("muted", true);
      };
      const viewer = page.getByRole("dialog", { name, exact: true });
      await assertBounce(viewer.locator("video"));
      await activate(
        viewer.getByRole("button", { name: "Close viewer", exact: true }),
        phone
      );
      await assertBounce(page.locator(".media-tile video").first());
      await open(page, "feed", "video", name, true);
      await assertBounce(page.locator(".feed-item video").first());
    } finally {
      await rm(source, { force: true });
      try {
        await scan(page);
      } finally {
        await context.close();
      }
    }
  });

  test(`saves and plays a thirty-second Bounce section on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      reducedMotion: "reduce"
    });
    const page = await context.newPage();
    const name = "long-bounce.mp4";
    const source = path.join(directory, name);
    try {
      await promisify(execFile)("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=96x64:rate=24:duration=32",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-y",
        source
      ]);
      await scan(page);
      const result = await page.request.get(
        `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
      );
      const asset = ((await result.json()) as AssetListResponse).items.find(
        (item) => item.name === name
      )!;
      expect(asset).toBeTruthy();
      const capabilities = await page.request.get(
        `${origin}/api/assets/${asset.id}/presentation-media`
      );
      expect((await capabilities.json()).maxBounceDurationMs).toBe(30_000);
      await open(page, "feed", "video", name, true);
      await activate(
        page.getByRole("button", { name: `Edit ${name}`, exact: true }),
        phone
      );
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await editor.getByRole("combobox", { name: "Loop", exact: true }).click();
      await page.getByRole("option", { name: "Bounce", exact: true }).click();
      const warning = editor.getByText(
        "Bounce needs a section of 30 seconds or less.",
        { exact: true }
      );
      const save = editor.getByRole("button", { name: "Save", exact: true });
      await expect(warning).toBeVisible();
      await expect(save).toBeDisabled();
      await editor
        .getByRole("textbox", { name: "Start time", exact: true })
        .fill("1");
      const end = editor.getByRole("textbox", {
        name: "End time",
        exact: true
      });
      await end.fill("31.001");
      await expect(save).toBeDisabled();
      await end.fill("31");
      await expect(warning).toHaveCount(0);
      await expect(save).toBeEnabled();
      await activate(save, phone);
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, asset.id)).presentation).toMatchObject({
        highlight: { startMs: 1000, endMs: 31_000 },
        loopMode: "bounce"
      });
      await page.reload();
      const feedVideo = page.locator(".feed-item video").first();
      await expect(feedVideo).toHaveAttribute(
        "src",
        /playback\?variant=bounce/
      );
      await expect
        .poll(() =>
          feedVideo.evaluate((video: HTMLVideoElement) => video.readyState)
        )
        .toBeGreaterThanOrEqual(2);
      expect(
        await feedVideo.evaluate((video: HTMLVideoElement) => video.duration)
      ).toBeGreaterThan(59);
      expect(
        await feedVideo.evaluate((video: HTMLVideoElement) => video.duration)
      ).toBeLessThan(60.1);
      await open(page, "gallery", "video", name, true);
      await activate(page.locator(".media-preview-button").first(), phone);
      const viewer = page.getByRole("dialog", { name, exact: true });
      const viewerVideo = viewer.locator("video");
      await expect(viewerVideo).toHaveAttribute(
        "src",
        /playback\?variant=bounce/
      );
      await expect
        .poll(() =>
          viewerVideo.evaluate((video: HTMLVideoElement) => video.readyState)
        )
        .toBeGreaterThanOrEqual(2);
      expect(
        await viewerVideo.evaluate((video: HTMLVideoElement) => video.duration)
      ).toBeGreaterThan(59);
    } finally {
      await rm(source, { force: true });
      try {
        await scan(page);
      } finally {
        await context.close();
      }
    }
  });
}
