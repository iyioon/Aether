import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  FileOperation,
  ScanJob,
  TrashResponse,
  TreeResponse
} from "../../apps/web/src/api/client";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;

async function csrf(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
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

async function signInAndScan(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  await scan(page);
  return (await (await page.request.get("/api/tree")).json()) as TreeResponse;
}

async function folderAction(page: Page, name: "Rename…" | "Move to…") {
  const actions = page.getByRole("button", {
    name: "Selected folder actions",
    exact: true
  });
  if (!(await actions.isVisible()))
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
  await actions.click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function waitForOperation(page: Page, id: string) {
  let operation: FileOperation | undefined;
  await expect
    .poll(
      async () => {
        operation = (await (
          await page.request.get(
            `/api/file-operations/${encodeURIComponent(id)}`
          )
        ).json()) as FileOperation;
        return operation.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
  const activity = page.getByRole("dialog", { name: "Activity", exact: true });
  if (await activity.isVisible())
    await activity.getByRole("button", { name: "Close", exact: true }).click();
  return operation!;
}

async function submitDialog(page: Page, button: Locator) {
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/file-operations") &&
      response.request().method() === "POST"
  );
  await button.click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const operation = (await response.json()) as FileOperation;
  await waitForOperation(page, operation.id);
  return response.request().postDataJSON() as Record<string, unknown>;
}

async function openTrash(page: Page) {
  const button = page.getByRole("button", { name: "Trash", exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
  await button.click();
  await expect(
    page.getByRole("heading", { name: "Trash", exact: true })
  ).toBeVisible();
}

async function expectDestinationContained(page: Page, dialog: Locator) {
  await expect(
    dialog.getByRole("heading", { name: "Move folder", exact: true })
  ).toBeInViewport();
  await expect
    .poll(async () =>
      dialog.evaluate((element) => ({
        scrollLeft: element.scrollLeft,
        overflow: element.scrollWidth - element.clientWidth
      }))
    )
    .toEqual({ scrollLeft: 0, overflow: 0 });
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {}))
    );
  });
  // Sample the dialog and its controls in one frame after the opening motion.
  const { bounds, controls } = await dialog.evaluate((element) => {
    const rect = (target: Element) => {
      const { x, y, width, height } = target.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      bounds: rect(element),
      controls: [
        ...element.querySelectorAll(
          'button,[data-slot="dialog-title"],[data-slot="sheet-title"]'
        )
      ].map((control) => ({
        name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
        ...rect(control)
      }))
    };
  });
  for (const name of ["Move folder", "Close", "Move here", "Cancel"]) {
    const controlBounds = controls.find((control) => control.name === name);
    expect(controlBounds).toBeDefined();
    expect(controlBounds!.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(controlBounds!.x + controlBounds!.width).toBeLessThanOrEqual(
      bounds.x + bounds.width + 1
    );
    expect(controlBounds!.y).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(controlBounds!.y + controlBounds!.height).toBeLessThanOrEqual(
      bounds.y + bounds.height + 1
    );
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ).toBeLessThanOrEqual(1);
  if (page.viewportSize()!.width <= 767) {
    for (const name of [
      "Back to parent folder",
      "New folder",
      "Close",
      "Cancel",
      "Move here"
    ]) {
      const target = controls.find((control) => control.name === name);
      expect(target).toBeDefined();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
  }
}

for (const phone of [false, true]) {
  const layout = phone ? "phone" : "desktop";
  test(`checks folder contents and creates a destination inline on ${layout}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      ...(phone
        ? {
            viewport: { width: 320, height: 760 },
            isMobile: true,
            hasTouch: true
          }
        : {})
    });
    const page = await context.newPage();
    const fixtureName = `Folder-review-${randomUUID()}`;
    const fixture = path.resolve(".e2e", "media", fixtureName);
    let releaseInventory: () => void = () => undefined;
    try {
      await mkdir(path.join(fixture, "Source", "Child"), { recursive: true });
      await mkdir(path.join(fixture, "Destination"));
      await writeFile(path.join(fixture, "Source", "photo.png"), png);
      await writeFile(path.join(fixture, "Source", ".metadata"), "sidecar");
      const tree = await signInAndScan(page);
      const source = tree.folders.find(
        (folder) => folder.relativePath === `${fixtureName}/Source`
      )!;
      const original = (await (
        await page.request.get(`/api/folders/${source.id}/assets?limit=100`)
      ).json()) as AssetListResponse;
      expect(original.items).toHaveLength(1);
      await page.goto(`/?folder=${source.id}&view=gallery`);
      const held = new Promise<void>((resolve) => {
        releaseInventory = resolve;
      });
      const inventoryPattern = /\/api\/folders\/[^/]+\/inventory\?/;
      await page.route(inventoryPattern, async (route) => {
        await held;
        await route.continue();
      });
      await folderAction(page, "Rename…");
      const rename = page.getByRole("dialog", {
        name: "Rename folder",
        exact: true
      });
      await expect(
        rename.getByText("Checking folder…", { exact: true })
      ).toBeVisible();
      await expect(
        rename.getByRole("button", { name: "Rename", exact: true })
      ).toBeDisabled();
      releaseInventory();
      await expect(rename.getByText(/2 files · 1 folder/)).toBeVisible();
      await expect(
        rename.getByText("Includes hidden files and sidecars.", { exact: true })
      ).toBeVisible();
      await page.unroute(inventoryPattern);
      await rename
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("Renamed");
      const renameInput = await submitDialog(
        page,
        rename.getByRole("button", { name: "Rename", exact: true })
      );
      expect(renameInput.expectedInventoryVersion).toMatch(/^[a-f0-9]{64}$/);
      const renamedTree = (await (
        await page.request.get("/api/tree")
      ).json()) as TreeResponse;
      expect(
        renamedTree.folders.find((folder) => folder.id === source.id)
          ?.relativePath
      ).toBe(`${fixtureName}/Renamed`);
      await page.goto(`/?folder=${source.id}&view=gallery`);
      await folderAction(page, "Move to…");
      const move = page.getByRole("dialog", {
        name: "Move folder",
        exact: true
      });
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(move.getByText(/2 files · 1 folder/)).toBeVisible();
      await expect(
        move.getByRole("button", {
          name: "Open Renamed, Inside the folder being moved",
          exact: true
        })
      ).toBeDisabled();
      await move
        .getByRole("button", { name: "Open Destination", exact: true })
        .click();
      await move
        .getByRole("button", { name: "Back to parent folder", exact: true })
        .click();
      await expect(
        move.getByRole("button", { name: "Open Destination", exact: true })
      ).toBeVisible();
      await move
        .getByRole("button", { name: "Open Destination", exact: true })
        .click();
      await move
        .getByRole("button", { name: "New folder", exact: true })
        .click();
      const name = move.getByRole("textbox", {
        name: "Folder name",
        exact: true
      });
      await expect(name).toBeFocused();
      await name.fill("Nested");
      await submitDialog(
        page,
        move.getByRole("button", { name: "Create", exact: true })
      );
      await expect(move).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(move.locator('[data-slot="breadcrumb-page"]')).toHaveText(
        "Nested"
      );
      const moveHere = move.getByRole("button", {
        name: "Move here",
        exact: true
      });
      await expect(moveHere).toBeEnabled();
      await expectDestinationContained(page, move);
      if (!phone) {
        await page.setViewportSize({ width: 320, height: 760 });
        await expect(move).toHaveAttribute("data-slot", "sheet-content");
        await expectDestinationContained(page, move);
        await page.setViewportSize({ width: 1440, height: 980 });
        await expect(move).toHaveAttribute("data-slot", "dialog-content");
        await expectDestinationContained(page, move);
      }
      const bounds = await move.boundingBox();
      const footer = await moveHere.boundingBox();
      expect(bounds).not.toBeNull();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height + 1
      );
      if (phone) {
        expect(bounds!.y).toBeGreaterThanOrEqual(-1);
        expect(bounds!.height).toBeGreaterThanOrEqual(
          page.viewportSize()!.height - 2
        );
      }
      const screenshotPath = test
        .info()
        .outputPath(`folder-destination-${layout}.png`);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await page.screenshot({ path: screenshotPath, animations: "disabled" });
      await test.info().attach(`folder-destination-${layout}`, {
        path: screenshotPath,
        contentType: "image/png"
      });
      const moveInput = await submitDialog(page, moveHere);
      expect(moveInput.expectedInventoryVersion).toMatch(/^[a-f0-9]{64}$/);
      const movedTree = (await (
        await page.request.get("/api/tree")
      ).json()) as TreeResponse;
      const moved = movedTree.folders.find(
        (folder) => folder.id === source.id
      )!;
      expect(moved.relativePath).toBe(
        `${fixtureName}/Destination/Nested/Renamed`
      );
      const records = (await (
        await page.request.get(`/api/folders/${source.id}/assets?limit=100`)
      ).json()) as AssetListResponse;
      expect(records.items[0]?.id).toBe(original.items[0]!.id);
      expect(
        await readFile(
          path.join(fixture, "Destination", "Nested", "Renamed", ".metadata"),
          "utf8"
        )
      ).toBe("sidecar");
    } finally {
      releaseInventory();
      await rm(fixture, { recursive: true, force: true });
      await scan(page);
      await context.close();
    }
  });

  test(`empties retained items hidden by Trash search on ${layout}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      ...(phone
        ? {
            viewport: { width: 320, height: 760 },
            isMobile: true,
            hasTouch: true
          }
        : {})
    });
    const page = await context.newPage();
    const fixtureName = `Trash-review-${randomUUID()}`;
    const fixture = path.resolve(".e2e", "media", fixtureName);
    const visibleName = `visible-${randomUUID()}-${randomUUID()}.png`;
    const hiddenName = `hidden-${randomUUID()}.png`;
    try {
      await mkdir(fixture);
      await writeFile(path.join(fixture, visibleName), png);
      await writeFile(path.join(fixture, hiddenName), png);
      const tree = await signInAndScan(page);
      const folder = tree.folders.find(
        (entry) => entry.relativePath === fixtureName
      )!;
      const records = (await (
        await page.request.get(`/api/folders/${folder.id}/assets?limit=100`)
      ).json()) as AssetListResponse;
      expect(records.items).toHaveLength(2);
      const response = await page.request.post("/api/file-operations", {
        headers: await csrf(page),
        data: {
          requestId: randomUUID(),
          type: "trash",
          items: records.items.map((asset) => ({
            assetId: asset.id,
            expectedVersion: asset.sourceVersion
          }))
        }
      });
      expect(response.status()).toBe(202);
      await waitForOperation(
        page,
        ((await response.json()) as FileOperation).id
      );
      await page.reload();
      await openTrash(page);
      await page
        .getByRole("textbox", { name: "Search Trash", exact: true })
        .fill(visibleName);
      await expect(
        page.getByRole("heading", { name: visibleName, exact: true })
      ).toBeVisible();
      if (phone) {
        const article = page.getByRole("article").filter({
          has: page.getByRole("heading", { name: visibleName, exact: true })
        });
        const selected = article.getByRole("checkbox", {
          name: `Select ${visibleName}`,
          exact: true
        });
        await expect(selected).not.toBeChecked();
        await article.locator(".trash-selection-label img").tap();
        await expect(selected).toBeChecked();
        const selectionBounds = await article
          .locator(".trash-selection-label")
          .boundingBox();
        expect(selectionBounds!.height).toBeGreaterThanOrEqual(44);
        expect(selectionBounds!.width).toBeGreaterThanOrEqual(44);
        const trashPage = page.locator(".trash-page");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth
          )
        ).toBeLessThanOrEqual(0);
        expect(
          await trashPage.evaluate(
            (element) => element.scrollWidth - element.clientWidth
          )
        ).toBeLessThanOrEqual(0);
        for (const control of [
          trashPage.getByRole("textbox", { name: "Search Trash", exact: true }),
          trashPage.getByRole("button", { name: "Empty Trash", exact: true }),
          trashPage
            .locator(".trash-toolbar")
            .getByRole("button", { name: "Restore", exact: true }),
          trashPage
            .locator(".trash-toolbar")
            .getByRole("button", { name: "Delete permanently", exact: true })
        ]) {
          await expect(control).toBeEnabled();
          const target = await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2
            );
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              reached: hit !== null && element.contains(hit),
              viewportWidth: innerWidth,
              viewportHeight: innerHeight
            };
          });
          expect(target.left).toBeGreaterThanOrEqual(0);
          expect(target.right).toBeLessThanOrEqual(target.viewportWidth);
          expect(target.top).toBeGreaterThanOrEqual(0);
          expect(target.bottom).toBeLessThanOrEqual(target.viewportHeight);
          expect(target.reached).toBe(true);
        }
        const screenshotPath = test
          .info()
          .outputPath("trash-selection-phone.png");
        await page.screenshot({ path: screenshotPath, animations: "disabled" });
        await test.info().attach("trash-selection-phone", {
          path: screenshotPath,
          contentType: "image/png"
        });
      }
      await expect(
        page.getByRole("heading", { name: hiddenName, exact: true })
      ).toHaveCount(0);
      const retained = (await (
        await page.request.get("/api/trash")
      ).json()) as TrashResponse;
      expect(retained.totalRetained).toBeGreaterThanOrEqual(2);
      await page
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      const confirm = page.getByRole("alertdialog", {
        name: "Empty Trash?",
        exact: true
      });
      await expect(confirm).toContainText(
        `all ${retained.totalRetained} retained items, including items hidden by search`
      );
      await confirm
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      expect(
        ((await (await page.request.get("/api/trash")).json()) as TrashResponse)
          .totalRetained
      ).toBe(retained.totalRetained);
      await page
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      const accepted = page.waitForResponse(
        (entry) =>
          entry.url().endsWith("/api/trash/empty") &&
          entry.request().method() === "POST"
      );
      await confirm
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      const emptyResponse = await accepted;
      expect(emptyResponse.status()).toBe(202);
      await waitForOperation(
        page,
        ((await emptyResponse.json()) as FileOperation).id
      );
      await page
        .getByRole("button", { name: "Refresh Trash", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Empty Trash", exact: true })
      ).toBeDisabled();
      expect(
        ((await (await page.request.get("/api/trash")).json()) as TrashResponse)
          .totalRetained
      ).toBe(0);
      for (const asset of records.items)
        expect(
          (await page.request.get(`/api/assets/${asset.id}`)).status()
        ).toBe(404);
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await scan(page);
      await context.close();
    }
  });
}
