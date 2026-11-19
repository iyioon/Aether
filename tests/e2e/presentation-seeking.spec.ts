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
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureFolder = "presentation-seeking-fixture";
const directory = path.resolve(".e2e", "media", fixtureFolder);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let videoAsset: AssetRecord;
let animationAsset: AssetRecord;
let atlases: Buffer[];

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
    await promisify(execFile)("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=160x90:r=10:d=4,geq=r='16+N*5':g=32:b=32",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-g",
      "40",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      path.join(directory, "frames.mp4")
    ]);
    await sharp(
      Buffer.concat(
        [32, 96, 160, 224].map((value) => Buffer.alloc(64 * 64 * 3, value))
      ),
      {
        raw: { width: 64, height: 256, channels: 3, pageHeight: 64 },
        animated: true
      }
    )
      .webp({ loop: 0, delay: [500, 500, 500, 500], effort: 0 })
      .toFile(path.join(directory, "frames.webp"));
    atlases = await Promise.all(
      [0, 1].map((atlas) => {
        const pixels = Buffer.alloc(128 * 64 * 3);
        for (let row = 0; row < 64; row++) {
          pixels.fill(32 + atlas * 128, row * 128 * 3, (row * 128 + 64) * 3);
          pixels.fill(
            96 + atlas * 128,
            (row * 128 + 64) * 3,
            (row + 1) * 128 * 3
          );
        }
        return sharp(pixels, { raw: { width: 128, height: 64, channels: 3 } })
          .png()
          .toBuffer();
      })
    );
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === fixtureFolder
    )!.id;
    const { items } = (await (
      await page.request.get(
        `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
      )
    ).json()) as AssetListResponse;
    expect(items).toHaveLength(2);
    videoAsset = items.find((asset) => asset.name === "frames.mp4")!;
    animationAsset = items.find((asset) => asset.name === "frames.webp")!;
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

test("seeks an animation to the last reported checkpoint while its playback clock is ahead", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    await page.clock.install();
    await page.route(
      `**/api/assets/${animationAsset.id}/animation?*`,
      async (route) => {
        const key = new URL(route.request().url()).searchParams.get("v")!;
        await route.fulfill({
          json: {
            kind: "animation",
            width: 64,
            height: 64,
            durationMs: 2000,
            atlases: [
              {
                url: `/api/assets/${animationAsset.id}/animation/atlases/0?v=${encodeURIComponent(key)}`,
                width: 128,
                height: 64
              }
            ],
            frames: [
              {
                startMs: 0,
                durationMs: 50,
                atlas: 0,
                x: 0,
                y: 0,
                width: 64,
                height: 64
              },
              {
                startMs: 50,
                durationMs: 1950,
                atlas: 0,
                x: 64,
                y: 0,
                width: 64,
                height: 64
              }
            ]
          }
        });
      }
    );
    await page.route(
      `**/api/assets/${animationAsset.id}/animation/atlases/*`,
      (route) => route.fulfill({ contentType: "image/png", body: atlases[0]! })
    );
    const editor = await openEditor(page, animationAsset);
    const canvas = editor.locator("canvas");
    const timeline = editor.getByRole("slider", {
      name: "Preview position",
      exact: true
    });
    const pixel = () =>
      canvas.evaluate(
        (node: HTMLCanvasElement) =>
          node.getContext("2d")!.getImageData(0, 0, 1, 1).data[0]
      );
    await expect.poll(pixel).toBe(32);
    await page.clock.pauseAt(
      new Date((await page.evaluate(() => Date.now())) + 100)
    );
    await editor
      .getByRole("button", { name: "Play preview", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(
      editor.getByRole("button", { name: "Pause preview", exact: true })
    ).toBeVisible();
    await page.clock.runFor(100);
    // Painting follows the playback clock; reporting the position is throttled to 125 ms.
    await expect.poll(pixel).toBe(96);
    await expect(timeline).toHaveAttribute("aria-valuenow", "0");
    await timeline.press("Home");
    await expect(
      editor.getByRole("button", { name: "Play preview", exact: true })
    ).toBeVisible();
    await expect.poll(pixel).toBe(32);
    await expect(timeline).toHaveAttribute("aria-valuenow", "0");
  } finally {
    await context.close();
  }
});

for (const phone of [false, true]) {
  const layout = phone ? "phone" : "desktop";
  const options = () => ({
    storageState,
    reducedMotion: "reduce" as const,
    ...(phone
      ? {
          viewport: { width: 393, height: 852 },
          isMobile: true,
          hasTouch: true
        }
      : {})
  });

  test(`presents paused video seeks and repeated backward steps in the ${layout} editor`, async ({
    browser
  }) => {
    const context = await browser.newContext(options());
    try {
      const page = await context.newPage();
      const editor = await openEditor(page, videoAsset);
      const video = editor.locator("video");
      const timeline = editor.getByRole("slider", {
        name: "Preview position",
        exact: true
      });
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
        .toBeGreaterThanOrEqual(2);
      await expect.poll(() => videoPixel(video)).toBeLessThan(24);
      const rail = editor.locator(
        ".media-editor-timeline [data-slot='slider']"
      );
      const bounds = (await rail.boundingBox())!;
      if (phone)
        await page.touchscreen.tap(
          bounds.x + bounds.width * 0.7,
          bounds.y + bounds.height / 2
        );
      else
        await page.mouse.click(
          bounds.x + bounds.width * 0.7,
          bounds.y + bounds.height / 2
        );
      await expect(video).toHaveJSProperty("paused", true);
      await expect.poll(() => videoPixel(video)).toBeGreaterThan(135);
      await timeline.press("Home");
      for (let index = 0; index < 3; index++) await timeline.press("PageUp");
      await expect(timeline).toHaveAttribute("aria-valuenow", "3000");
      await expect.poll(() => videoPixel(video)).toBeGreaterThan(158);
      await timeline.focus();
      for (let index = 0; index < 20; index++) {
        await page.keyboard.down("ArrowLeft");
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            )
        );
      }
      await page.keyboard.up("ArrowLeft");
      await expect(timeline).toHaveAttribute("aria-valuenow", "1000");
      await expect.poll(() => videoPixel(video)).toBeLessThan(73);
      await expect.poll(() => videoPixel(video)).toBeGreaterThan(58);
      await expect(video).toHaveJSProperty("paused", true);
      await editor
        .getByRole("button", { name: "Play preview", exact: true })
        .click();
      await expect
        .poll(() =>
          video.evaluate((node: HTMLVideoElement) => node.currentTime)
        )
        .toBeGreaterThan(1.2);
      await timeline.press("Home");
      await expect(video).toHaveJSProperty("paused", true);
      await expect.poll(() => videoPixel(video)).toBeLessThan(24);
      await expect
        .poll(() =>
          video.evaluate((node: HTMLVideoElement) => node.currentTime)
        )
        .toBeLessThan(0.01);
      await expect(timeline).toHaveAttribute("aria-valuenow", "0");
    } finally {
      await context.close();
    }
  });

  test(`shows cached animation frames before an obsolete atlas finishes in the ${layout} editor`, async ({
    browser
  }) => {
    const context = await browser.newContext(options());
    const gate = loadingGate();
    let secondAtlasRequests = 0;
    try {
      const page = await context.newPage();
      await page.route(
        `**/api/assets/${animationAsset.id}/animation?*`,
        async (route) => {
          const key = new URL(route.request().url()).searchParams.get("v")!;
          await route.fulfill({
            json: {
              kind: "animation",
              width: 64,
              height: 64,
              durationMs: 2000,
              atlases: [0, 1].map((atlas) => ({
                url: `/api/assets/${animationAsset.id}/animation/atlases/${atlas}?v=${encodeURIComponent(key)}`,
                width: 128,
                height: 64
              })),
              frames: [0, 1, 2, 3].map((frame) => ({
                startMs: frame * 500,
                durationMs: 500,
                atlas: Math.floor(frame / 2),
                x: (frame % 2) * 64,
                y: 0,
                width: 64,
                height: 64
              }))
            }
          });
        }
      );
      await page.route(
        `**/api/assets/${animationAsset.id}/animation/atlases/*`,
        async (route) => {
          const second = new URL(route.request().url()).pathname.endsWith("/1");
          if (second) {
            secondAtlasRequests += 1;
            await gate.promise;
            await route
              .fulfill({ status: 503, body: "Atlas unavailable" })
              .catch(() => undefined);
          } else
            await route
              .fulfill({ contentType: "image/png", body: atlases[0]! })
              .catch(() => undefined);
        }
      );
      const editor = await openEditor(page, animationAsset);
      const canvas = editor.locator("canvas");
      const timeline = editor.getByRole("slider", {
        name: "Preview position",
        exact: true
      });
      const pixel = () =>
        canvas.evaluate(
          (node: HTMLCanvasElement) =>
            node.getContext("2d")!.getImageData(0, 0, 1, 1).data[0]
        );
      await expect.poll(pixel).toBe(32);
      await timeline.press("PageUp");
      await expect(timeline).toHaveAttribute("aria-valuenow", "1000");
      await expect.poll(() => secondAtlasRequests).toBeGreaterThan(0);
      await timeline.press("Home");
      for (let index = 0; index < 5; index++)
        await timeline.press("ArrowRight");
      await expect(timeline).toHaveAttribute("aria-valuenow", "500");
      // The selected atlas remains blocked; this frame already exists in the first atlas.
      await expect.poll(pixel, { timeout: 2000 }).toBe(96);
      await timeline.press("PageUp");
      await timeline.press("Home");
      await expect.poll(pixel, { timeout: 2000 }).toBe(32);
      gate.release();
      await expect(
        editor.getByText("Preview unavailable.", { exact: true })
      ).toHaveCount(0);
      await editor
        .getByRole("button", { name: "Play preview", exact: true })
        .click();
      await expect.poll(pixel).toBe(96);
      await editor
        .getByRole("button", { name: "Pause preview", exact: true })
        .click();
      await expect(canvas).toHaveCSS("opacity", "1");
      await expect(editor.locator(".media-error-notice")).toHaveCount(0);
    } finally {
      gate.release();
      await context.close();
    }
  });

  test(`scopes preview shortcuts to the ${layout} editor without stealing control keys`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext(options());
    try {
      const page = await context.newPage();
      const editor = await openEditor(page, videoAsset);
      const frame = editor.locator(".media-editor-frame");
      const timeline = editor.getByRole("slider", {
        name: "Preview position",
        exact: true
      });
      await expect(frame).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(timeline).toHaveAttribute("aria-valuenow", "100");
      await page.keyboard.press("Shift+ArrowRight");
      await expect(timeline).toHaveAttribute("aria-valuenow", "101");
      await frame.evaluate((node) => {
        for (let index = 0; index < 5; index++)
          node.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowRight",
              repeat: index > 0,
              bubbles: true,
              cancelable: true
            })
          );
      });
      await expect(timeline).toHaveAttribute("aria-valuenow", "601");
      for (const modifier of [
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { isComposing: true }
      ])
        await frame.dispatchEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          ...modifier
        });
      await expect(timeline).toHaveAttribute("aria-valuenow", "601");
      await page.keyboard.press("Space");
      await expect(
        editor.getByRole("button", { name: "Pause preview", exact: true })
      ).toBeVisible();
      await frame.dispatchEvent("keydown", {
        key: " ",
        code: "Space",
        repeat: true,
        bubbles: true
      });
      await expect(
        editor.getByRole("button", { name: "Pause preview", exact: true })
      ).toBeVisible();
      await page.keyboard.press("Space");
      await expect(
        editor.getByRole("button", { name: "Play preview", exact: true })
      ).toBeVisible();
      await timeline.press("Home");
      const start = editor.getByRole("textbox", {
        name: "Start time",
        exact: true
      });
      await start.press("ArrowRight");
      await start.press("Space");
      await expect(timeline).toHaveAttribute("aria-valuenow", "0");
      await expect(
        editor.getByRole("button", { name: "Play preview", exact: true })
      ).toBeVisible();
      await start.fill("0:00.000");
      const play = editor.getByRole("button", {
        name: "Play preview",
        exact: true
      });
      await play.focus();
      await page.keyboard.press("Space");
      const pause = editor.getByRole("button", {
        name: "Pause preview",
        exact: true
      });
      await expect(pause).toBeVisible();
      await pause.focus();
      await page.keyboard.press("Space");
      await expect(play).toBeVisible();
      await timeline.press("Home");
      const speed = editor.getByRole("combobox", {
        name: "Speed",
        exact: true
      });
      await speed.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Space");
      await page.keyboard.press("Escape");
      await expect(play).toBeVisible();
      await expect(timeline).toHaveAttribute("aria-valuenow", "0");
      const playbackTab = editor.getByRole("tab", {
        name: "Playback",
        exact: true
      });
      const framingTab = editor.getByRole("tab", {
        name: "Framing",
        exact: true
      });
      await playbackTab.focus();
      await page.keyboard.press("ArrowRight");
      await expect(framingTab).toHaveAttribute("aria-selected", "true");
      await expect(timeline).toHaveAttribute("aria-valuenow", "0");
      await frame.click();
      await page.keyboard.press("=");
      await expect(
        editor.getByRole("slider", { name: "Media zoom", exact: true })
      ).toHaveAttribute("aria-valuenow", "1.05");
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() =>
          editor
            .locator("video")
            .evaluate((node) =>
              parseFloat(getComputedStyle(node).objectPosition)
            )
        )
        .toBeGreaterThan(50);
      await expect(timeline).toHaveAttribute("aria-valuenow", "0");
      const bounds = (await editor.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(phone ? 393 : 1440);
      await page.screenshot({
        path: testInfo.outputPath(`${layout}-edit-shortcuts.png`)
      });
    } finally {
      await context.close();
    }
  });
}

async function openEditor(page: Page, asset: AssetRecord) {
  await page.goto(
    `${origin}/?folder=${encodeURIComponent(folderId)}&view=feed&type=${asset.mediaType}&sort=filename&q=${encodeURIComponent(asset.name)}&highlight=0`
  );
  await page
    .getByRole("button", { name: `Edit ${asset.name}`, exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit media", exact: true });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Play preview", exact: true })
  ).toBeEnabled();
  return editor;
}

async function videoPixel(video: Locator) {
  return video.evaluate((node: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(node, 0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[0]!;
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
    .poll(
      async () => {
        const { jobs } = (await (
          await page.request.get(`${origin}/api/admin/jobs`)
        ).json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("completed");
}

function loadingGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
