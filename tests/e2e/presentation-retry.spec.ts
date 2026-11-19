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
const fixtureFolder = "presentation-retry-fixture";
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
    await sharp({
      create: { width: 240, height: 120, channels: 3, background: "#7797bb" }
    })
      .png()
      .toFile(path.join(directory, "photo.png"));
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
  for (const mediaType of ["image", "video"] as const) {
    test(`retries ${mediaType} preview failures without losing the ${layout} edit draft`, async ({
      browser
    }, testInfo) => {
      const context = await browser.newContext({
        storageState,
        serviceWorkers: "block",
        reducedMotion: "reduce",
        ...(phone
          ? {
              viewport: { width: 393, height: 852 },
              isMobile: true,
              hasTouch: true
            }
          : {})
      });
      const recover = loadingGate();
      try {
        const page = await context.newPage();
        const asset = assets.find((item) => item.mediaType === mediaType)!;
        await setPresentation(page, asset);
        const saved = await getAsset(page, asset.id);
        let writes = 0;
        page.on("request", (request) => {
          if (
            request.method() === "PUT" &&
            new URL(request.url()).pathname ===
              `/api/assets/${asset.id}/presentation`
          )
            writes += 1;
        });
        const editor = await openEditor(page, asset);
        const preview = editor.locator(
          `.media-editor-frame ${mediaType === "video" ? "video" : "img"}`
        );
        await expectDecoded(preview, mediaType);
        if (mediaType === "video") {
          await chooseOption(page, editor, "Highlight", "Ending");
          await editor
            .getByRole("textbox", { name: "Highlight name", exact: true })
            .fill("Closing");
          await editor
            .getByRole("button", { name: "Make main", exact: true })
            .click();
          await editor
            .getByRole("textbox", { name: "Start time", exact: true })
            .fill("2.3");
          await editor
            .getByRole("textbox", { name: "End time", exact: true })
            .fill("4.5");
          const timeline = editor.getByRole("slider", {
            name: "Preview position",
            exact: true
          });
          await timeline.press("Home");
          for (let index = 0; index < 3; index++)
            await timeline.press("PageUp");
          await expect(timeline).toHaveAttribute("aria-valuenow", "3000");
          await editor
            .getByRole("tab", { name: "Framing", exact: true })
            .click();
        }
        await chooseOption(page, editor, "Media layout", "Portrait");
        const zoom = editor.getByRole("slider", {
          name: "Media zoom",
          exact: true
        });
        await zoom.press("ArrowRight");
        await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
        let failRequests = true;
        let failedReads = 0;
        await page.route(`**/api/assets/${asset.id}/media?*`, async (route) => {
          if (failRequests) {
            failedReads += 1;
            await route.abort("failed");
          } else {
            await recover.promise;
            await route.continue().catch(() => undefined);
          }
        });
        await preview.dispatchEvent("error");
        const notice = editor.locator(".media-error-notice");
        const retry = notice.getByRole("button", {
          name: "Retry",
          exact: true
        });
        await expect(retry).toBeVisible();
        if (phone) {
          const message = await notice
            .locator(".media-error-notice__message")
            .boundingBox();
          expect(message!.width).toBeGreaterThan(80);
          await editor.screenshot({
            path: testInfo.outputPath(`${mediaType}-preview-retry-phone.png`)
          });
        }
        if (mediaType === "video")
          await expect(
            editor.getByRole("button", { name: "Play preview", exact: true })
          ).toBeDisabled();
        await retry.click();
        await expect.poll(() => failedReads).toBeGreaterThan(0);
        await expect(retry).toBeVisible();
        await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
        expect(writes).toBe(0);
        failRequests = false;
        await retry.click();
        await expect(notice).toHaveCount(0);
        await expect
          .poll(() =>
            editor.evaluate(
              (node) =>
                node.contains(document.activeElement) &&
                document.activeElement !== document.body
            )
          )
          .toBe(true);
        if (mediaType === "video")
          await expect(
            editor.getByRole("button", { name: "Play preview", exact: true })
          ).toBeDisabled();
        recover.release();
        await expectDecoded(preview, mediaType);
        await expect(zoom).toHaveAttribute("aria-valuenow", "1.01");
        await expect(
          editor.getByRole("combobox", { name: "Media layout", exact: true })
        ).toHaveText("Portrait");
        await expect(
          editor.getByRole("button", { name: "Save", exact: true })
        ).toBeEnabled();
        if (mediaType === "video") {
          await expect(
            editor.getByRole("tab", { name: "Framing", exact: true })
          ).toHaveAttribute("aria-selected", "true");
          await expect(
            editor.getByRole("combobox", { name: "Highlight", exact: true })
          ).toHaveText("Closing");
          await expect(
            editor.getByText("Main highlight", { exact: true })
          ).toBeVisible();
          const timeline = editor.getByRole("slider", {
            name: "Preview position",
            exact: true
          });
          await expect(timeline).toHaveAttribute("aria-valuenow", "3000");
          await expect(preview).toHaveJSProperty("paused", true);
          await expect
            .poll(() =>
              preview.evaluate((node: HTMLVideoElement) => node.currentTime)
            )
            .toBeCloseTo(3, 3);
          await page.keyboard.press("Space");
          await expect(
            editor.getByRole("button", { name: "Pause preview", exact: true })
          ).toBeVisible();
          await page.keyboard.press("Space");
          await expect(
            editor.getByRole("button", { name: "Play preview", exact: true })
          ).toBeVisible();
          await editor
            .getByRole("tab", { name: "Playback", exact: true })
            .click();
          await expect(
            editor.getByRole("textbox", { name: "Start time", exact: true })
          ).toHaveValue("0:02.300");
          await expect(
            editor.getByRole("textbox", { name: "End time", exact: true })
          ).toHaveValue("0:04.500");
        } else {
          await page.keyboard.press("Tab");
          expect(
            await editor.evaluate((node) =>
              node.contains(document.activeElement)
            )
          ).toBe(true);
        }
        expect(writes).toBe(0);
        await editor
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(editor).toHaveCount(0);
        expect((await getAsset(page, asset.id)).presentation).toEqual(
          saved.presentation
        );
        expect(writes).toBe(0);
      } finally {
        recover.release();
        await context.close();
      }
    });
  }
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
  return editor;
}

