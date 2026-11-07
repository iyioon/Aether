import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type {
  FileOperation,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;

async function scan(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.post("/api/admin/scan", {
    headers: { "x-csrf-token": csrf }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(async () => {
      const { jobs } = (await (
        await page.request.get("/api/admin/jobs")
      ).json()) as { jobs: ScanJob[] };
      return jobs.find((job) => job.id === jobId)?.status;
    })
    .toBe("completed");
}

async function revealFolders(page: Page) {
  const tree = page.getByRole("tree", { name: "Media folders", exact: true });
  if (!(await tree.isVisible()))
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
  await expect(tree).toBeVisible();
  return tree;
}

for (const phone of [false, true]) {
  test(`folder context actions retain the current view and target the clicked folder on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }, testInfo) => {
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
    const fixtureName = `Folder-menu-${randomUUID()}`;
    const fixture = path.resolve(".e2e", "media", fixtureName);
    try {
      await mkdir(path.join(fixture, "Selected"), { recursive: true });
      await mkdir(path.join(fixture, "Target"));
      await page.goto("/");
      await page
        .getByLabel("Password", { exact: true })
        .fill("aether-e2e-password");
      await page.getByRole("button", { name: "Enter", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Gallery view", exact: true })
      ).toBeVisible();
      await scan(page);
      const tree = (await (
        await page.request.get("/api/tree")
      ).json()) as TreeResponse;
      const selected = tree.folders.find(
        (folder) => folder.relativePath === `${fixtureName}/Selected`
      )!;
      const target = tree.folders.find(
        (folder) => folder.relativePath === `${fixtureName}/Target`
      )!;
      expect(selected).toBeDefined();
      expect(target).toBeDefined();
      await page.goto(`/?folder=${selected.id}&view=gallery`);
      const folders = await revealFolders(page);
      const targetRow = page.locator(
        `[role="tree"] [data-folder-id="${target.id}"]`
      );
      const selectedRow = page.locator(
        `[role="tree"] [data-folder-id="${selected.id}"]`
      );
      await expect(targetRow).toBeVisible();
      const originalUrl = page.url();

      await targetRow.click({ button: "right" });
      const menu = page.getByRole("menu", {
        name: "Actions for Target",
        exact: true
      });
      await expect(menu).toBeVisible();
      await expect(selectedRow).toHaveAttribute("aria-selected", "true");
      await expect(targetRow).toHaveAttribute("aria-selected", "false");
      expect(page.url()).toBe(originalUrl);
      await page.keyboard.press("Escape");
      await expect(targetRow).toBeFocused();
      await expect(selectedRow).toHaveAttribute("aria-selected", "true");

      await targetRow.press("Shift+F10");
      await expect(menu).toBeVisible();
      await menu
        .getByRole("menuitem", { name: "Rename…", exact: true })
        .click();
      const rename = page.getByRole("dialog", {
        name: "Rename folder",
        exact: true
      });
      await expect(
        rename.getByRole("textbox", { name: "Name", exact: true })
      ).toHaveValue("Target");
      await rename.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(page.url()).toBe(originalUrl);

      await revealFolders(page);
      await targetRow.click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "New folder", exact: true })
        .click();
      const create = page.getByRole("dialog", {
        name: "Create folder",
        exact: true
      });
      await expect(create).toContainText("Target");
      await create
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("Child");
      const accepted = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/file-operations") &&
          response.request().method() === "POST"
      );
      await create
        .getByRole("button", { name: "Create folder", exact: true })
        .click();
      const response = await accepted;
      expect(response.status()).toBe(202);
      expect(response.request().postDataJSON()).toMatchObject({
        type: "create-folder",
        destinationFolderId: target.id,
        name: "Child"
      });
      const operation = (await response.json()) as FileOperation;
      await expect
        .poll(async () => {
          const result = (await (
            await page.request.get(`/api/file-operations/${operation.id}`)
          ).json()) as FileOperation;
          return result.status;
        })
        .toBe("completed");
      await expect(create).toBeHidden();
      expect(page.url()).toBe(originalUrl);

      await revealFolders(page);
      const rootRow = folders.locator(
        `[data-folder-id="${tree.roots[0]!.folderId}"]`
      );
      await rootRow.click({ button: "right" });
      const rootMenu = page.getByRole("menu", {
        name: `Actions for ${tree.roots[0]!.label}`,
        exact: true
      });
      await expect(
        rootMenu.getByRole("menuitem", { name: "New folder", exact: true })
      ).toBeEnabled();
      await expect(
        rootMenu.getByRole("menuitem", { name: "Rename…", exact: true })
      ).toBeDisabled();
      await expect(
        rootMenu.getByRole("menuitem", { name: "Move to…", exact: true })
      ).toBeDisabled();
      await page.screenshot({
        path: testInfo.outputPath("folder-context.png"),
        animations: "disabled"
      });
      await page.keyboard.press("Escape");

      await page.route("**/api/tree", async (route) => {
        const response = await route.fetch();
        const current = (await response.json()) as TreeResponse;
        await route.fulfill({
          response,
          json: {
            ...current,
            roots: current.roots.map((root) => ({
              ...root,
              writable: false,
              allowedActions: []
            })),
            folders: current.folders.map((folder) => ({
              ...folder,
              writable: false,
              allowedActions: []
            }))
          } satisfies TreeResponse
        });
      });
      await page.reload();
      await revealFolders(page);
      await targetRow.focus();
      await targetRow.press("ContextMenu");
      await expect(menu).toBeVisible();
      for (const name of ["New folder", "Rename…", "Move to…"])
        await expect(
          menu.getByRole("menuitem", { name, exact: true })
        ).toBeDisabled();
      expect(page.url()).toBe(originalUrl);
      if (phone) {
        for (const item of await menu.getByRole("menuitem").all()) {
          await expect
            .poll(async () => (await item.boundingBox())?.height ?? 0)
            .toBeGreaterThanOrEqual(44);
          const bounds = await item.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        }
      }
    } finally {
      await context.close();
      await rm(fixture, { recursive: true, force: true });
    }
  });
}
