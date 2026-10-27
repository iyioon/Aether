import { access, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
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
const staged = path.resolve(".e2e/aether-data/cache/e2e-fixtures/heic");
const folderName = "heic-browser-fixture";
const directory = path.resolve(".e2e/media", folderName);
const name = "camera.heic";
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;

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
    await copyFile(
      path.join(staged, "source.heic"),
      path.join(directory, name)
    );
    await copyFile(
      path.join(staged, "source.png"),
      path.join(directory, "reference.png")
    );
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === folderName
    )!.id;
    expect(folderId).toBeTruthy();
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
  test(`decodes real HEIC through Gallery, editor, Feed and Compare with source replacement on ${phone ? "phone" : "desktop"}`, async ({
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
      const page = await context.newPage();
      await copyFile(
        path.join(staged, "source.heic"),
        path.join(directory, name)
      );
      await scan(page);
      const asset = await heicAsset(page);
      expect(asset).toMatchObject({
        mediaType: "image",
        mimeType: "image/heic",
        width: 320,
        height: 160
      });
      const nativeRequests: string[] = [];
      const heicIds = new Set([asset.id]);
      page.on("request", (request) => {
        const assetId = /^\/api\/assets\/([^/]+)\/media$/.exec(
          new URL(request.url()).pathname
        )?.[1];
        if (assetId && heicIds.has(decodeURIComponent(assetId)))
          nativeRequests.push(request.url());
      });

      await open(page, "gallery", name);
      const card = page.getByRole("button", {
        name: `Open ${name}`,
        exact: true
      });
      await decoded(card.getByAltText(name, { exact: true }), 320, 160);
      await activate(card, phone);
      const viewer = page.getByRole("dialog", { name, exact: true });
      const image = viewer.locator(".viewer-image-original");
      await decoded(image, 320, 160);
      await expect(image).toHaveAttribute("src", /\/display\?v=/);
      const initialSource = await image.getAttribute("src");
      expect(
        await image.evaluate((node: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const drawing = canvas.getContext("2d")!;
          drawing.drawImage(node, 0, 0, 1, 1);
          return [...drawing.getImageData(0, 0, 1, 1).data];
        })
      ).toEqual([146, 184, 163, 255]);
      const downloadPending = page.waitForEvent("download");
      await activate(
        viewer.getByRole("link", { name: `Download ${name}`, exact: true }),
        phone
      );
      const download = await downloadPending;
      expect(download.suggestedFilename()).toBe(name);
      expect(await readFile((await download.path())!)).toEqual(
        await readFile(path.join(staged, "source.heic"))
      );
      await download.delete();

      await activate(
        viewer.getByRole("button", { name: `Edit ${name}`, exact: true }),
        phone
      );
      const editor = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await expect(editor).toBeVisible();
      await decoded(editor.locator(".media-editor-preview img"), 320, 160);
      await expect(editor.locator(".media-editor-preview img")).toHaveAttribute(
        "src",
        /\/display\?v=/
      );
      await activate(
        editor.getByRole("combobox", { name: "Framing", exact: true }),
        phone
      );
      await activate(
        page.getByRole("option", { name: "Fill", exact: true }),
        phone
      );
      await expect(editor.locator(".media-editor-grid")).toBeVisible();
      await activate(
        editor.getByRole("button", { name: "Cancel", exact: true }),
        phone
      );
      await expect(editor).toHaveCount(0);
      expect((await heicAsset(page)).presentation).toEqual(asset.presentation);
      await activate(
        viewer.getByRole("button", { name: "Close viewer", exact: true }),
        phone
      );

      await open(page, "feed", name);
      const feedImage = page
        .locator(".feed-item")
        .getByAltText(name, { exact: true });
      await decoded(feedImage, 320, 160);
      await expect(feedImage).toHaveAttribute("src", /\/display\?v=/);
      await open(page, "compare");
      await expect(page.locator(".comparison-card[data-asset-id]")).toHaveCount(
        2
      );
      const comparison = page.locator(
        `.comparison-card[data-asset-id="${asset.id}"]`
      );
      await decoded(comparison.getByAltText(name, { exact: true }), 320, 160);
      const pair = await page
        .locator(".comparison-card[data-asset-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-asset-id"))
        );
      await activate(
        comparison.getByRole("button", {
          name: `Open ${name} fullscreen`,
          exact: true
        }),
        phone
      );
      await decoded(image, 320, 160);
      await expect(image).toHaveAttribute("src", /\/display\?v=/);

      await copyFile(
        path.join(staged, "replacement.heic"),
        path.join(directory, name)
      );
      await scan(page);
      const changed = await heicAsset(page);
      expect(changed.id).not.toBe(asset.id);
      heicIds.add(changed.id);
      expect(changed).toMatchObject({ width: 180, height: 320 });
      const oldDisplay = await page.request.get(
        `${origin}/api/assets/${asset.id}/display`
      );
      expect(oldDisplay.status()).toBe(404);
      for (const kind of ["display-images", "thumbnails"]) {
        await expect(
          access(path.resolve(".e2e/aether-data/cache", kind, asset.id))
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      await open(page, "compare");
      await expect(page.locator(".comparison-card[data-asset-id]")).toHaveCount(
        2
      );
      const revalidatedIds = await page
        .locator(".comparison-card[data-asset-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-asset-id"))
        );
      const retainedId = pair.find((id) => id !== asset.id)!;
      expect(new Set(revalidatedIds)).toEqual(
        new Set([retainedId, changed.id])
      );
      const replacementCard = page.locator(
        `.comparison-card[data-asset-id="${changed.id}"]`
      );
      await decoded(
        replacementCard.getByAltText(name, { exact: true }),
        180,
        320
      );
      await activate(
        replacementCard.getByRole("button", {
          name: `Open ${name} fullscreen`,
          exact: true
        }),
        phone
      );
      await decoded(image, 180, 320);
      await page.reload();
      await decoded(image, 180, 320);
      await expect(image).not.toHaveAttribute("src", initialSource!);
      const source = new URL((await image.getAttribute("src"))!, origin);
      expect(source.pathname).toBe(`/api/assets/${changed.id}/display`);
      expect(source.searchParams.get("v")).toBe(
        `${changed.mtimeMs}-${changed.sizeBytes}`
      );
      await activate(
        viewer.getByRole("button", { name: "Close viewer", exact: true }),
        phone
      );
      await expect(page.locator(".comparison-card[data-asset-id]")).toHaveCount(
        2
      );
      expect(
        new Set(
          await page
            .locator(".comparison-card[data-asset-id]")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute("data-asset-id"))
            )
        )
      ).toEqual(new Set([retainedId, changed.id]));
      expect(nativeRequests).toEqual([]);
      await expect(
        page.getByText(/HEIC.*unavailable|preview unavailable/i)
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

async function open(
  page: Page,
  view: "gallery" | "feed" | "compare",
  query = ""
) {
  await page.goto(
    `${origin}/?folder=${encodeURIComponent(folderId)}&view=${view}&sort=filename&aspect=original&size=large&workspace=ranking&q=${encodeURIComponent(query)}`
  );
}
async function activate(control: Locator, phone: boolean) {
  if (phone) await control.tap();
  else await control.click();
}
async function decoded(image: Locator, width: number, height: number) {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node: HTMLImageElement) =>
        node.complete ? [node.naturalWidth, node.naturalHeight] : []
      )
    )
    .toEqual([width, height]);
}
async function heicAsset(page: Page): Promise<AssetRecord> {
  const response = await page.request.get(
    `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as AssetListResponse).items.find(
    (asset) => asset.name === name
  )!;
}
async function scan(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: { "x-csrf-token": csrf }
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
