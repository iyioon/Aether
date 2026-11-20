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
  SavedHighlightValues,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "feed-layout-fixture";
const directory = path.resolve(".e2e/media", folderName);
const framing = {
  Portrait: { fit: "cover" as const, focalX: 0.2, focalY: 0.8, zoom: 1.2 },
  Square: { fit: "cover" as const, focalX: 0.7, focalY: 0.3, zoom: 1.4 },
  Landscape: { fit: "cover" as const, focalX: 0.6, focalY: 0.4, zoom: 1.6 }
};
const defaults: PresentationValues = {
  highlight: null,
  fit: "cover",
  focalX: 0.1,
  focalY: 0.9,
  zoom: 2.5,
  aspectFraming: framing,
  feedFraming: {},
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
      create: { width: 240, height: 120, channels: 3, background: "#6385a7" }
    })
      .png()
      .toFile(path.join(directory, "photo.png"));
    await sharp(
      Buffer.concat(
        Array.from({ length: 9 }, (_, index) =>
          Buffer.alloc(80 * 40 * 3, 24 + index * 24)
        )
      ),
      {
        raw: { width: 80, height: 40 * 9, channels: 3, pageHeight: 40 },
        animated: true
      }
    )
      .webp({ loop: 0, delay: Array<number>(9).fill(200), effort: 0 })
      .toFile(path.join(directory, "animation.webp"));
    const video = path.join(directory, "video-0.mp4");
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
      "12",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      video
    ]);
    await copyFile(video, path.join(directory, "video-1.mp4"));
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
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse
    ).items;
    expect(assets).toHaveLength(4);
    for (const asset of assets.filter((item) => item.mediaType === "video")) {
      expect(
        (
          await page.request.get(
            `${origin}/api/assets/${asset.id}/thumbnail?size=240`
          )
        ).ok()
      ).toBe(true);
    }
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

test("fills a portrait monitor and separates the Original layout from highlight playback", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1080, height: 1920 },
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, defaults);
    const feed = await openFeed(page, "image", photo.name);
    const item = feed.locator(".feed-item").first();
    const media = item.locator(".media-image").first();
    await expect(item).toHaveAttribute("data-aspect", "Portrait");
    await expect(media).toHaveCSS("transform", "matrix(1.2, 0, 0, 1.2, 0, 0)");
    await expectFullFrame(feed, item);
    expect(
      (await item.locator(".feed-frame").boundingBox())!.width
    ).toBeGreaterThan(600);
    await page.screenshot({
      path: testInfo.outputPath("feed-portrait-monitor-fill.png")
    });

    let options = await openLayout(page);
    const layout = options.getByRole("combobox", {
      name: "Media layout",
      exact: true
    });
    const highlights = options.getByRole("checkbox", {
      name: "Play highlights only",
      exact: true
    });
    await expect(layout).toHaveText("Fill screen");
    await expect(highlights).not.toBeChecked();
    expect(
      await layout.evaluate((node) =>
        node.closest('[role="tabpanel"]')?.getAttribute("data-state")
      )
    ).toBe("active");
    expect(
      await highlights.evaluate((node) => node.closest('[role="tabpanel"]'))
    ).toBeNull();
    await layout.click();
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.getByRole("option", { name: "Original", exact: true }).click();
    await expect(layout).toHaveText("Original");
    await expect(highlights).not.toBeChecked();
    await closeOptions(options);
    await expect(item).toHaveAttribute("data-aspect", "Original");
    await expectNeutralFraming(media);
    await expectFullFrame(feed, item);
    await page.screenshot({
      path: testInfo.outputPath("feed-portrait-monitor-original.png")
    });

    await page.reload();
    await expect(item).toHaveAttribute("data-aspect", "Original");
    options = await openLayout(page);
    await expect(
      options.getByRole("combobox", { name: "Media layout", exact: true })
    ).toHaveText("Original");
    await closeOptions(options);
    await page
      .getByRole("button", { name: `Edit ${photo.name}`, exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(
      editor.getByRole("combobox", { name: "Media layout", exact: true })
    ).toHaveText("Original");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await context.close();
  }
});