async function expectDecoded(preview: Locator, mediaType: "image" | "video") {
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((node) =>
        node instanceof HTMLVideoElement
          ? node.readyState >= 2
          : (node as HTMLImageElement).complete &&
            (node as HTMLImageElement).naturalWidth > 0
      )
    )
    .toBe(true);
  if (mediaType === "video")
    await expect(preview).toHaveJSProperty("paused", true);
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

async function getAsset(page: Page, id: string): Promise<AssetRecord> {
  const response = await page.request.get(`${origin}/api/assets/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function setPresentation(page: Page, asset: AssetRecord) {
  const current = await getAsset(page, asset.id);
  const highlights =
    asset.mediaType === "video"
      ? [
          {
            ...neutral,
            id: "opening",
            name: "Opening",
            highlight: { startMs: 500, endMs: 1500 }
          },
          {
            ...neutral,
            id: "ending",
            name: "Ending",
            highlight: { startMs: 2000, endMs: 4000 }
          }
        ]
      : [];
  const response = await page.request.put(
    `${origin}/api/assets/${asset.id}/presentation`,
    {
      headers: await csrf(page),
      data: {
        ...neutral,
        highlight: highlights[0]?.highlight ?? null,
        highlights,
        mainHighlightId: highlights[0]?.id ?? null,
        separateHighlights: false,
        expectedRevision: current.presentation?.revision ?? 0
      }
    }
  );
  expect(response.ok()).toBe(true);
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

function loadingGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
