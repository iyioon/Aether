import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
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
const fixtureFolder = "multiple-highlights-fixture";
const directory = path.resolve(".e2e", "media", fixtureFolder);
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
    await sharp(
      Buffer.concat(
        [20, 40, 80, 120, 200, 240].map((value) =>
          Buffer.alloc(64 * 64 * 3, value)
        )
      ),
      {
        raw: { width: 64, height: 64 * 6, channels: 3, pageHeight: 64 },
        animated: true
      }
    )
      .gif({ loop: 0, delay: [300, 300, 300, 300, 300, 300] })
      .toFile(path.join(directory, "sequence.gif"));
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
      (folder) => folder.relativePath === fixtureFolder
    )!.id;
    assets = (
      (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse
    ).items;
    expect(assets).toHaveLength(2);
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

  test(`edits independent highlights and the main selection in the ${layout} editor`, async ({
    browser
  }, testInfo) => {
    test.setTimeout(90_000);
    const context = await createContext(browser, phone);
    try {
      const page = await context.newPage();
      const asset = assets.find((item) => item.name === "clip.mp4")!;
      const saved = await setHighlights(page, asset);
      await openViewer(page, asset, true);
      let editor = await openEditor(page, asset);
      await selectHighlight(page, editor, "Ending");
      await editor
        .getByRole("textbox", { name: "Highlight name" })
        .fill("Finale");
      await chooseOption(page, editor, "Speed", "2×");
      const start = editor.getByRole("textbox", {
        name: "Start time",
        exact: true
      });
      await start.fill("invalid");
      await expect(
        editor.getByRole("combobox", { name: "Highlight", exact: true })
      ).toBeDisabled();
      await expect(
        editor.getByRole("button", { name: "Add highlight", exact: true })
      ).toBeDisabled();
      await expect(
        editor.getByRole("button", { name: "Save", exact: true })
      ).toBeDisabled();
      await start.fill("3.6");
      await selectHighlight(page, editor, "Opening");
      await expect(
        editor.getByRole("textbox", { name: "Highlight name" })
      ).toHaveValue("Opening");
      await expect(
        editor.getByRole("combobox", { name: "Speed", exact: true })
      ).toHaveText("0.75×");
      await editor.getByRole("tab", { name: "Framing", exact: true }).click();
      await expect(
        editor.getByRole("slider", { name: "Media zoom", exact: true })
      ).toHaveAttribute("aria-valuenow", "1.1");
      await selectHighlight(page, editor, "Finale");
      await expect(
        editor.getByRole("slider", { name: "Media zoom", exact: true })
      ).toHaveAttribute("aria-valuenow", "1.7");
      await editor
        .getByRole("button", { name: "Make main", exact: true })
        .click();
      await expect(
        editor.getByRole("combobox", { name: "Highlight", exact: true })
      ).toBeFocused();
      await expect(
        editor.getByText("Main highlight", { exact: true })
      ).toBeVisible();
      await expectEditorControls(editor, phone);
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`multiple-highlights-editor-${layout}.png`)
      });
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, asset.id)).presentation).toEqual(
        saved.presentation
      );

      editor = await openEditor(page, asset);
      await selectHighlight(page, editor, "Ending");
      await editor
        .getByRole("button", { name: "Add highlight", exact: true })
        .click();
      await editor
        .getByRole("textbox", { name: "Highlight name" })
        .fill("Extra");
      await editor
        .getByRole("button", { name: "Remove highlight", exact: true })
        .click();
      const confirmation = page.getByRole("alertdialog", {
        name: "Remove highlight?",
        exact: true
      });
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(
        editor.getByRole("textbox", { name: "Highlight name" })
      ).toHaveValue("Extra");
      await removeHighlight(page, editor);
      await selectHighlight(page, editor, "Ending");
      await editor
        .getByRole("textbox", { name: "Highlight name" })
        .fill("Finale");
      await chooseOption(page, editor, "Speed", "2×");
      await editor
        .getByRole("button", { name: "Make main", exact: true })
        .click();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      const updated = (await getAsset(page, asset.id)).presentation!;
      expect(updated.mainHighlightId).toBe("ending");
      expect(updated.highlights).toHaveLength(2);
      expect(updated.highlights?.find((item) => item.id === "opening")).toEqual(
        saved.presentation?.highlights?.find((item) => item.id === "opening")
      );
      expect(
        updated.highlights?.find((item) => item.id === "ending")
      ).toMatchObject({
        name: "Finale",
        playbackRate: 2,
        highlight: { startMs: 3500, endMs: 5000 }
      });

      editor = await openEditor(page, asset);
      await expect(
        editor.getByRole("textbox", { name: "Highlight name" })
      ).toHaveValue("Finale");
      await removeHighlight(page, editor);
      await expect(
        editor.getByRole("textbox", { name: "Highlight name" })
      ).toHaveValue("Opening");
      await expect(
        editor.getByText("Main highlight", { exact: true })
      ).toBeVisible();
      await removeHighlight(page, editor);
      await expect(
        editor.getByRole("textbox", { name: "Highlight name" })
      ).toHaveCount(0);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await getAsset(page, asset.id)).presentation).toMatchObject({
        highlights: [],
        mainHighlightId: null,
        highlight: null,
        playbackRate: 1,
        loopMode: "repeat"
      });
    } finally {
      await context.close();
    }
  });

  test(`switches native video highlights without changing the source or defaults on ${layout}`, async ({
    browser
  }) => {
    const context = await createContext(browser, phone);
    try {
      const page = await context.newPage();
      const asset = assets.find((item) => item.name === "clip.mp4")!;
      const saved = await setHighlights(page, asset);
      await openViewer(page, asset, true);
      const video = page.locator(".viewer-dialog video");
      await expectNativeSection(page, video, 0.25, 1.25, 0.75);
      const originalSource = await video.getAttribute("src");
      expect(originalSource).toContain(`/api/assets/${asset.id}/media?`);

      for (const section of [
        { name: "Ending", start: 3.5, end: 5, rate: 1.5 },
        { name: "Opening", start: 0.25, end: 1.25, rate: 0.75 }
      ]) {
        const info = await openInfo(page, asset);
        await info
          .getByRole("tab", { name: "Highlights", exact: true })
          .click();
        await info
          .getByRole("button", { name: `View ${section.name}`, exact: true })
          .click();
        await expect(info).toHaveCount(0);
        await expect(video).toHaveAttribute("src", originalSource!);
        await expectNativeSection(
          page,
          video,
          section.start,
          section.end,
          section.rate
        );
        expect(new URL(page.url()).searchParams.get("highlight")).toBe("1");
        expect((await getAsset(page, asset.id)).presentation).toEqual(
          saved.presentation
        );
      }
    } finally {
      await context.close();
    }
  });

  test(`views secondary GIF highlights and changes main from ${layout} Info without losing details`, async ({
    browser
  }, testInfo) => {
    test.setTimeout(90_000);
    const context = await createContext(browser, phone);
    let releaseFailure = () => undefined;
    try {
      const page = await context.newPage();
      const asset = assets.find((item) => item.name === "sequence.gif")!;
      const saved = await setHighlights(page, asset);
      await openViewer(page, asset, false);
      let info = await openInfo(page, asset);
      const tagDraft = info.getByRole("textbox", {
        name: "Add a tag",
        exact: true
      });
      await expect(tagDraft).toBeEnabled();
      await tagDraft.fill("kept draft");
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await expect(
        info.getByRole("tab", { name: "Highlights", exact: true })
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        info.getByRole("tab", { name: "Details", exact: true })
      ).toHaveAttribute("aria-selected", "false");
      await expect(info.locator(".media-highlight-item")).toHaveCount(2);
      await expect(
        info.locator(".media-highlight-item").filter({ hasText: "Opening" })
      ).toContainText("Main");
      await info.getByRole("tab", { name: "Details", exact: true }).click();
      await expect(tagDraft).toHaveValue("kept draft");
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`multiple-highlights-info-${layout}.png`)
      });
      await info
        .getByRole("button", { name: "View Ending", exact: true })
        .click();
      await expect(info).toHaveCount(0);
      const viewer = page.locator(".viewer-dialog");
      const seek = viewer.getByRole("slider", {
        name: "Seek animation",
        exact: true
      });
      await expect(seek).toHaveAttribute("min", "1.2");
      await expect(seek).toHaveAttribute("max", "1.8");
      const canvas = viewer.locator(".controlled-animation__canvas");
      await expect(canvas).toHaveCSS("opacity", "1");
      await expect(canvas).toHaveCSS(
        "transform",
        "matrix(1.7, 0, 0, 1.7, 0, 0)"
      );
      await expect(canvas).toHaveCSS("object-position", "70% 60%");
      await expect
        .poll(() =>
          canvas.evaluate(
            (node: HTMLCanvasElement) =>
              node.getContext("2d")?.getImageData(0, 0, 1, 1).data[0] ?? 0
          )
        )
        .toBeGreaterThanOrEqual(180);
      expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");
      expect((await getAsset(page, asset.id)).presentation).toEqual(
        saved.presentation
      );

      info = await openInfo(page, asset);
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      const failureGate = new Promise<void>((resolve) => {
        releaseFailure = resolve;
      });
      await page.route(
        `**/api/assets/${asset.id}/presentation`,
        async (route) => {
          if (route.request().method() !== "PUT") return route.continue();
          await failureGate;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "processing_busy" })
          });
        }
      );
      await info
        .getByRole("button", {
          name: "Make Ending the main highlight",
          exact: true
        })
        .click();
      await expect(
        info.getByRole("button", { name: "Close", exact: true })
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(info).toBeVisible();
      releaseFailure();
      await expect(info.getByRole("alert")).toContainText(
        "could not be confirmed"
      );
      expect(
        (await getAsset(page, asset.id)).presentation?.mainHighlightId
      ).toBe("opening");
      await page.unroute(`**/api/assets/${asset.id}/presentation`);
      await info.getByRole("button", { name: "Close", exact: true }).click();
      await expect(info).toHaveCount(0);
      info = await openInfo(page, asset);
      await info.getByRole("tab", { name: "Highlights", exact: true }).click();
      await info
        .getByRole("button", {
          name: "Make Ending the main highlight",
          exact: true
        })
        .click();
      const ending = info
        .locator(".media-highlight-item")
        .filter({ hasText: "Ending" });
      await expect(ending).toContainText("Main");
      await expect(
        ending.getByRole("button", { name: "View Ending", exact: true })
      ).toBeFocused();
      expect(
        (await getAsset(page, asset.id)).presentation?.mainHighlightId
      ).toBe("ending");
      await info
        .getByRole("button", { name: "Edit media", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await expect(
        editor.getByRole("textbox", { name: "Highlight name" })
      ).toHaveValue("Ending");
      await expect(
        editor.getByRole("combobox", { name: "Speed", exact: true })
      ).toHaveText("1.5×");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.reload();
      await expect(
        page
          .locator(".viewer-dialog")
          .getByRole("slider", { name: "Seek animation", exact: true })
      ).toHaveAttribute("min", "0");
      expect(new URL(page.url()).searchParams.get("highlight")).toBe("0");
    } finally {
      releaseFailure();
      await context.close();
    }
  });
}