test("retains a paused nonfirst video through workspace resizing, sidebar changes and layout changes", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1080, height: 1920 },
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    for (const name of ["video-0.mp4", "video-1.mp4"])
      await setPresentation(page, fixture(name), defaults);
    const feed = await openFeed(page, "video");
    await page
      .getByRole("button", { name: "Next feed item", exact: true })
      .click();
    const item = feed.locator(
      `[data-entry-key="${fixture("video-1.mp4").id}"]`
    );
    const video = item.locator("video");
    const transport = item.locator(".video-controls--feed");
    await expect(video).toHaveJSProperty("paused", false);
    await transport
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    const seek = transport.getByRole("slider", {
      name: "Seek video-1.mp4",
      exact: true
    });
    await seek.press("Home");
    await seek.press("ArrowRight");
    await seek.press("ArrowRight");
    await expect(video).toHaveJSProperty("currentTime", 2);
    await video.evaluate((node) =>
      node.setAttribute("data-continuity", "retained")
    );
    const source = await video.getAttribute("src");
    await expect(item).toHaveAttribute("data-aspect", "Portrait");

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(item).toHaveAttribute("data-aspect", "Landscape");
    await expectPausedVideo(video, source);
    await expectFullFrame(feed, item);
    const sidebar = page.getByRole("button", {
      name: "Toggle Sidebar",
      exact: true
    });
    await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-expanded", "false");
    await expectPausedVideo(video, source);
    await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-expanded", "true");
    await expectPausedVideo(video, source);

    const options = await openLayout(page);
    await chooseLayout(page, options, "Original");
    await closeOptions(options);
    await expectNeutralFraming(video);
    await expectPausedVideo(video, source);
    await expect(transport).toHaveAttribute("data-paused", "true");
    await expect(item).toBeInViewport({ ratio: 0.99 });
  } finally {
    await context.close();
  }
});

test("uses each separate highlight's framing and keeps its range and speed in Original", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1080, height: 1920 },
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const source = fixture("video-1.mp4");
    const highlights: SavedHighlightValues[] = [
      {
        ...defaults,
        id: "opening",
        name: "Opening",
        highlight: { startMs: 500, endMs: 3000 },
        playbackRate: 0.75
      },
      {
        ...defaults,
        id: "ending",
        name: "Ending",
        highlight: { startMs: 8000, endMs: 11000 },
        playbackRate: 1.5,
        aspectFraming: {
          ...framing,
          Portrait: { ...framing.Portrait, zoom: 1.9 }
        }
      }
    ];
    const saved = await setPresentation(page, source, {
      ...defaults,
      highlights,
      mainHighlightId: "opening",
      separateHighlights: true
    });
    const feed = await openFeed(page, "video", source.name);
    await expect(feed.locator(".feed-item")).toHaveCount(2);
    const opening = feed.locator(`[data-entry-key="${source.id}~opening"]`);
    await expect(opening.locator("video")).toHaveCSS(
      "transform",
      "matrix(1.2, 0, 0, 1.2, 0, 0)"
    );
    await page
      .getByRole("button", { name: "Next feed item", exact: true })
      .click();
    const ending = feed.locator(`[data-entry-key="${source.id}~ending"]`);
    const video = ending.locator("video");
    const seek = ending.getByRole("slider", {
      name: `Seek ${source.name}`,
      exact: true
    });
    await expect(ending).toHaveAttribute("data-aspect", "Portrait");
    await expect(video).toHaveCSS("transform", "matrix(1.9, 0, 0, 1.9, 0, 0)");
    await expect(video).toHaveJSProperty("playbackRate", 1.5);
    await expect(seek).toHaveAttribute("min", "8");
    await expect(seek).toHaveAttribute("max", "11");
    await expect(video).toHaveJSProperty("muted", true);
    const options = await openLayout(page);
    await chooseLayout(page, options, "Original");
    await expect(
      options.getByRole("checkbox", {
        name: "Play highlights only",
        exact: true
      })
    ).not.toBeChecked();
    await closeOptions(options);
    await expectNeutralFraming(video);
    await expect(video).toHaveJSProperty("playbackRate", 1.5);
    await expect(video).toHaveJSProperty("muted", true);
    await expect(seek).toHaveAttribute("min", "8");
    await expect(seek).toHaveAttribute("max", "11");
    await expect(ending).toBeInViewport({ ratio: 0.99 });
    expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");
    expect((await getAsset(page, source)).presentation).toEqual(
      saved.presentation
    );
  } finally {
    await context.close();
  }
});

test("changes a paused animation's framing without replacing its canvas or seek position", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1080, height: 1920 },
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const animation = fixture("animation.webp");
    await setPresentation(page, animation, {
      ...defaults,
      playbackRate: 1.5
    });
    const feed = await openFeed(page, "image", animation.name);
    const item = feed.locator(".feed-item").first();
    const canvas = item.locator("canvas");
    const transport = item.locator(".video-controls--feed");
    await expect(canvas).toHaveCSS("opacity", "1");
    await expect(canvas).toHaveCSS("transform", "matrix(1.2, 0, 0, 1.2, 0, 0)");
    await transport
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    const seek = transport.getByRole("slider", {
      name: "Seek animation",
      exact: true
    });
    await seek.press("Home");
    await seek.press("ArrowRight");
    await expect(seek).toHaveValue("1");
    await canvas.evaluate((node) =>
      node.setAttribute("data-continuity", "retained")
    );
    for (const layout of ["Original", "Fill screen"] as const) {
      const options = await openLayout(page);
      await chooseLayout(page, options, layout);
      await closeOptions(options);
      await expect(canvas).toHaveAttribute("data-continuity", "retained");
      await expect(canvas).toHaveCSS("opacity", "1");
      await expect(transport).toHaveAttribute("data-paused", "true");
      await expect(seek).toHaveValue("1");
      if (layout === "Original") await expectNeutralFraming(canvas);
      else
        await expect(canvas).toHaveCSS(
          "transform",
          "matrix(1.2, 0, 0, 1.2, 0, 0)"
        );
    }
  } finally {
    await context.close();
  }
});

