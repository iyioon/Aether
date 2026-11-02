import { expect, test, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  AssetRecord,
  FileOperation,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
test.use({ baseURL: productionBaseURL });

async function signInAndScan(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  const headers = await csrf(page);
  const response = await page.request.post("/api/admin/scan", { headers });
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
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  return ((await (await page.request.get("/api/tree")).json()) as TreeResponse)
    .roots[0]!;
}
async function csrf(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  return { "x-csrf-token": token! };
}
async function libraryAssets(page: Page, folderId: string) {
  return (
    (await (
      await page.request.get(
        `/api/folders/${encodeURIComponent(folderId)}/assets?limit=100&recursive=true&sort=filename`
      )
    ).json()) as AssetListResponse
  ).items;
}
async function toolbarGeometry(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".library-path-actions button"
      )
    )
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          name:
            button.getAttribute("aria-label") ??
            button.textContent?.trim() ??
            "",
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
          reachable:
            document
              .elementFromPoint(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2
              )
              ?.closest("button") === button
        };
      })
  );
}
async function closeActivity(page: Page) {
  const activity = page.getByRole("dialog", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  await activity.getByRole("button", { name: "Close", exact: true }).click();
  await expect(activity).toBeHidden();
}
async function operationDone(
  page: Page,
  type: FileOperation["type"],
  name?: string,
  closePanel = true
) {
  let result: FileOperation | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/file-operations");
        const { items } = (await response.json()) as { items: FileOperation[] };
        result = items.find(
          (operation) =>
            operation.type === type &&
            (!name ||
              operation.items.some(
                (item) =>
                  item.asset?.name === name ||
                  (item.folder?.label ?? item.folder?.name) === name
              ))
        );
        return result?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
  if (closePanel) await closeActivity(page);
  return result!;
}

for (const phone of [false, true]) {
  test(`keeps repeated score edits stable and separates Score and Tags on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext(
      phone
        ? {
            baseURL: `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`,
            viewport: { width: 320, height: 760 },
            isMobile: true,
            hasTouch: true
          }
        : {}
    );
    const page = await context.newPage();
    const root = await signInAndScan(page);
    const records = await libraryAssets(page, root.folderId);
    const first = records.find((asset) => asset.name === "family-photo.png")!;
    const second = records.find((asset) => asset.name === "beach-walk.png")!;
    const headers = await csrf(page);
    const reset = async () => {
      for (const asset of [first, second]) {
        await page.request.patch(`/api/assets/${asset.id}/score`, {
          headers,
          data: { score: asset.score, favorite: asset.favorite }
        });
        await page.request.put(`/api/assets/${asset.id}/tags`, {
          headers,
          data: { tags: asset.tags.map((tag) => tag.displayName) }
        });
      }
    };
    try {
      await page.request.patch(`/api/assets/${first.id}/score`, {
        headers,
        data: { score: 2 }
      });
      await page.request.patch(`/api/assets/${second.id}/score`, {
        headers,
        data: { score: 3 }
      });
      await page.goto(
        `/?folder=${root.folderId}&view=gallery&sort=score&order=asc&size=small`
      );
      await page.getByRole("button", { name: /^View options/ }).click();
      const options = page.getByRole("dialog", {
        name: "View options",
        exact: true
      });
      await options.getByRole("tab", { name: "Layout", exact: true }).click();
      const scoreField = options.getByRole("checkbox", {
        name: "Score",
        exact: true
      });
      if (!(await scoreField.isChecked())) await scoreField.check();
      await page.keyboard.press("Escape");
      const gallery = page.getByRole("region", { name: "Gallery view" });
      const increase = gallery.getByRole("button", {
        name: /^Increase score for family-photo.png/
      });
      await expect(increase).toBeVisible();
      await increase.scrollIntoViewIfNeeded();
      const beforeBounds = await increase.boundingBox();
      const beforeControls = await toolbarGeometry(page);
      const before = await gallery
        .locator(".media-preview-button")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label"))
        );
      await increase.click();
      await expect(increase).toHaveAccessibleName(/Current score: 3/);
      await expect(increase).toBeEnabled();
      if (phone) {
        const pendingControls = await toolbarGeometry(page);
        for (const control of beforeControls) {
          const current = pendingControls.find(
            (item) => item.name === control.name
          )!;
          expect(Math.abs(current.left - control.left)).toBeLessThanOrEqual(1);
        }
        for (const control of pendingControls) {
          expect(control.width).toBeGreaterThanOrEqual(44);
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.reachable).toBe(true);
        }
      }
      await increase.click();
      await expect(increase).toHaveAccessibleName(/Current score: 4/);
      const scoreUrl = `**/api/assets/${first.id}/score`;
      await page.route(scoreUrl, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "score_update_failed" })
        })
      );
      await increase.click();
      await expect(increase).toHaveAccessibleName(/Current score: 4/);
      await expect(
        page
          .locator("[data-sonner-toast]")
          .filter({ hasText: "Media update failed" })
      ).toHaveCount(1);
      await expect(page.locator(".inline-error")).toHaveCount(0);
      await page.unroute(scoreUrl);
      const afterBounds = await increase.boundingBox();
      expect(Math.abs(afterBounds!.x - beforeBounds!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(afterBounds!.y - beforeBounds!.y)).toBeLessThanOrEqual(1);
      await expect(
        page
          .getByRole("region", { name: "Library controls" })
          .getByRole("status")
      ).toContainText(`${records.length} shown`);
      expect(
        await gallery
          .locator(".media-preview-button")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-label"))
          )
          .then((names) => names.filter((name) => before.includes(name)))
      ).toEqual(before);
      const update = page
        .getByRole("region", { name: "Library controls" })
        .getByRole("button", { name: "Update results", exact: true });
      await expect(update).toBeEnabled();
      await page
        .getByRole("button", { name: "Select media", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Select family-photo.png", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Select beach-walk.png", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit details", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Edit details",
        exact: true
      });
      const score = editor.getByRole("textbox", { name: "Score", exact: true });
      await expect(score).toHaveAttribute("placeholder", "Mixed");
      if (phone) {
        for (const control of [
          editor.getByRole("tab", { name: "Score", exact: true }),
          editor.getByRole("tab", { name: "Tags", exact: true }),
          editor.getByRole("button", { name: "Apply", exact: true }),
          editor.getByRole("button", { name: "Cancel", exact: true }),
          editor.getByRole("button", { name: "Close", exact: true })
        ]) {
          const bounds = await control.boundingBox();
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
        }
        await expect
          .poll(() =>
            page
              .locator(".batch-actions-bar")
              .evaluate((element) => element.scrollWidth <= element.clientWidth)
          )
          .toBe(true);
      }
      await editor.screenshot({
        path: testInfo.outputPath("edit-details.png")
      });
      await expect(
        editor.getByRole("checkbox", { name: "Change score" })
      ).toHaveCount(0);
      await score.fill("12");
      await page.route(
        "**/api/assets/batch/scores",
        (route) =>
          route.fulfill({ status: 500, json: { error: "temporary_failure" } }),
        { times: 1 }
      );
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText(
        "Unable to update selection."
      );
      await editor.getByRole("tab", { name: "Tags", exact: true }).click();
      await editor
        .getByRole("textbox", { name: "Tag name", exact: true })
        .fill("UI draft");
      await editor.getByRole("tab", { name: "Score", exact: true }).click();
      await expect(score).toHaveValue("12");
      await editor.getByRole("tab", { name: "Tags", exact: true }).click();
      await expect(
        editor.getByRole("textbox", { name: "Tag name", exact: true })
      ).toHaveValue("UI draft");
      const requestPending = page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/assets/batch/tags") &&
          request.method() === "POST"
      );
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      expect((await requestPending).postDataJSON()).not.toHaveProperty("score");
      await expect(
        editor.getByRole("button", { name: "Apply", exact: true })
      ).toBeDisabled();
      await editor.getByRole("tab", { name: "Score", exact: true }).click();
      await expect(score).toHaveValue("12");
      await expect(editor.getByRole("alert")).toContainText(
        "Unable to update selection."
      );
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      expect(
        await gallery
          .locator(".media-preview-button")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-label"))
          )
          .then((names) => names.filter((name) => before.includes(name)))
      ).toEqual(before);
      let releaseRefresh: () => void = () => undefined;
      const refreshGate = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      await page.route(
        "**/api/folders/*/assets?*",
        async (route) => {
          await refreshGate;
          await route.continue();
        },
        { times: 1 }
      );
      try {
        await update.focus();
        await update.press("Enter");
        await expect(
          gallery.getByRole("progressbar", {
            name: "Updating gallery",
            exact: true
          })
        ).toBeVisible();
      } finally {
        releaseRefresh();
      }
      await expect(update).toBeHidden();
      await expect(
        page
          .getByRole("region", { name: "Library controls" })
          .getByRole("button", { name: "Add media", exact: true })
      ).toBeFocused();
      const current = await libraryAssets(page, root.folderId);
      expect(current.find((asset) => asset.id === first.id)?.score).toBe(4);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        .toBe(true);
    } finally {
      await reset();
      await context.close();
    }
  });
}

test("creates folders and adds, renames, moves, restores and permanently deletes owned media", async ({
  page
}) => {
  const root = await signInAndScan(page);
  const directoryName = `Managed-${Date.now()}`;
  const originalName = `upload-${Date.now()}.png`;
  const renamedName = `renamed-${Date.now()}.png`;
  let asset: AssetRecord | undefined;
  try {
    await page
      .getByRole("button", { name: "Selected folder actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "New folder", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Create folder",
      exact: true
    });
    await create
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(directoryName);
    await create
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await operationDone(page, "create-folder", directoryName);
    const tree = (await (
      await page.request.get("/api/tree")
    ).json()) as TreeResponse;
    const folder = tree.folders.find((entry) => entry.label === directoryName)!;
    expect(folder).toBeTruthy();
    await page.goto(`/?folder=${folder.id}&view=gallery`);
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    const upload = page.getByRole("dialog", { name: "Activity", exact: true });
    await upload.getByLabel("Choose media", { exact: true }).setInputFiles({
      name: originalName,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64"
      )
    });
    await expect(
      upload.getByRole("list", { name: "Files to add" })
    ).toContainText(originalName);
    expect(
      (await (await page.request.get("/api/uploads/status")).json()).items.some(
        (item: { name: string }) => item.name === originalName
      )
    ).toBe(false);
    await closeActivity(page);
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    await expect(
      upload.getByRole("list", { name: "Files to add" })
    ).toContainText(originalName);
    await upload
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await operationDone(page, "add-media", originalName);
    await page.goto(`/?folder=${folder.id}&view=gallery&sort=filename`);
    await expect(
      page.getByRole("button", { name: `Open ${originalName}`, exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: `Open ${originalName}`, exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
    const rename = page.getByRole("dialog", {
      name: "Rename media",
      exact: true
    });
    await rename
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(renamedName.slice(0, -4));
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await operationDone(page, "rename-media", renamedName);
    asset = (await libraryAssets(page, folder.id))[0]!;
    await page
      .getByRole("button", { name: `Open ${renamedName}`, exact: true })
      .click();
    const viewer = page.getByRole("dialog", { name: renamedName, exact: true });
    await viewer
      .getByRole("button", {
        name: `More options for ${renamedName}`,
        exact: true
      })
      .click();
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
    const move = page.getByRole("dialog", { name: "Move media", exact: true });
    await move
      .getByRole("button", { name: "Back to parent folder", exact: true })
      .click();
    await move.getByRole("button", { name: "Move here", exact: true }).click();
    await operationDone(page, "move-media", renamedName);
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute("data-state", "open");
    await expect(
      viewer.getByRole("button", { name: "Next media", exact: true })
    ).toHaveCount(0);
    await viewer.hover({ position: { x: 300, y: 200 } });
    await viewer
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();
    await page.goto(
      `/?folder=${root.folderId}&view=gallery&q=${encodeURIComponent(renamedName)}`
    );
    await page
      .getByRole("button", { name: `Open ${renamedName}`, exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Move to Trash", exact: true })
      .click();
    await page
      .getByRole("alertdialog", { name: "Move to Trash?", exact: true })
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await operationDone(page, "trash", undefined, false);
    await expect(
      page.getByRole("dialog", { name: "Activity", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Open ${renamedName}`, exact: true })
    ).toHaveCount(0);
    await closeActivity(page);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: renamedName, exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: `Restore ${renamedName}`, exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Restore media", exact: true })
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await operationDone(page, "restore", renamedName);
    const restored = (await (
      await page.request.get(`/api/assets/${asset.id}`)
    ).json()) as AssetRecord;
    expect(restored.id).toBe(asset.id);
    const trashAgain = await page.request.post("/api/file-operations", {
      headers: await csrf(page),
      data: {
        requestId: crypto.randomUUID(),
        type: "trash",
        items: [
          { assetId: restored.id, expectedVersion: restored.sourceVersion }
        ]
      }
    });
    expect(trashAgain.status()).toBe(202);
    const { id } = (await trashAgain.json()) as FileOperation;
    await expect
      .poll(
        async () =>
          (
            (await (
              await page.request.get(`/api/file-operations/${id}`)
            ).json()) as FileOperation
          ).status
      )
      .toBe("completed");
    await page
      .getByRole("button", { name: "Refresh Trash", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: `Select ${renamedName}`, exact: true })
      .check();
    await page
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await page
      .getByRole("alertdialog", { name: "Delete permanently?", exact: true })
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await operationDone(page, "purge");
    expect((await page.request.get(`/api/assets/${asset.id}`)).status()).toBe(
      404
    );
  } finally {
    await rm(path.resolve(".e2e", "media", directoryName), {
      recursive: true,
      force: true
    });
    const headers = await csrf(page);
    await page.request.post("/api/admin/scan", { headers });
  }
});

