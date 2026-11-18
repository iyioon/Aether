import { execFile } from "node:child_process";
import { mkdir, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
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
  SavedHighlightValues,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureFolder = "highlight-entries-fixture";
const directory = path.resolve(".e2e", "media", fixtureFolder);
const modified = new Date("2026-11-15T08:30:00.000Z");
const displayLabel = "Show highlights separately in Gallery and Feed";
const neutral: PresentationValues = {
  highlight: null,
  fit: "cover",
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  aspectFraming: {},
  feedFraming: {},
  playbackRate: 1,
  loopMode: "repeat"
};
const highlights: SavedHighlightValues[] = [
  {
    ...neutral,
    id: "opening",
    name: "Opening",
    highlight: { startMs: 250, endMs: 1250 },
    playbackRate: 0.75,
    aspectFraming: {
      Square: { fit: "cover", focalX: 0.3, focalY: 0.4, zoom: 1.1 }
    }
  },
  {
    ...neutral,
    id: "ending",
    name: "Ending",
    highlight: { startMs: 3500, endMs: 5000 },
    playbackRate: 1.5,
    aspectFraming: {
      Square: { fit: "cover", focalX: 0.7, focalY: 0.6, zoom: 1.7 }
    }
  }
];
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let rootLabel: string;
let asset: AssetRecord;
let animatedAsset: AssetRecord;
const animatedHighlights: SavedHighlightValues[] = [
  {
    ...neutral,
    id: "opening",
    name: "Opening",
    highlight: { startMs: 0, endMs: 400 },
    playbackRate: 0.5
  },
  {
    ...neutral,
    id: "ending",
    name: "Ending",
    highlight: { startMs: 800, endMs: 1200 },
    playbackRate: 1.5,
    loopMode: "bounce"
  }
];

interface AnimationDraw {
  entry: string;
  source: string;
  frame: number;
  time: number;
}
interface AnimationObservationWindow extends Window {
  highlightEntryDraws: AnimationDraw[];
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
    const filename = path.join(directory, "sections.mp4");
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
      filename
    ]);
    await utimes(filename, modified, modified);
    await sharp(
      Buffer.concat(
        Array.from({ length: 12 }, (_, frame) =>
          Buffer.alloc(32 * 32 * 3, 20 + frame * 16)
        )
      ),
      {
        raw: { width: 32, height: 32 * 12, channels: 3, pageHeight: 32 },
        animated: true
      }
    )
      .gif({ loop: 0, delay: Array<number>(12).fill(100) })
      .toFile(path.join(directory, "sections.gif"));
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    const folder = tree.folders.find(
      (item) => item.relativePath === fixtureFolder
    )!;
    folderId = folder.id;
    rootLabel = tree.roots.find((root) => root.id === folder.rootId)!.label;
    const response = await page.request.get(
      `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
    );
    const listed = (await response.json()) as AssetListResponse;
    expect(listed.items).toHaveLength(2);
    asset = listed.items.find((item) => item.name === "sections.mp4")!;
    animatedAsset = listed.items.find((item) => item.name === "sections.gif")!;
    // Normal poster delivery makes lazy video metadata available before Info opens.
    expect(
      (
        await page.request.get(
          `${origin}/api/assets/${asset.id}/thumbnail?size=240`
        )
      ).ok()
    ).toBe(true);
    asset = await getAsset(page);
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

  test(`shows separate Gallery highlights with stable viewer navigation and file details on ${layout}`, async ({
    browser
  }, testInfo) => {
    const context = await createContext(browser, phone);
    try {
      const page = await context.newPage();
      const saved = await setHighlights(page, false);
      await page.goto(libraryUrl("gallery", { asset: asset.id }));
      let info = await openInfo(page);
      const details = info.locator(".media-file-details");
      await expect(details.locator("time")).toHaveAttribute(
        "datetime",
        modified.toISOString()
      );
      await expect(details.locator("time")).toContainText(/GMT/);
      await expect(detailRow(details, "Format")).toContainText("MP4");
      await expect(detailRow(details, "File size")).toContainText(
        /\d+(?:\.\d+)? KB/
      );
      await expect(detailRow(details, "Dimensions")).toContainText(
        "240 × 120 px"
      );
      await expect(detailRow(details, "Duration")).toContainText("0:06");
      const location = detailRow(details, "Location");
      await expect(location).toContainText(rootLabel);
      await expect(location).toContainText(fixtureFolder);
      await expect(location).not.toContainText(directory);
      await expect(location).not.toContainText(".e2e");
      expect(
        await info.evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`highlight-info-details-${layout}.png`)
      });
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      const display = info.getByRole("checkbox", {
        name: displayLabel,
        exact: true
      });
      await expect(display).not.toBeChecked();
      await display.click();
      await expect(display).toBeChecked();
      await expect
        .poll(
          async () => (await getAsset(page)).presentation?.separateHighlights
        )
        .toBe(true);
      const updated = (await getAsset(page)).presentation!;
      expect(updated.highlights).toEqual(saved.presentation?.highlights);
      expect(updated.mainHighlightId).toBe("opening");
      await closeInfo(info);
      await closeViewer(page);

      const cards = page.locator(`.media-tile[data-asset-id="${asset.id}"]`);
      await expect(cards).toHaveCount(2);
      expect(
        await cards.evaluateAll(
          (nodes) =>
            new Set(nodes.map((node) => node.getAttribute("data-entry-key")))
              .size
        )
      ).toBe(2);
      for (const section of highlights) {
        const card = galleryEntry(page, section.id);
        await card.scrollIntoViewIfNeeded();
        await expect(card.locator(".tile-meta")).toHaveText(section.name);
        await expect(card.locator(".tile-submeta")).toContainText(asset.name);
        await expectVideoSection(page, card.locator("video"), section);
      }
      expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");
      await galleryEntry(page, "opening")
        .getByRole("button", {
          name: `Open Opening · ${asset.name}`,
          exact: true
        })
        .click();
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[0]!
      );
      const viewerHistoryLength = await page.evaluate(() => history.length);
      await navigateViewer(page, phone, 1);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("highlightId"))
        .toBe("ending");
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[1]!
      );
      expect(await page.evaluate(() => history.length)).toBe(
        viewerHistoryLength
      );
      await page.reload();
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[1]!
      );
      expect(new URL(page.url()).searchParams.get("asset")).toBe(asset.id);
      expect(new URL(page.url()).searchParams.get("highlightId")).toBe(
        "ending"
      );
      await navigateViewer(page, phone, -1);
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[0]!
      );
      await navigateViewer(page, phone, 1);
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[1]!
      );
      expect(await page.evaluate(() => history.length)).toBe(
        viewerHistoryLength
      );
      info = await openInfo(page);
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await info
        .getByRole("button", { name: "View Opening", exact: true })
        .click();
      await expect(info).toHaveCount(0);
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[0]!
      );
      info = await openInfo(page);
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await info
        .getByRole("button", { name: "Edit media", exact: true })
        .click();
      const selectedEditor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await expect(
        selectedEditor.getByRole("textbox", {
          name: "Highlight name",
          exact: true
        })
      ).toHaveValue("Opening");
      await selectedEditor
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(selectedEditor).toHaveCount(0);
      await navigateViewer(page, phone, 1);
      await expectVideoSection(
        page,
        page.locator(".viewer-dialog video"),
        highlights[1]!
      );
      await closeViewer(page);
      const ending = galleryEntry(page, "ending").getByRole("button", {
        name: `Open Ending · ${asset.name}`,
        exact: true
      });
      await expect(ending).toBeInViewport();
      await expect(ending).toBeFocused();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`highlight-entries-${layout}.png`)
      });

      await ending.click();
      info = await openInfo(page);
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await info
        .getByRole("checkbox", { name: displayLabel, exact: true })
        .click();
      await expect
        .poll(
          async () => (await getAsset(page)).presentation?.separateHighlights
        )
        .toBe(false);
      await closeInfo(info);
      await closeViewer(page);
      await expect(cards).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: `Open ${asset.name}`, exact: true })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test(`shares source curation and batch selection while navigating Feed highlights on ${layout}`, async ({
    browser
  }) => {
    const context = await createContext(browser, phone);
    try {
      const page = await context.newPage();
      await setHighlights(page, true);
      expect(
        (
          await page.request.patch(`${origin}/api/assets/${asset.id}/score`, {
            headers: await csrf(page),
            data: { score: 0, favorite: false }
          })
        ).ok()
      ).toBe(true);
      await page.goto(libraryUrl("gallery"));
      const cards = page.locator(`.media-tile[data-asset-id="${asset.id}"]`);
      await expect(cards).toHaveCount(2);
      for (let score = 1; score <= 3; score += 1) {
        await galleryEntry(page, score % 2 ? "opening" : "ending")
          .getByRole("button", { name: /^Increase score/ })
          .click();
        await expect(
          cards.getByRole("button", {
            name: `Increase score for ${asset.name}. Current score: ${score}`,
            exact: true
          })
        ).toHaveCount(2);
      }
      await galleryEntry(page, "opening")
        .getByRole("button", {
          name: `Add ${asset.name} to favorites`,
          exact: true
        })
        .click();
      await expect(
        cards.getByRole("button", {
          name: `Remove ${asset.name} from favorites`,
          exact: true
        })
      ).toHaveCount(2);
      expect((await getAsset(page)).score).toBe(3);
      expect((await getAsset(page)).favorite).toBe(true);

      const endingPreview = galleryEntry(page, "ending").getByRole("button", {
        name: `Open Ending · ${asset.name}`,
        exact: true
      });
      await endingPreview.focus();
      await endingPreview.press("Shift+F10");
      await page
        .getByRole("menuitem", { name: "Move to Trash", exact: true })
        .click();
      const trash = page.getByRole("alertdialog", {
        name: "Move to Trash?",
        exact: true
      });
      await expect(trash).toContainText(asset.name);
      await expect(trash).toContainText(
        "All highlight entries for these files will also leave Gallery and Feed."
      );
      await trash.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(cards).toHaveCount(2);

      await page
        .getByRole("button", { name: "Select media", exact: true })
        .click();
      const batch = page.getByRole("region", {
        name: "Selected media actions",
        exact: true
      });
      await batch
        .getByRole("button", { name: "Selection options", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Select loaded", exact: true })
        .click();
      await expect(batch.getByRole("status")).toContainText(
        /1\s*item selected/
      );
      await expect(
        cards.locator(".tile-selection-surface[aria-pressed=true]")
      ).toHaveCount(2);
      await batch
        .getByRole("button", { name: "Edit details", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Edit details",
        exact: true
      });
      await expect(editor).toContainText("1 item selected");
      await editor
        .getByRole("textbox", { name: "Score", exact: true })
        .fill("7");
      const request = page.waitForRequest(
        (candidate) =>
          candidate.method() === "PATCH" &&
          candidate.url().endsWith("/api/assets/batch/scores")
      );
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      expect((await request).postDataJSON()).toMatchObject({
        assetIds: [asset.id],
        score: 7
      });
      await expect.poll(async () => (await getAsset(page)).score).toBe(7);
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await batch.getByRole("button", { name: "Done", exact: true }).click();
      await expect(
        cards.getByRole("button", {
          name: `Increase score for ${asset.name}. Current score: 7`,
          exact: true
        })
      ).toHaveCount(2);

      await page.goto(libraryUrl("feed"));
      const feed = page.getByRole("region", { name: "Feed view", exact: true });
      await expect(feed.locator(".feed-item")).toHaveCount(2);
      await expectVideoSection(
        page,
        feedEntry(page, "opening").locator("video"),
        highlights[0]!
      );
      await navigateFeed(page, phone, 1);
      await expectVideoSection(
        page,
        feedEntry(page, "ending").locator("video"),
        highlights[1]!
      );
      await expect(
        page
          .getByRole("group", { name: "Feed navigation", exact: true })
          .getByRole("button", {
            name: `Remove Ending · ${asset.name} from favorites`,
            exact: true
          })
      ).toBeVisible();
      await navigateFeed(page, phone, -1);
      await expectVideoSection(
        page,
        feedEntry(page, "opening").locator("video"),
        highlights[0]!
      );
      await navigateFeed(page, phone, 1);
      await expectVideoSection(
        page,
        feedEntry(page, "ending").locator("video"),
        highlights[1]!
      );
      if (phone) {
        await feedEntry(page, "ending")
          .getByRole("button", {
            name: `Open details for Ending · ${asset.name}`,
            exact: true
          })
          .click();
        const info = page.locator(".media-info-sheet");
        await info
          .getByRole("tab", { name: "Highlights", exact: true })
          .click();
        await info
          .getByRole("button", { name: "Edit media", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", {
            name: `Edit Ending · ${asset.name}`,
            exact: true
          })
          .click();
      }
      const presentation = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await expect(
        presentation.getByRole("textbox", {
          name: "Highlight name",
          exact: true
        })
      ).toHaveValue("Ending");
      await presentation
        .getByRole("button", { name: "Remove highlight", exact: true })
        .click();
      await page
        .getByRole("alertdialog", { name: "Remove highlight?", exact: true })
        .getByRole("button", { name: "Remove highlight", exact: true })
        .click();
      await presentation
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(presentation).toHaveCount(0);
      await expect(feed.locator(".feed-item")).toHaveCount(1);
      await expectVideoSection(
        page,
        feedEntry(page, "opening").locator("video"),
        highlights[0]!
      );
      if (phone) {
        await navigateFeed(page, true, 1);
        await expect
          .poll(() =>
            feed.locator(".feed-view").evaluate((node) => node.scrollTop)
          )
          .toBe(0);
      } else {
        await expect(
          page.getByRole("button", { name: "Next feed item", exact: true })
        ).toBeDisabled();
      }
      expect((await getAsset(page)).presentation).toMatchObject({
        separateHighlights: true,
        mainHighlightId: "opening"
      });
      expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");
    } finally {
      await context.close();
    }
  });

  test(`retains Info drafts and the saved display option after an interrupted change on ${layout}`, async ({
    browser
  }) => {
    const context = await createContext(browser, phone);
    let releaseFailure = () => undefined;
    try {
      const page = await context.newPage();
      const saved = await setHighlights(page, false);
      await page.goto(libraryUrl("gallery", { asset: asset.id }));
      const info = await openInfo(page);
      const tags = info.getByRole("textbox", {
        name: "Add a tag",
        exact: true
      });
      await expect(tags).toBeEnabled();
      await tags.fill("retained draft");
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      const gate = new Promise<void>((resolve) => {
        releaseFailure = resolve;
      });
      await page.route(
        `**/api/assets/${asset.id}/presentation`,
        async (route) => {
          if (route.request().method() !== "PUT") return route.continue();
          await gate;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "processing_busy" })
          });
        }
      );
      const display = info.getByRole("checkbox", {
        name: displayLabel,
        exact: true
      });
      await display.click();
      await expect(display).toBeDisabled();
      await expect(
        info.getByRole("button", { name: "Close", exact: true })
      ).toBeDisabled();
      await expect(
        info.getByRole("tab", { name: "Details", exact: true })
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(info).toBeVisible();
      releaseFailure();
      await expect(info.getByRole("alert")).toContainText(
        "could not be confirmed"
      );
      await expect(display).toBeEnabled();
      await expect(display).not.toBeChecked();
      expect((await getAsset(page)).presentation).toEqual(saved.presentation);
      await info.getByRole("tab", { name: "Details", exact: true }).click();
      await expect(tags).toHaveValue("retained draft");
      await expect(info.locator(".media-file-details time")).toHaveAttribute(
        "datetime",
        modified.toISOString()
      );
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await page.unroute(`**/api/assets/${asset.id}/presentation`);
      await display.click();
      await expect(display).toBeChecked();
      await expect
        .poll(
          async () => (await getAsset(page)).presentation?.separateHighlights
        )
        .toBe(true);
      await expect(info.getByRole("alert")).toHaveCount(0);
      await info.getByRole("tab", { name: "Details", exact: true }).click();
      await expect(tags).toHaveValue("retained draft");
    } finally {
      releaseFailure();
      await context.close();
    }
  });

  test(`plays separate animated-image ranges and loop modes with bounded Feed playback on ${layout}`, async ({
    browser
  }) => {
    const context = await createContext(browser, phone);
    try {
      await observeAnimationEntries(context);
      const page = await context.newPage();
      await setHighlights(page, true, animatedAsset, animatedHighlights);
      await page.goto(libraryUrl("gallery", { type: "image" }));
      const cards = page.locator(
        `.media-tile[data-asset-id="${animatedAsset.id}"]`
      );
      await expect(cards).toHaveCount(2);
      for (const section of animatedHighlights) {
        const card = galleryEntry(page, section.id, animatedAsset);
        await card.scrollIntoViewIfNeeded();
        await expect(card).toHaveAttribute("data-asset-id", animatedAsset.id);
        await expect(card.locator(".tile-meta")).toHaveText(section.name);
        await expectAnimationSection(page, card, section);
      }
      expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");

      await page.goto(libraryUrl("feed", { type: "image" }));
      const feed = page.getByRole("region", { name: "Feed view", exact: true });
      await expect(feed.locator(".feed-item")).toHaveCount(2);
      const opening = feedEntry(page, "opening", animatedAsset);
      const ending = feedEntry(page, "ending", animatedAsset);
      await expectAnimationSection(page, opening, animatedHighlights[0]!);
      await expectBoundedFeedAnimations(feed, opening);
      await expect(
        opening.getByRole("slider", { name: "Seek animation", exact: true })
      ).toHaveAttribute("min", "0");
      await expect(
        opening.getByRole("slider", { name: "Seek animation", exact: true })
      ).toHaveAttribute("max", "0.4");
      await expectInactiveAnimationStops(page, ending);
      await navigateFeed(page, phone, 1);
      await expectAnimationSection(page, ending, animatedHighlights[1]!);
      await expect(
        ending.getByRole("slider", { name: "Seek animation", exact: true })
      ).toHaveAttribute("min", "0.8");
      await expect(
        ending.getByRole("slider", { name: "Seek animation", exact: true })
      ).toHaveAttribute("max", "1.2");
      await expect(ending.locator(".video-controls__section")).toHaveText(
        "Highlight · Bounce"
      );
      await expectInactiveAnimationStops(page, opening);
      await expectBoundedFeedAnimations(feed, ending);
      expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");
      await ending
        .getByRole("button", {
          name: `Open details for Ending · ${animatedAsset.name}`,
          exact: true
        })
        .click();
      const info = page.locator(".media-info-sheet");
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await info
        .getByRole("checkbox", { name: displayLabel, exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await getAsset(page, animatedAsset)).presentation
              ?.separateHighlights
        )
        .toBe(false);
      await closeInfo(info);
      await expect(feed.locator(".feed-item")).toHaveCount(1);
      await expect(
        feed.getByRole("button", {
          name: `Open details for ${animatedAsset.name}`,
          exact: true
        })
      ).toBeVisible();
      const presentation = (await getAsset(page, animatedAsset)).presentation!;
      expect(presentation.highlights).toHaveLength(2);
      expect(presentation.mainHighlightId).toBe("opening");
    } finally {
      await context.close();
    }
  });
}

async function createContext(browser: Browser, phone: boolean) {
  const context = await browser.newContext({
    storageState,
    reducedMotion: "reduce",
    ...(phone
      ? {
          viewport: { width: 393, height: 852 },
          isMobile: true,
          hasTouch: true
        }
      : {})
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      "aether.gallery.metadata-fields",
      JSON.stringify(["title", "mediaType", "size", "score", "favorite"])
    );
    localStorage.setItem(
      "aether.feed.metadata-fields",
      JSON.stringify(["title", "score", "favorite"])
    );
  });
  return context;
}

function libraryUrl(
  view: "gallery" | "feed",
  values: Record<string, string> = {}
) {
  return `${origin}/?${new URLSearchParams({ folder: folderId, view, type: "video", sort: "filename", size: "small", aspect: "Square", highlight: "0", ...values })}`;
}

function galleryEntry(page: Page, id: string, source = asset) {
  return page.locator(`.media-tile[data-entry-key="${source.id}~${id}"]`);
}

function feedEntry(page: Page, id: string, source = asset) {
  return page.locator(`.feed-item[data-entry-key="${source.id}~${id}"]`);
}

function detailRow(details: Locator, label: string) {
  return details
    .locator(".media-file-detail")
    .filter({ has: details.page().getByText(label, { exact: true }) });
}

async function openInfo(page: Page) {
  await page
    .locator(".viewer-dialog")
    .getByRole("button", { name: `Show info for ${asset.name}`, exact: true })
    .click();
  const info = page.locator(".media-info-sheet");
  await expect(info).toBeVisible();
  return info;
}

async function closeInfo(info: Locator) {
  await info.getByRole("button", { name: "Close", exact: true }).click();
  await expect(info).toHaveCount(0);
}

async function closeViewer(page: Page) {
  await page.getByRole("button", { name: "Close viewer", exact: true }).click();
  await expect(page.locator(".viewer-dialog")).toHaveCount(0);
}

async function navigateViewer(page: Page, phone: boolean, direction: -1 | 1) {
  if (phone) {
    await page.keyboard.press(direction === 1 ? "ArrowRight" : "ArrowLeft");
  } else {
    await page
      .getByRole("button", {
        name: direction === 1 ? "Next media" : "Previous media",
        exact: true
      })
      .click();
  }
}

async function navigateFeed(page: Page, phone: boolean, direction: -1 | 1) {
  if (phone) {
    const feed = page.getByRole("region", { name: "Feed view", exact: true });
    await feed.focus();
    await feed.press(direction === 1 ? "ArrowDown" : "ArrowUp");
  } else {
    await page
      .getByRole("button", {
        name: direction === 1 ? "Next feed item" : "Previous feed item",
        exact: true
      })
      .click();
  }
}

async function observeAnimationEntries(context: BrowserContext) {
  await context.addInitScript(() => {
    const observation = window as unknown as AnimationObservationWindow;
    observation.highlightEntryDraws = [];
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      original.apply(this, args);
      if (!this.canvas.matches(".controlled-animation__canvas")) return;
      const entry =
        this.canvas.closest<HTMLElement>("[data-entry-key]")?.dataset.entryKey;
      if (!entry) return;
      const frame = Math.round(
        (this.getImageData(0, 0, 1, 1).data[0]! - 20) / 16
      );
      if (
        observation.highlightEntryDraws.findLast(
          (sample) => sample.entry === entry
        )?.frame === frame
      )
        return;
      observation.highlightEntryDraws.push({
        entry,
        source: this.canvas.getAttribute("aria-label") ?? "",
        frame,
        time: performance.now()
      });
    };
  });
}

async function expectAnimationSection(
  page: Page,
  entry: Locator,
  section: SavedHighlightValues
) {
  const key = (await entry.getAttribute("data-entry-key"))!;
  await expect(entry.locator(".controlled-animation__canvas")).toHaveCSS(
    "opacity",
    "1"
  );
  await page.evaluate(() => {
    (window as unknown as AnimationObservationWindow).highlightEntryDraws = [];
  });
  await expect
    .poll(() => animationSamples(page, key).then((samples) => samples.length), {
      timeout: 8000
    })
    .toBeGreaterThanOrEqual(8);
  const samples = await animationSamples(page, key);
  const firstFrame = section.highlight.startMs / 100;
  const lastFrame = section.highlight.endMs / 100 - 1;
  expect(samples.every((sample) => sample.source === animatedAsset.name)).toBe(
    true
  );
  expect(
    samples.every(
      (sample) => sample.frame >= firstFrame && sample.frame <= lastFrame
    )
  ).toBe(true);
  expect(new Set(samples.map(({ frame }) => frame)).size).toBe(4);
  const transitions = samples.slice(1).map((sample, index) => ({
    step: sample.frame - samples[index]!.frame,
    duration: sample.time - samples[index]!.time
  }));
  if (section.loopMode === "bounce") {
    expect(transitions.some(({ step }) => step === -1)).toBe(true);
    expect(transitions.some(({ step }) => step === 1)).toBe(true);
    expect(transitions.every(({ step }) => Math.abs(step) <= 1)).toBe(true);
  } else {
    expect(transitions.some(({ step }) => step === -3)).toBe(true);
    expect(transitions.every(({ step }) => step >= 0 || step === -3)).toBe(
      true
    );
  }
  const gaps = transitions
    .filter(({ step }) => Math.abs(step) === 1)
    .map(({ duration }) => duration)
    .sort((left, right) => left - right);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  const expectedFrameMs = 100 / section.playbackRate;
  expect(median).toBeGreaterThan(expectedFrameMs * 0.5);
  expect(median).toBeLessThan(expectedFrameMs * 1.8);
}

async function expectInactiveAnimationStops(page: Page, entry: Locator) {
  const key = (await entry.getAttribute("data-entry-key"))!;
  await page.waitForTimeout(200);
  const before = (await animationSamples(page, key)).length;
  await page.waitForTimeout(350);
  expect((await animationSamples(page, key)).length).toBe(before);
}

async function expectBoundedFeedAnimations(feed: Locator, active: Locator) {
  await expect(active.locator(".controlled-animation__canvas")).toHaveCount(1);
  const mounted = await feed.locator(".controlled-animation__canvas").count();
  expect(mounted).toBeGreaterThanOrEqual(1);
  expect(mounted).toBeLessThanOrEqual(2);
}

async function animationSamples(
  page: Page,
  entry: string
): Promise<AnimationDraw[]> {
  return page.evaluate(
    (key) =>
      (
        window as unknown as AnimationObservationWindow
      ).highlightEntryDraws.filter((sample) => sample.entry === key),
    entry
  );
}

async function expectVideoSection(
  page: Page,
  video: Locator,
  section: SavedHighlightValues
) {
  await expect(video).toBeVisible();
  const range = {
    start: section.highlight.startMs / 1000,
    end: section.highlight.endMs / 1000,
    rate: section.playbackRate
  };
  for (let sample = 0; sample < 2; sample += 1) {
    await expect
      .poll(() =>
        video.evaluate((node: HTMLVideoElement, expected) => {
          const local = node.dataset.presentationTimeline === "local";
          const start = local ? 0 : expected.start;
          const end = local ? expected.end - expected.start : expected.end;
          return {
            playing: !node.paused && !node.ended,
            inRange:
              node.currentTime >= start - 0.05 &&
              node.currentTime <= end + 0.05,
            correctSpeed: Math.abs(node.playbackRate - expected.rate) < 0.001
          };
        }, range)
      )
      .toEqual({ playing: true, inRange: true, correctSpeed: true });
    if (sample === 0) await page.waitForTimeout(350);
  }
}

async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}

async function getAsset(page: Page, source = asset): Promise<AssetRecord> {
  const response = await page.request.get(`${origin}/api/assets/${source.id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function setHighlights(
  page: Page,
  separateHighlights: boolean,
  source = asset,
  sections = highlights
) {
  const current = await getAsset(page, source);
  const response = await page.request.put(
    `${origin}/api/assets/${source.id}/presentation`,
    {
      headers: await csrf(page),
      data: {
        ...neutral,
        highlight: sections[0]!.highlight,
        playbackRate: sections[0]!.playbackRate,
        aspectFraming: sections[0]!.aspectFraming,
        highlights: sections,
        mainHighlightId: "opening",
        separateHighlights,
        expectedRevision: current.presentation?.revision ?? 0
      }
    }
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { asset: AssetRecord }).asset;
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