test("keeps long highlight names and editor actions reachable in short touch landscape", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const asset = assets.find((item) => item.name === "clip.mp4")!;
    const longName = "A".repeat(80);
    await setHighlights(page, asset, ["Opening", longName]);
    await openViewer(page, asset, true);
    const editor = await openEditor(page, asset);
    const inspector = editor.locator(".media-editor-inspector");
    await selectHighlight(page, editor, longName);
    const picker = editor.getByRole("combobox", {
      name: "Highlight",
      exact: true
    });
    const name = editor.getByRole("textbox", { name: "Highlight name" });
    const makeMain = editor.getByRole("button", {
      name: "Make main",
      exact: true
    });
    const remove = editor.getByRole("button", {
      name: "Remove highlight",
      exact: true
    });
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await expect(name).toHaveValue(longName);

    for (const control of [picker, name, makeMain, remove, save]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(844);
      expect(box.y + box.height).toBeLessThanOrEqual(390);
    }
    expect(
      await inspector.evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await name.scrollIntoViewIfNeeded();
    await name.fill("B".repeat(80));
    await makeMain.click();
    await expect(
      editor.getByText("Main highlight", { exact: true })
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("multiple-highlights-short-landscape.png")
    });
    await removeHighlight(page, editor);
    await expect(name).toHaveValue("Opening");
    await removeHighlight(page, editor);
    const add = editor.getByRole("button", {
      name: "Add highlight",
      exact: true
    });
    await expect(add).toBeFocused();
    await expect(add).toBeEnabled();
    expect(
      await add.evaluate(
        (node) => node.isConnected && !node.closest("[hidden]")
      )
    ).toBe(true);
    await save.click();
    await expect(editor).toHaveCount(0);
    expect((await getAsset(page, asset.id)).presentation).toMatchObject({
      highlights: [],
      mainHighlightId: null
    });
  } finally {
    await context.close();
  }
});

