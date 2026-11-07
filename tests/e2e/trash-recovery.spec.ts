import { expect, test, type Page } from "@playwright/test";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  AssetRecord,
  FileOperation,
  ScanJob,
  TrashResponse,
  TreeResponse
} from "../../apps/web/src/api/client";
import { chooseAccountAction } from "./account-menu";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNwSesAAAIkATMgan5NAAAAAElFTkSuQmCC",
  "base64"
);

async function csrf(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(token).toBeTruthy();
  return { "x-csrf-token": token! };
}

async function scan(page: Page) {
  const response = await page.request.post("/api/admin/scan", {
    headers: await csrf(page)
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const { jobs } = (await (
          await page.request.get("/api/admin/jobs")
        ).json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
}

async function completed(page: Page, operationId: string) {
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get(`/api/file-operations/${operationId}`)
          ).json()) as FileOperation
        ).status,
      { timeout: 30_000 }
    )
    .toBe("completed");
}

for (const phone of [false, true]) {
  test(`recovers a published Trash item through Activity on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: origin,
      ...(phone
        ? {
            viewport: { width: 320, height: 760 },
            isMobile: true,
            hasTouch: true
          }
        : {})
    });
    const page = await context.newPage();
    const name = `trash-recovery-${phone ? "phone" : "desktop"}.png`;
    const originalPath = path.resolve(".e2e/media", name);
    let restored = false;
    try {
      await writeFile(originalPath, fixtureBytes);
      await page.goto("/");
      await page
        .getByLabel("Password", { exact: true })
        .fill("aether-e2e-password");
      await page.getByRole("button", { name: "Enter", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      await scan(page);
      const tree = (await (
        await page.request.get("/api/tree")
      ).json()) as TreeResponse;
      const root = tree.roots[0]!;
      const result = (await (
        await page.request.get(
          `/api/folders/${root.folderId}/assets?recursive=true&search=${encodeURIComponent(name)}&limit=100`
        )
      ).json()) as AssetListResponse;
      expect(result.items).toHaveLength(1);
      const asset = result.items[0]!;
      const seeded = await page.request.post("/api/e2e/trash-publication", {
        headers: await csrf(page),
        data: { assetId: asset.id }
      });
      expect(seeded.ok()).toBe(true);
      const { operationId } = (await seeded.json()) as { operationId: string };
      const retainedPath = path.resolve(
        ".e2e/media/.aether-trash",
        operationId,
        "0"
      );
      await expect(access(originalPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
      expect(await readFile(retainedPath)).toEqual(fixtureBytes);
      const initialTrash = (await (
        await page.request.get(`/api/trash?search=${encodeURIComponent(name)}`)
      ).json()) as TrashResponse;
      expect(initialTrash.items).toEqual([]);

      await page.goto(
        `/?folder=${root.folderId}&view=gallery&q=${encodeURIComponent(name)}`
      );
      const gallery = page.getByRole("region", { name: "Gallery view" });
      const card = gallery.locator(`[data-asset-id="${asset.id}"]`);
      await expect(card).toBeVisible();
      expect(
        (await page.request.head(`/api/assets/${asset.id}/download`)).status()
      ).toBe(404);
      await chooseAccountAction(page, "Activity");
      const activity = page.getByRole("dialog", {
        name: "Activity",
        exact: true
      });
      const operation = activity
        .getByRole("region", { name: "Move to Trash", exact: true })
        .filter({ hasText: name });
      await expect(operation).toContainText("Needs attention");
      await expect(operation).toContainText(
        "Another item occupies this operation’s destination."
      );
      await expect(operation).not.toContainText("Choose another name");
      await expect(operation).not.toContainText("Update library");
      const retry = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/file-operations/${operationId}/retry`
      );
      await operation
        .getByRole("button", { name: "Check again", exact: true })
        .click();
      const retryResponse = await retry;
      expect(retryResponse.status()).toBe(202);
      expect(((await retryResponse.json()) as FileOperation).id).toBe(
        operationId
      );
      await completed(page, operationId);
      const latestTrashOperation = activity
        .getByRole("region", { name: "Move to Trash", exact: true })
        .first();
      await expect(latestTrashOperation).toContainText("Completed");
      await expect(
        latestTrashOperation.getByRole("button", { name: "Check again" })
      ).toHaveCount(0);
      await activity
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(activity).toBeHidden();
      await expect(card).toHaveCount(0);
      const notification = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "1 item moved to Trash" });
      await expect(notification).toBeVisible();
      await expect(
        notification.getByRole("button", { name: "Undo", exact: true })
      ).toBeVisible();
      await notification
        .getByRole("button", { name: "Close toast", exact: true })
        .click();
      await expect(notification).toBeHidden();

      const trash = (await (
        await page.request.get(`/api/trash?search=${encodeURIComponent(name)}`)
      ).json()) as TrashResponse;
      expect(trash.items).toHaveLength(1);
      expect(trash.items[0]).toMatchObject({
        id: `${operationId}-0`,
        assetId: asset.id,
        name
      });
      expect(await readFile(retainedPath)).toEqual(fixtureBytes);
      await chooseAccountAction(page, "Trash");
      await expect(
        page.getByRole("heading", { name, exact: true })
      ).toBeVisible();
      await page
        .getByRole("button", { name: `Restore ${name}`, exact: true })
        .click();
      const restoreResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/file-operations"
      );
      await page
        .getByRole("dialog", { name: "Restore media", exact: true })
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      const restoredOperation = (await (
        await restoreResponse
      ).json()) as FileOperation;
      await completed(page, restoredOperation.id);
      const restoredAsset = (await (
        await page.request.get(`/api/assets/${asset.id}`)
      ).json()) as AssetRecord;
      expect(restoredAsset).toMatchObject({ id: asset.id, name });
      expect(await readFile(originalPath)).toEqual(fixtureBytes);
      restored = true;
    } finally {
      // Leave a failed recovery's retained entry intact for the failure trace.
      // The browser harness removes the entire disposable library at startup.
      try {
        await rm(originalPath, { force: true });
        if (restored) await scan(page);
      } finally {
        await context.close();
      }
    }
  });
}