test("checks retained bytes before resuming a reselected upload after reload", async ({
  page
}) => {
  test.setTimeout(120_000);
  const root = await signInAndScan(page);
  const name = `resumable-${Date.now()}.png`;
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  const bytes = Buffer.concat([
    image,
    Buffer.alloc(20 * 1024 * 1024 - image.length)
  ]);
  const changed = Buffer.from(bytes);
  changed[0] = changed[0]! ^ 1;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let secondChunk = false;
  let patchRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname.startsWith("/api/uploads/")
    )
      patchRequests += 1;
  });
  await page.route("**/api/uploads/*", async (route) => {
    const request = route.request();
    if (
      request.method() === "PATCH" &&
      Number(request.headers()["upload-offset"]) >= 16 * 1024 * 1024
    ) {
      secondChunk = true;
      await held;
      await route.abort("aborted").catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  });
  try {
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Activity", exact: true });
    await dialog
      .getByLabel("Choose media", { exact: true })
      .setInputFiles({ name, mimeType: "image/png", buffer: bytes });
    await dialog
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect.poll(() => secondChunk, { timeout: 30_000 }).toBe(true);
    await dialog.getByRole("button", { name: "Pause", exact: true }).click();
    release();
    await page.unroute("**/api/uploads/*");
    const before = (await (
      await page.request.get("/api/uploads/status")
    ).json()) as { items: Array<{ id: string; name: string; offset: number }> };
    const upload = before.items.find((item) => item.name === name)!;
    let pausedProof: { offset: number; sha256: string } | undefined;
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/uploads/${upload.id}/prefix`
        );
        if (response.ok())
          pausedProof = (await response.json()) as {
            offset: number;
            sha256: string;
          };
        return response.status();
      })
      .toBe(200);
    expect(pausedProof!.offset).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(pausedProof!.offset).toBeLessThan(bytes.length);
    await page.reload();
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Activity", exact: true });
    const row = dialog
      .getByRole("region", { name: "Uploads", exact: true })
      .locator("section")
      .filter({ hasText: name });
    const beforeMismatchPatches = patchRequests;
    await row.getByRole("button", { name: "Resume", exact: true }).click();
    await dialog
      .getByLabel(`Reselect ${name}`, { exact: true })
      .setInputFiles({ name, mimeType: "image/png", buffer: changed });
    await expect(row.getByRole("alert")).toContainText(
      "differs from the received bytes",
      { timeout: 30_000 }
    );
    const after = (await (
      await page.request.get("/api/uploads/status")
    ).json()) as { items: Array<{ id: string; offset: number }> };
    expect(after.items.find((item) => item.id === upload.id)?.offset).toBe(
      pausedProof!.offset
    );
    expect(
      await (await page.request.get(`/api/uploads/${upload.id}/prefix`)).json()
    ).toEqual(pausedProof);
    expect(patchRequests).toBe(beforeMismatchPatches);
    await row.getByRole("button", { name: "Resume", exact: true }).click();
    await dialog
      .getByLabel(`Reselect ${name}`, { exact: true })
      .setInputFiles({ name, mimeType: "image/png", buffer: bytes });
    await operationDone(page, "add-media", name);
    expect(
      (await libraryAssets(page, root.folderId)).some(
        (asset) => asset.name === name
      )
    ).toBe(true);
    const stored = await page.evaluate(() =>
      localStorage.getItem("aether.uploads.v1")
    );
    expect(stored).not.toContain(name);
  } finally {
    release();
    const headers = await csrf(page);
    const { items } = (await (
      await page.request.get("/api/uploads/status")
    ).json()) as {
      items: Array<{
        name: string;
        requestId: string;
        status: string;
        operationId?: string;
      }>;
    };
    for (const upload of items.filter((item) => item.name === name)) {
      if (upload.status === "receiving") {
        const cancelled = await page.request.post("/api/uploads/cancel", {
          headers,
          data: { requestId: upload.requestId }
        });
        expect(cancelled.ok()).toBe(true);
      } else if (
        ["validating", "publishing"].includes(upload.status) &&
        upload.operationId
      ) {
        await expect
          .poll(
            async () =>
              (
                (await (
                  await page.request.get(
                    `/api/file-operations/${upload.operationId}`
                  )
                ).json()) as FileOperation
              ).status,
            { timeout: 30_000 }
          )
          .toBe("completed");
      }
    }
    await rm(path.resolve(".e2e", "media", name), { force: true });
    await page.request.post("/api/admin/scan", { headers: await csrf(page) });
  }
});

test("reviews desktop drops before submission and rejects folder drops", async ({
  page
}, testInfo) => {
  await signInAndScan(page);
  let creations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/uploads"))
      creations += 1;
  });
  await page.evaluate(() => {
    const files = new DataTransfer();
    files.items.add(
      new File([new Uint8Array([1, 2, 3])], "review-photo.png", {
        type: "image/png"
      })
    );
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: files, cancelable: true })
    );
  });
  const activity = page.getByRole("dialog", { name: "Activity", exact: true });
  const review = activity.getByRole("list", { name: "Files to add" });
  await expect(review).toContainText("review-photo.png");
  await expect(
    activity.getByRole("button", { name: "Add files", exact: true })
  ).toBeEnabled();
  expect(creations).toBe(0);
  await activity.screenshot({
    path: testInfo.outputPath("add-media-review.png")
  });
  await activity.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("region", { name: "Library controls" })
    .getByRole("button", { name: "Add media", exact: true })
    .click();
  await expect(review).toContainText("review-photo.png");
  await activity
    .getByRole("button", { name: "Remove review-photo.png", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await page.evaluate(() => {
    const event = new Event("drop", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }]
      }
    });
    window.dispatchEvent(event);
  });
  await expect(activity.getByRole("alert")).toContainText(
    "Folder uploads are not supported."
  );
  expect(creations).toBe(0);
});

test("reviews native-picker files and changes destination in one phone sheet", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`,
    viewport: { width: 320, height: 760 },
    isMobile: true,
    hasTouch: true
  });
  try {
    const page = await context.newPage();
    await signInAndScan(page);
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    const activity = page.getByRole("dialog", {
      name: "Activity",
      exact: true
    });
    await activity.getByLabel("Choose media", { exact: true }).setInputFiles([
      {
        name: "phone-photo.png",
        mimeType: "image/png",
        buffer: Buffer.from([1, 2, 3])
      },
      {
        name: "phone-video.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from([1, 2, 3, 4])
      }
    ]);
    await expect(activity.getByRole("status")).toContainText(
      "2 files selected"
    );
    await activity.getByRole("button", { name: "Change", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      activity.getByRole("region", { name: "Destination folders", exact: true })
    ).toBeVisible();
    await activity
      .getByRole("button", { name: "Use folder", exact: true })
      .click();
    await expect(
      activity.getByRole("list", { name: "Files to add" })
    ).toContainText("phone-photo.png");
    for (const control of [
      activity.getByRole("button", { name: "Close", exact: true }),
      activity.getByRole("button", { name: "Change", exact: true }),
      activity.getByRole("button", { name: "Discard", exact: true }),
      activity.getByRole("button", { name: "Add files", exact: true })
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await activity.screenshot({
      path: testInfo.outputPath("add-media-review-phone.png")
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await activity
      .getByRole("button", { name: "Discard", exact: true })
      .click();
    await expect(
      activity.getByRole("list", { name: "Files to add" })
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("cancels an upload before its creation response and prevents late admission", async ({
  page
}) => {
  await signInAndScan(page);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let metadata: Record<string, string> | undefined;
  await page.route("**/api/uploads", async (route) => {
    if (route.request().method() === "POST") {
      metadata = route.request().headers();
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  try {
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    const activity = page.getByRole("dialog", {
      name: "Activity",
      exact: true
    });
    const name = `cancelled-${Date.now()}.png`;
    await activity.getByLabel("Choose media", { exact: true }).setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3])
    });
    await activity
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect.poll(() => Boolean(metadata)).toBe(true);
    const row = activity
      .getByRole("region", { name: "Uploads", exact: true })
      .locator("section")
      .filter({ hasText: name });
    await row.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(row).toContainText("Cancelled");
    release();
    const response = await page.request.post("/api/uploads", {
      headers: {
        ...(await csrf(page)),
        "tus-resumable": metadata!["tus-resumable"]!,
        "upload-length": metadata!["upload-length"]!,
        "upload-metadata": metadata!["upload-metadata"]!
      }
    });
    expect(response.status()).toBe(409);
  } finally {
    release();
    await page.unroute("**/api/uploads");
  }
});

test("reconciles an accepted folder creation after its response is lost and the task closes", async ({
  page
}) => {
  await signInAndScan(page);
  const name = `Lost-response-${Date.now()}`;
  let requestId: string | undefined;
  let creations = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/file-operations", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    creations += 1;
    requestId = route.request().postDataJSON().requestId as string;
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    await route.abort("failed");
  });
  await page.route("**/api/file-operations/*", async (route) => {
    if (
      route.request().method() === "GET" &&
      route.request().url().endsWith(`/${requestId}`)
    )
      await gate;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Selected folder actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "New folder", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create folder",
      exact: true
    });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "could not be confirmed"
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    release();
    await expect(
      page.getByRole("treeitem", { name: `${name}, 0 items`, exact: true })
    ).toBeVisible();
    await expect(page.getByText("Folder created", { exact: true })).toHaveCount(
      1
    );
    expect(creations).toBe(1);
  } finally {
    release();
    await page.unroute("**/api/file-operations");
    await page.unroute("**/api/file-operations/*");
    await rm(path.resolve(".e2e", "media", name), {
      recursive: true,
      force: true
    });
    await page.request.post("/api/admin/scan", { headers: await csrf(page) });
  }
});
