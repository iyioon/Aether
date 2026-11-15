import { expect, test, type Page } from "@playwright/test";
import type {
  FileOperationPreviewInput,
  TreeResponse,
  UploadRecord
} from "../../apps/web/src/api/client";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const unsupportedMediaMessage =
  "This file could not be read as a supported photo or video. Choose another file.";
const tree: TreeResponse = {
  revision: "1",
  roots: [
    {
      id: "photos",
      folderId: "photos-root",
      label: "Photos",
      assetCount: 0,
      writable: true,
      sourceVersion: "root-version"
    }
  ],
  folders: []
};

async function mockUploadFailures(page: Page, uploads: UploadRecord[] = []) {
  const rejected: string[] = [];
  const unhandled: string[] = [];
  let statusReads = 0;
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/auth/me") {
        await route.fulfill({
          json: { authenticated: true, expiresAt: null }
        });
      } else if (url.pathname === "/api/tree") {
        await route.fulfill({ json: tree });
      } else if (/^\/api\/folders\/[^/]+\/assets$/.test(url.pathname)) {
        await route.fulfill({
          json: {
            folderId: "photos-root",
            items: [],
            page: { offset: 0, limit: 80, total: 0, revision: "1" },
            sort: url.searchParams.get("sort") ?? "date",
            order: url.searchParams.get("order") ?? "desc",
            type: "all",
            recursive: true,
            search: "",
            tags: [],
            score: "all",
            seed: 1
          }
        });
      } else if (
        url.pathname === "/api/file-operations/preview" &&
        request.method() === "POST"
      ) {
        const input = request.postDataJSON() as FileOperationPreviewInput;
        expect(input.type).toBe("add-media");
        if (input.type !== "add-media") throw new Error("Unexpected preview");
        await route.fulfill({
          json: {
            revision: "1",
            items: input.files.map((file, index) => ({
              key: file.clientId,
              index,
              name: file.name,
              destinationFolderId: "photos-root",
              destinationLabel: "Photos",
              expectedParentVersion: "root-version",
              hasConflict: false,
              proposedName: file.name,
              choice: "skip",
              noOp: false
            }))
          }
        });
      } else if (url.pathname === "/api/file-operations") {
        await route.fulfill({ json: { items: [] } });
      } else if (url.pathname === "/api/uploads/status") {
        statusReads++;
        await route.fulfill({
          json: {
            items: uploads,
            limits: {
              maxUploadBytes: 10 * 1024 * 1024,
              maxStagingBytes: 100 * 1024 * 1024,
              chunkBytes: 1024 * 1024,
              maxBatchItems: 100
            }
          }
        });
      } else if (
        url.pathname === "/api/uploads" &&
        request.method() === "POST"
      ) {
        rejected.push(request.headers()["upload-metadata"] ?? "");
        await route.fulfill({
          status: 415,
          contentType: "text/plain",
          body: "unsupported_media"
        });
      } else if (url.pathname === "/api/admin/jobs") {
        await route.fulfill({ json: { jobs: [] } });
      } else if (url.pathname === "/api/admin/ai") {
        await route.fulfill({
          json: { enabled: false, provider: "disabled", model: null }
        });
      } else if (url.pathname === "/api/admin/watch") {
        await route.fulfill({
          json: {
            enabled: false,
            running: false,
            debounceMs: 0,
            watchedDirectories: 0,
            lastEventAt: null,
            lastScanJobId: null,
            lastError: null
          }
        });
      } else if (url.pathname === "/api/tags/suggest") {
        await route.fulfill({ json: { tags: [] } });
      } else {
        unhandled.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({
          status: 404,
          json: { error: "test_not_mocked" }
        });
      }
    }
  );
  return { rejected, unhandled, statusReads: () => statusReads };
}

async function addFile(page: Page, name: string) {
  const addMedia = page.locator(".add-media-page");
  await expect(addMedia).toBeVisible();
  await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from([1, 2, 3])
  });
  await addMedia
    .getByRole("button", { name: "Add files", exact: true })
    .click();
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  await expect(
    activity.getByRole("button", { name: "Refresh Activity", exact: true })
  ).toBeEnabled();
  return activity.getByRole("region", { name: `Upload ${name}`, exact: true });
}

