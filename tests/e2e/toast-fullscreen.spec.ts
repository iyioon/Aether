import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  FileOperation,
  FileOperationInput,
  ScanJob
} from "../../apps/web/src/api/client";
import { chooseAccountAction } from "./account-menu";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;

async function openLibrary(page: Page) {
  await page.goto(origin);
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.locator(".library-main")).toBeVisible();
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
        const jobs = await page.request.get(`${origin}/api/admin/jobs`);
        return ((await jobs.json()) as { jobs: ScanJob[] }).jobs.find(
          (job) => job.id === jobId
        )?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("completed");
  await page.goto(`${origin}/?view=gallery&q=family-photo.png`);
}

async function expectHitTarget(target: Locator) {
  await expect(target).toBeVisible();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        return hit !== null && element.contains(hit);
      })
    )
    .toBe(true);
}

async function expectTouchTarget(target: Locator, minimumTop: number) {
  await expect
    .poll(() =>
      target.evaluate((element, safeTop) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const after = getComputedStyle(element, "::after");
        const hasHitArea = after.content !== "none";
        const outset = (value: string) =>
          hasHitArea ? Math.min(0, parseFloat(value) || 0) : 0;
        const border = (value: string) =>
          hasHitArea ? parseFloat(value) || 0 : 0;
        const left =
          rect.left + border(style.borderLeftWidth) + outset(after.left);
        const top = rect.top + border(style.borderTopWidth) + outset(after.top);
        const right =
          rect.right - border(style.borderRightWidth) - outset(after.right);
        const bottom =
          rect.bottom - border(style.borderBottomWidth) - outset(after.bottom);
        const centerX = (left + right) / 2;
        const centerY = (top + bottom) / 2;
        const hit = (x: number, y: number) =>
          element.contains(document.elementFromPoint(x, y));
        return {
          minimumWidth: right - left >= 44,
          minimumHeight: bottom - top >= 44,
          withinSafeArea: top >= safeTop,
          withinViewport:
            left >= 0 && right <= innerWidth && bottom <= innerHeight,
          acceptsEdges: {
            left: hit(left + 1, centerY),
            right: hit(right - 1, centerY),
            top: hit(centerX, top + 1),
            bottom: hit(centerX, bottom - 1)
          }
        };
      }, minimumTop)
    )
    .toEqual({
      minimumWidth: true,
      minimumHeight: true,
      withinSafeArea: true,
      withinViewport: true,
      acceptsEdges: { left: true, right: true, top: true, bottom: true }
    });
}