test("keeps Feed layout controls reachable in phone portrait and coarse-pointer landscape", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const photo = fixture("photo.png");
    await setPresentation(page, photo, defaults);
    const feed = await openFeed(page, "image", photo.name);
    const item = feed.locator(".feed-item").first();
    for (const viewport of [
      { width: 393, height: 852 },
      { width: 852, height: 393 }
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
      ).toBe(true);
      await expectFullFrame(feed, item);
      await expect(
        page.getByRole("button", { name: "View options", exact: true })
      ).toBeInViewport({ ratio: 1 });
      const options = await openLayout(page);
      await expect(options).toHaveClass(/view-options-sheet/);
      const layout = options.getByRole("combobox", {
        name: "Media layout",
        exact: true
      });
      await expect(layout).toBeInViewport({ ratio: 1 });
      await expect(options.locator(".view-options-playback")).toBeInViewport({
        ratio: 1
      });
      expect((await layout.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        (await options.locator(".view-options-playback").boundingBox())!.height
      ).toBeGreaterThanOrEqual(44);
      await chooseLayout(page, options, "Original");
      await page.screenshot({
        path: testInfo.outputPath(`feed-options-${viewport.width}.png`)
      });
      await closeOptions(options);
      await expectNeutralFraming(item.locator(".media-image").first());
      await expectFullFrame(feed, item);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    }
  } finally {
    await context.close();
  }
});

function fixture(name: string) {
  return assets.find((asset) => asset.name === name)!;
}

async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}

async function scan(page: Page) {
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: await csrf(page)
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

async function getAsset(page: Page, asset: AssetRecord): Promise<AssetRecord> {
  const response = await page.request.get(`${origin}/api/assets/${asset.id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function setPresentation(
  page: Page,
  asset: AssetRecord,
  values: PresentationValues
) {
  const current = await getAsset(page, asset);
  const response = await page.request.put(
    `${origin}/api/assets/${asset.id}/presentation`,
    {
      headers: await csrf(page),
      data: { expectedRevision: current.presentation?.revision ?? 0, ...values }
    }
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { asset: AssetRecord }).asset;
}

async function openFeed(page: Page, type: "image" | "video", search = "") {
  await page.goto(
    `${origin}/?${new URLSearchParams({ folder: folderId, view: "feed", type, sort: "filename", order: "asc", q: search, aspect: "fill", highlight: "0" })}`
  );
  const feed = page.getByRole("region", { name: "Feed view", exact: true });
  await expect(feed).toHaveAttribute("aria-busy", "false");
  return feed;
}

async function openLayout(page: Page) {
  await page.getByRole("button", { name: "View options", exact: true }).click();
  const options = page.getByRole("dialog", {
    name: "View options",
    exact: true
  });
  await options.getByRole("tab", { name: "Layout", exact: true }).click();
  return options;
}

async function chooseLayout(
  page: Page,
  options: Locator,
  value: "Fill screen" | "Original"
) {
  await options
    .getByRole("combobox", { name: "Media layout", exact: true })
    .click();
  await page.getByRole("option", { name: value, exact: true }).click();
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
}

async function closeOptions(options: Locator) {
  await options
    .getByRole("button", { name: "Close view options", exact: true })
    .click();
  await expect(options).toHaveCount(0);
}

async function expectFullFrame(feed: Locator, item: Locator) {
  await expect
    .poll(async () => {
      const [workspace, frame] = await Promise.all([
        feed.boundingBox(),
        item.locator(".feed-frame").boundingBox()
      ]);
      return workspace && frame
        ? Math.max(
            Math.abs(workspace.width - frame.width),
            Math.abs(workspace.height - frame.height)
          )
        : Infinity;
    })
    .toBeLessThan(2);
}

async function expectNeutralFraming(media: Locator) {
  await expect(media).toHaveCSS("object-fit", "contain");
  await expect(media).toHaveCSS("object-position", "50% 50%");
  await expect(media).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
}

async function expectPausedVideo(video: Locator, source: string | null) {
  await expect(video).toHaveAttribute("data-continuity", "retained");
  expect(await video.getAttribute("src")).toBe(source);
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 2);
}