for (const phone of [false, true]) {
  const layout = phone ? "phone" : "desktop";
  test(`keeps rejected uploads in Activity after refresh and another batch on ${layout}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 320, height: 760 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const requests = await mockUploadFailures(page);
      await page.goto("/?page=add-media&folder=photos-root");
      const first = await addFile(page, "first-photo.png");
      await expect(first.getByText("Failed", { exact: true })).toBeVisible();
      await expect(first.getByRole("alert")).toHaveText(
        unsupportedMediaMessage
      );
      const firstCreatedAt = await first
        .locator("time")
        .getAttribute("datetime");
      expect(Number.isFinite(Date.parse(firstCreatedAt!))).toBe(true);
      const activity = page.getByRole("region", {
        name: "Activity",
        exact: true
      });
      const readsBeforeRefresh = requests.statusReads();
      await activity
        .getByRole("button", { name: "Refresh Activity", exact: true })
        .click();
      await expect
        .poll(requests.statusReads)
        .toBeGreaterThan(readsBeforeRefresh);
      await expect(
        activity.getByRole("button", { name: "Refresh Activity", exact: true })
      ).toBeEnabled();
      await expect(first.getByRole("alert")).toHaveText(
        unsupportedMediaMessage
      );
      await expect(first.locator("time")).toHaveAttribute(
        "datetime",
        firstCreatedAt!
      );
      await expect(activity.getByText("No recent activity.")).toHaveCount(0);

      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page
        .getByRole("region", { name: "Library controls", exact: true })
        .getByRole("button", { name: "Add media", exact: true })
        .click();
      const second = await addFile(page, "second-photo.png");
      await expect(second.getByText("Failed", { exact: true })).toBeVisible();
      await expect(second.getByRole("alert")).toHaveText(
        unsupportedMediaMessage
      );
      await expect(first.getByRole("alert")).toHaveText(
        unsupportedMediaMessage
      );
      await expect(activity.locator(".activity-item")).toHaveCount(2);
      await expect(activity.locator(".activity-item-name")).toHaveText([
        "second-photo.png",
        "first-photo.png"
      ]);
      await expect(activity).toBeInViewport();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual((await page.viewportSize())!.width);
      expect(requests.rejected).toHaveLength(2);
      expect(requests.unhandled).toEqual([]);
      await activity.screenshot({
        path: test.info().outputPath(`rejected-uploads-${layout}.png`),
        animations: "disabled"
      });
    } finally {
      await context.close();
    }
  });

  test(`shows the retained HEIC failure after reloading Activity on ${layout}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 320, height: 760 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const requests = await mockUploadFailures(page, [
        {
          id: "8ba325ad-2c9c-4d34-a3cb-167775f284a0",
          requestId: "d79a5736-28c5-411d-bdf7-979062aa9968",
          name: "IMG_1234.HEIC",
          status: "failed",
          errorCode: "heic_decoder_unavailable",
          offset: 1024,
          size: 1024,
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2030-01-01T00:00:00.000Z"
        }
      ]);
      await page.goto("/?page=activity");
      const activity = page.getByRole("region", {
        name: "Activity",
        exact: true
      });
      const failed = activity.getByRole("region", {
        name: "Upload IMG_1234.HEIC",
        exact: true
      });
      await expect(failed.getByText("Failed", { exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(/HEIC|HEIF/);
      await expect(failed.getByRole("alert")).toContainText(/server/i);
      const message = await failed.getByRole("alert").textContent();
      await page.reload();
      await expect(failed.getByRole("alert")).toHaveText(message!);
      await activity
        .getByRole("tab", { name: "Needs attention", exact: true })
        .click();
      await expect(failed).toBeVisible();
      await expect(
        failed.getByRole("button", { name: "Resume", exact: true })
      ).toHaveCount(0);
      expect(requests.rejected).toEqual([]);
      expect(requests.unhandled).toEqual([]);
      await activity.screenshot({
        path: test.info().outputPath(`heic-failure-${layout}.png`),
        animations: "disabled"
      });
    } finally {
      await context.close();
    }
  });
}