async function createContext(browser: Browser, phone: boolean) {
  return browser.newContext({
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
}

async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}

async function getAsset(page: Page, assetId: string): Promise<AssetRecord> {
  const response = await page.request.get(`${origin}/api/assets/${assetId}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function setHighlights(
  page: Page,
  asset: AssetRecord,
  names: readonly [string, string] = ["Opening", "Ending"]
) {
  const duration = asset.mediaType === "video" ? 6000 : 1800;
  const highlights: SavedHighlightValues[] = [
    {
      ...neutral,
      id: "opening",
      name: names[0],
      highlight: {
        startMs: duration === 6000 ? 250 : 0,
        endMs: duration === 6000 ? 1250 : 600
      },
      playbackRate: 0.75,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.3, focalY: 0.4, zoom: 1.1 }
      }
    },
    {
      ...neutral,
      id: "ending",
      name: names[1],
      highlight: {
        startMs: duration === 6000 ? 3500 : 1200,
        endMs: duration === 6000 ? 5000 : 1800
      },
      playbackRate: 1.5,
      loopMode: duration === 6000 ? "repeat" : "bounce",
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.7, focalY: 0.6, zoom: 1.7 }
      }
    }
  ];
  const current = await getAsset(page, asset.id);
  const response = await page.request.put(
    `${origin}/api/assets/${asset.id}/presentation`,
    {
      headers: await csrf(page),
      data: {
        ...neutral,
        highlight: highlights[0]!.highlight,
        playbackRate: highlights[0]!.playbackRate,
        aspectFraming: highlights[0]!.aspectFraming,
        highlights,
        mainHighlightId: "opening",
        expectedRevision: current.presentation?.revision ?? 0
      }
    }
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { asset: AssetRecord }).asset;
}

async function openViewer(
  page: Page,
  asset: AssetRecord,
  highlightsOnly: boolean
) {
  await page.goto(
    `${origin}/?folder=${encodeURIComponent(folderId)}&view=gallery&type=${asset.mediaType}&sort=filename&size=large&aspect=Square&highlight=${highlightsOnly ? "1" : "0"}&asset=${encodeURIComponent(asset.id)}`
  );
  await expect(page.locator(".viewer-dialog")).toBeVisible();
}

async function openEditor(page: Page, asset: AssetRecord) {
  await page
    .locator(".viewer-dialog")
    .getByRole("button", {
      name: `More options for ${asset.name}`,
      exact: true
    })
    .click();
  await page.getByRole("menuitem", { name: "Edit media", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit media", exact: true });
  await expect(
    editor.getByRole("textbox", { name: "Highlight name" })
  ).toBeVisible();
  return editor;
}

async function openInfo(page: Page, asset: AssetRecord) {
  await page
    .locator(".viewer-dialog")
    .getByRole("button", { name: `Show info for ${asset.name}`, exact: true })
    .click();
  const info = page.locator(".media-info-sheet");
  await expect(info).toBeVisible();
  return info;
}

async function selectHighlight(page: Page, editor: Locator, name: string) {
  await editor
    .getByRole("combobox", { name: "Highlight", exact: true })
    .click();
  await page
    .getByRole("option", { name: new RegExp(`^${name}(?: \\(main\\))?$`) })
    .click();
}

async function chooseOption(
  page: Page,
  editor: Locator,
  label: string,
  option: string
) {
  await editor.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function removeHighlight(page: Page, editor: Locator) {
  await editor
    .getByRole("button", { name: "Remove highlight", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", {
    name: "Remove highlight?",
    exact: true
  });
  await dialog
    .getByRole("button", { name: "Remove highlight", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function expectEditorControls(editor: Locator, phone: boolean) {
  const controls = [
    editor.getByRole("combobox", { name: "Highlight", exact: true }),
    editor.getByRole("button", { name: "Remove highlight", exact: true }),
    editor.getByRole("button", { name: "Save", exact: true })
  ];
  for (const control of controls) {
    await expect(control).toBeInViewport();
    if (phone) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  }
  expect(
    await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true);
}

async function expectNativeSection(
  page: Page,
  video: Locator,
  start: number,
  end: number,
  rate: number
) {
  const initialFrames = await video.evaluate(
    (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames
  );
  for (let sample = 0; sample < 3; sample++) {
    await expect
      .poll(() =>
        video.evaluate(
          (node: HTMLVideoElement, section) => ({
            playing: !node.paused && !node.ended,
            correctRange:
              node.currentTime >= section.start - 0.05 &&
              node.currentTime <= section.end + 0.05,
            correctSpeed: Math.abs(node.playbackRate - section.rate) < 0.001
          }),
          { start, end, rate }
        )
      )
      .toEqual({ playing: true, correctRange: true, correctSpeed: true });
    if (sample < 2) await page.waitForTimeout(700);
  }
  await expect
    .poll(() =>
      video.evaluate(
        (node: HTMLVideoElement) =>
          node.getVideoPlaybackQuality().totalVideoFrames
      )
    )
    .toBeGreaterThan(initialFrames);
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