for (const phone of [false, true]) {
  test(`keeps notifications interactive inside viewer, nested modal and fullscreen (${phone ? "phone" : "desktop"})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 960 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      const operations: FileOperation[] = Array.from(
        { length: phone ? 5 : 4 },
        (_, index) => ({
          id: `toast-operation-${index}`,
          type: "create-folder",
          status: "running",
          revision: "1",
          createdAt: "2026-01-01T10:00:00.000Z",
          updatedAt: "2026-01-01T10:00:00.000Z",
          items: [{ name: `Toast folder ${index}`, status: "pending" }]
        })
      );
      operations[0] = {
        ...operations[0]!,
        type: "trash",
        items: [
          {
            name: "Toast folder 0",
            trashId: "toast-trash-item",
            status: "pending"
          }
        ]
      };
      let metadataWrites = 0;
      let undoReads = 0;
      const restoreRequests: FileOperationInput[] = [];
      let releaseRetryRead!: () => void;
      const heldRetryRead = new Promise<void>((resolve) => {
        releaseRetryRead = resolve;
      });
      let releaseRestore!: () => void;
      const heldRestore = new Promise<void>((resolve) => {
        releaseRestore = resolve;
      });
      await page.route(`${origin}/api/assets/*/score`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        metadataWrites += 1;
        return route.fulfill({
          status: 503,
          json: { error: "test_unavailable" }
        });
      });
      await page.route(`${origin}/api/trash?*`, async (route) => {
        undoReads += 1;
        if (undoReads > 1) {
          await heldRetryRead;
          return route.fulfill({
            json: {
              items: [
                {
                  id: "toast-trash-item",
                  assetId: "toast-asset",
                  name: "Toast folder 0",
                  originalRootId: "toast-root",
                  originalFolderId: null,
                  originalRelativePath: "Toast folder 0",
                  sizeBytes: 0,
                  deletedAt: "2026-01-01T10:00:00.000Z",
                  expiresAt: "2026-02-01T10:00:00.000Z",
                  sourceVersion: "toast-trash-version"
                }
              ],
              retentionDays: 30,
              revision: "1",
              totalRetained: 1,
              page: { total: 1, offset: 0, limit: 100 }
            }
          });
        }
        return route.fulfill({
          status: 503,
          json: { error: "test_unavailable" }
        });
      });
      await page.route(`${origin}/api/file-operations`, async (route) => {
        if (route.request().method() === "POST") {
          restoreRequests.push(
            route.request().postDataJSON() as FileOperationInput
          );
          await heldRestore;
          return route.fulfill({
            status: 503,
            json: { error: "test_unavailable" }
          });
        }
        return route.fulfill({ json: { items: operations } });
      });
      await page.route(`${origin}/api/file-operations/*`, (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-1);
        const operation = operations.find((item) => item.id === id);
        if (!operation)
          return route.fulfill({
            status: 404,
            json: { error: "operation_not_found" }
          });
        return route.fulfill({ json: operation });
      });
      await openLibrary(page);
      if (phone)
        await page.evaluate(() => {
          document.documentElement.style.setProperty(
            "--media-safe-area-top",
            "47px"
          );
          document.documentElement.style.setProperty(
            "--media-safe-area-bottom",
            "34px"
          );
        });
      await chooseAccountAction(page, "Activity");
      await expect(page.locator(".activity-page")).toContainText(
        "Toast folder 0"
      );
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page
        .getByRole("button", { name: "Open family-photo.png", exact: true })
        .click();
      const viewer = page.locator(".viewer-dialog");
      await expect(viewer).toBeVisible();

      await viewer.locator(".viewer-fit-area").focus();
      await page.keyboard.press("ArrowUp");
      const metadataError = page.locator("[data-sonner-toast]").filter({
        hasText: "Media update failed"
      });
      await expect(metadataError).toBeVisible();
      await expectHitTarget(
        metadataError.getByRole("button", { name: "Close toast" })
      );
      const closeMetadataToast = metadataError.getByRole("button", {
        name: "Close toast"
      });
      if (phone) {
        await expectTouchTarget(closeMetadataToast, 47);
        // The extra touch area dismisses the toast as well as its visible icon.
        const closeBounds = (await closeMetadataToast.boundingBox())!;
        await page.touchscreen.tap(
          closeBounds.x + closeBounds.width / 2,
          closeBounds.y - 8
        );
      } else await closeMetadataToast.click();
      await expect(metadataError).toHaveCount(0);
      await expect(viewer).toBeVisible();
      expect(metadataWrites).toBe(1);

      const finishOperation = async (index: number) => {
        const operation = operations[index]!;
        operations[index] = {
          ...operation,
          status: "completed",
          revision: "2",
          items: operation.items.map((item) => ({
            ...item,
            status: "completed"
          })),
          summary: { total: 1, completed: 1, failed: 0, cancelled: 0 }
        };
        const toast = page.locator(`[data-sonner-toast][data-type='success']`);
        await expect(toast).toHaveCount(1);
        await expect(toast).toContainText(
          operation.type === "trash"
            ? "1 item moved to Trash"
            : "Folder created"
        );
        await expect(page.locator("[data-sonner-toaster]")).toHaveCount(1);
        return toast;
      };

      const first = await finishOperation(0);
      await expectHitTarget(first);
      await first.getByText("1 item moved to Trash", { exact: true }).click();
      await expect(viewer).toBeVisible();
      await expect(viewer.getByRole("heading")).toHaveText("family-photo.png");
      await expectHitTarget(
        first.getByRole("button", { name: "Undo", exact: true })
      );
      if (phone)
        await expectTouchTarget(
          first.getByRole("button", { name: "Undo", exact: true }),
          47
        );
      await first.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(first).toHaveCount(0);
      const undoError = page.locator("[data-sonner-toast]").filter({
        hasText: "Restore could not be confirmed"
      });
      await expect(undoError).toBeVisible();
      await undoError
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await expect.poll(() => undoReads).toBe(2);
      await undoError
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      expect(undoReads).toBe(2);
      expect(restoreRequests).toHaveLength(0);
      releaseRetryRead();
      await expect.poll(() => restoreRequests.length).toBe(1);
      expect(restoreRequests[0]).toMatchObject({
        type: "restore",
        items: [
          {
            trashId: "toast-trash-item",
            expectedVersion: "toast-trash-version"
          }
        ]
      });
      await undoError
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      expect(undoReads).toBe(2);
      expect(restoreRequests).toHaveLength(1);
      const restoreResponse = page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/file-operations` &&
          response.request().method() === "POST"
      );
      releaseRestore();
      expect((await restoreResponse).status()).toBe(503);
      await expect(undoError).toBeVisible();
      await undoError.getByRole("button", { name: "Close toast" }).click();
      await expect(undoError).toHaveCount(0);
      expect(undoReads).toBe(2);
      expect(restoreRequests).toHaveLength(1);
      await expect(viewer).toBeVisible();

      const second = await finishOperation(1);
      const retainedToast = await second.elementHandle();
      await viewer.locator(".viewer-fit-area").focus();
      await page.keyboard.press("i");
      const info = page.locator(".media-info-sheet");
      await expect(info).toBeVisible();
      await expect
        .poll(() =>
          second.evaluate((node) => Boolean(node.closest(".media-info-sheet")))
        )
        .toBe(true);
      expect(
        await retainedToast!.evaluate(
          (node) => node === document.querySelector("[data-sonner-toast]")
        )
      ).toBe(true);
      await expectHitTarget(
        second.getByRole("button", { name: "Close toast" })
      );
      await second.getByRole("button", { name: "Close toast" }).click();
      await expect(second).toHaveCount(0);
      await expect(info).toBeVisible();
      await info.getByRole("button", { name: "Close", exact: true }).click();
      await expect(info).toHaveCount(0);
      await retainedToast!.dispose();

      const third = await finishOperation(2);
      const closeViewer = viewer.getByRole("button", { name: "Close viewer" });
      await closeViewer.focus();
      await page.keyboard.press("Alt+t");
      await expect(page.locator("[data-sonner-toaster]")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(third).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        third.getByRole("button", { name: "Close toast" })
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        third.getByRole("button", { name: "View activity" })
      ).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("i");
      await expect(info).toHaveCount(0);
      await expect(viewer.getByRole("heading")).toHaveText("family-photo.png");
      await page.keyboard.press("Escape");
      await expect(closeViewer).toBeFocused();
      await expect(viewer).toHaveAttribute("data-state", "open");
      await third.getByRole("button", { name: "Close toast" }).click();
      await expect(third).toHaveCount(0);

      const sidebar = page.getByRole("dialog", {
        name: "Sidebar",
        exact: true
      });
      if (phone) {
        await closeViewer.click();
        await expect(viewer).toHaveCount(0);
        await page
          .getByRole("button", { name: "Toggle Sidebar", exact: true })
          .click();
        await expect(sidebar).toBeVisible();
        await sidebar
          .getByRole("button", { name: "Account", exact: true })
          .focus();
      }
      const fourth = await finishOperation(3);
      if (phone) {
        await expect
          .poll(() =>
            fourth.evaluate((node) =>
              Boolean(node.closest('[data-slot="sidebar"][data-mobile="true"]'))
            )
          )
          .toBe(true);
        await page.keyboard.press("Alt+t");
        await expect(page.locator("[data-sonner-toaster]")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(fourth).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
          fourth.getByRole("button", { name: "Close toast" })
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
          fourth.getByRole("button", { name: "View activity" })
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(
          sidebar.getByRole("button", { name: "Account", exact: true })
        ).toBeFocused();
        await expect(sidebar).toHaveAttribute("data-state", "open");
      }
      if (!phone) {
        await viewer.evaluate((element) => element.requestFullscreen());
        await expect
          .poll(() =>
            fourth.evaluate((node) =>
              Boolean(document.fullscreenElement?.contains(node))
            )
          )
          .toBe(true);
      }
      const activityAction = fourth.getByRole("button", {
        name: "View activity"
      });
      await expectHitTarget(activityAction);
      await activityAction.click();
      await expect(viewer).toHaveCount(0);
      await expect(page.locator(".activity-page")).toBeVisible();
      await expect(page).toHaveURL(/\bpage=activity\b/);
      if (phone) {
        await expect(sidebar).toHaveCount(0);
        await expect(
          page
            .locator(".activity-page")
            .getByRole("heading", { name: "Activity", exact: true })
        ).toBeFocused();
        await expect(fourth).toHaveCount(0);
        await page
          .getByRole("button", { name: "Toggle Sidebar", exact: true })
          .click();
        await expect(sidebar).toBeVisible();
        const fifth = await finishOperation(4);
        await expect
          .poll(() =>
            fifth.evaluate((node) =>
              Boolean(node.closest('[data-slot="sidebar"][data-mobile="true"]'))
            )
          )
          .toBe(true);
        const revisitActivity = fifth.getByRole("button", {
          name: "View activity"
        });
        await expectHitTarget(revisitActivity);
        await revisitActivity.focus();
        await expect(revisitActivity).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(sidebar).toHaveCount(0);
        await expect(page.locator(".activity-page")).toBeVisible();
        await expect(page).toHaveURL(/\bpage=activity\b/);
        await expect(
          page.getByRole("button", { name: "Toggle Sidebar", exact: true })
        ).toBeFocused();
      }
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement))
        .toBeNull();
    } finally {
      await context.close();
    }
  });
}
