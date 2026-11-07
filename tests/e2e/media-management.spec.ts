import { chooseAccountAction } from "./account-menu";
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
async function returnToLibrary(page: Page) {
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  if (await activity.isVisible()) {
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(activity).toBeHidden();
  }
}
async function openActivity(page: Page) {
  await chooseAccountAction(page, "Activity");
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  return activity;
}
async function operationDone(
  page: Page,
  type: FileOperation["type"],
  name?: string,
  returnToGallery = true
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
                  (item.asset?.name ?? item.name) === name ||
                  (item.folder?.label ?? item.folder?.name) === name
              ))
        );
        return result?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
  if (returnToGallery) await returnToLibrary(page);
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
          .getByRole("region", { name: "Library results" })
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
        .getByRole("region", { name: "Library results" })
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
          .getByRole("button", { name: /^View options/ })
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
    const upload = page.locator(".add-media-page");
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
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(upload).toBeHidden();
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
    await expect(upload).toBeHidden();
    await operationDone(page, "add-media", originalName, false);
    const activity = page.getByRole("region", {
      name: "Activity",
      exact: true
    });
    await expect(page).toHaveURL(/\bpage=activity\b/);
    await expect(
      activity.getByRole("region", {
        name: `Upload ${originalName}`,
        exact: true
      })
    ).toContainText("Completed");
    await expect(activity.getByText(originalName, { exact: true })).toHaveCount(
      1
    );
    await returnToLibrary(page);
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
      page.getByRole("region", { name: "Activity", exact: true })
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Open ${renamedName}`, exact: true })
    ).toHaveCount(0);
    await returnToLibrary(page);
    await chooseAccountAction(page, "Trash");
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
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Open ${renamedName}`, exact: true })
    ).toBeVisible();
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
    await chooseAccountAction(page, "Trash");
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
  let finishHeldPatch: () => void = () => undefined;
  const heldPatchFinished = new Promise<void>((resolve) => {
    finishHeldPatch = resolve;
  });
  let secondChunk = false;
  let patchRequests = 0;
  let admissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/uploads"
    )
      admissions += 1;
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
      finishHeldPatch();
      return;
    }
    await route.continue().catch(() => undefined);
  });
  try {
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    const addMedia = page.locator(".add-media-page");
    await addMedia
      .getByLabel("Choose media", { exact: true })
      .setInputFiles({ name, mimeType: "image/png", buffer: bytes });
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect(addMedia).toBeHidden();
    let activity = page.getByRole("region", {
      name: "Activity",
      exact: true
    });
    await expect.poll(() => secondChunk, { timeout: 30_000 }).toBe(true);
    await chooseAccountAction(page, "Settings");
    await expect(activity).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Settings", exact: true })
    ).toBeVisible();
    activity = await openActivity(page);
    await expect(activity).toContainText(name);
    expect(admissions).toBe(1);
    await activity.getByRole("button", { name: "Pause", exact: true }).click();
    release();
    await heldPatchFinished;
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
    activity = await openActivity(page);
    const row = activity.getByRole("region", {
      name: `Upload ${name}`,
      exact: true
    });
    const beforeMismatchPatches = patchRequests;
    await row.getByRole("button", { name: "Resume", exact: true }).click();
    await activity
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
    await activity
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
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  });
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
  const addMedia = page.locator(".add-media-page");
  const review = addMedia.getByRole("list", { name: "Files to add" });
  await expect(review).toContainText("review-photo.png");
  await expect(
    addMedia.getByRole("button", { name: "Add files", exact: true })
  ).toBeEnabled();
  expect(creations).toBe(0);
  await addMedia.screenshot({
    path: testInfo.outputPath("add-media-review.png")
  });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("region", { name: "Library controls" })
    .getByRole("button", { name: "Add media", exact: true })
    .click();
  await expect(review).toContainText("review-photo.png");
  await addMedia
    .getByRole("button", { name: "Remove review-photo.png", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  const dropzone = addMedia.locator(".add-media-choose");
  await dropzone.evaluate((element) => {
    const files = new DataTransfer();
    files.items.add(
      new File([new Uint8Array([1, 2, 3])], "local-drop.png", {
        type: "image/png"
      })
    );
    element.dispatchEvent(
      new DragEvent("dragover", {
        dataTransfer: files,
        bubbles: true,
        cancelable: true
      })
    );
  });
  await expect(dropzone).toHaveAttribute("data-dragging", "true");
  await dropzone.evaluate((element) => {
    const files = new DataTransfer();
    files.items.add(
      new File([new Uint8Array([1, 2, 3])], "local-drop.png", {
        type: "image/png"
      })
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: files,
        bubbles: true,
        cancelable: true
      })
    );
  });
  await expect(review.getByRole("listitem")).toHaveCount(1);
  await expect(review).toContainText("local-drop.png");
  await expect(dropzone).not.toHaveAttribute("data-dragging", "true");
  await addMedia
    .getByRole("button", { name: "Remove local-drop.png", exact: true })
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
  await expect(addMedia.getByRole("alert")).toContainText(
    "Folder uploads are not supported."
  );
  expect(creations).toBe(0);
});

test("abandons a pending upload name check when leaving Add media", async ({
  page
}) => {
  await signInAndScan(page);
  const name = `navigation-draft-${Date.now()}.png`;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let previewReady = false;
  let previewReleased = false;
  let previews = 0;
  let admissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/uploads"))
      admissions += 1;
  });
  const previewUrl = "**/api/file-operations/preview";
  await page.route(previewUrl, async (route) => {
    previews += 1;
    if (previews > 1) {
      await route.fulfill({
        status: 500,
        json: { error: "temporary_failure" }
      });
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    previewReady = true;
    await held;
    await route.fulfill({ response }).catch(() => undefined);
    previewReleased = true;
  });
  try {
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    const addMedia = page.locator(".add-media-page");
    await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3])
    });
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect.poll(() => previewReady).toBe(true);
    await expect(
      addMedia.getByRole("button", { name: "Cancel", exact: true })
    ).toBeEnabled();
    await expect(
      addMedia.getByRole("button", { name: "Choose more files", exact: true })
    ).toBeDisabled();
    await chooseAccountAction(page, "Settings");
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true
    });
    await expect(settings).toBeVisible();
    await expect(addMedia).toBeHidden();
    release();
    await expect.poll(() => previewReleased).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    await expect(settings).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Activity", exact: true })
    ).toBeHidden();
    expect(admissions).toBe(0);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    await expect(
      addMedia.getByRole("list", { name: "Files to add" })
    ).toContainText(name);
    const addFiles = addMedia.getByRole("button", {
      name: "Add files",
      exact: true
    });
    await expect(addFiles).toBeEnabled();
    await addFiles.click();
    await expect.poll(() => previews).toBe(2);
    await expect(addMedia.getByRole("alert")).toBeVisible();
    await expect(
      addMedia.getByRole("list", { name: "Files to add" })
    ).toContainText(name);
    expect(admissions).toBe(0);
  } finally {
    release();
    await page.unroute(previewUrl);
  }
});

test("cancels a pending upload name check without admitting a late result", async ({
  page
}) => {
  await signInAndScan(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let previewReady = false;
  let previewReleased = false;
  let admissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/uploads"))
      admissions += 1;
  });
  const previewUrl = "**/api/file-operations/preview";
  await page.route(previewUrl, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    previewReady = true;
    await held;
    await route.fulfill({ response }).catch(() => undefined);
    previewReleased = true;
  });
  try {
    const addButton = page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true });
    await addButton.click();
    const addMedia = page.locator(".add-media-page");
    await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
      name: `cancelled-draft-${Date.now()}.png`,
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3])
    });
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect.poll(() => previewReady).toBe(true);
    const cancel = addMedia.getByRole("button", {
      name: "Cancel",
      exact: true
    });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(addMedia).toBeHidden();
    await expect(addButton).toBeFocused();
    release();
    await expect.poll(() => previewReleased).toBe(true);
    await expect(
      page.getByRole("region", { name: "Activity", exact: true })
    ).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Gallery view", exact: true })
    ).toBeVisible();
    await addButton.click();
    await expect(
      addMedia.getByRole("list", { name: "Files to add" })
    ).toHaveCount(0);
    await expect(
      addMedia.getByRole("button", { name: "Add files", exact: true })
    ).toBeDisabled();
    expect(admissions).toBe(0);
  } finally {
    release();
    await page.unroute(previewUrl);
  }
});

test("initializes the upload destination after an early file selection while the tree loads", async ({
  page
}) => {
  const root = await signInAndScan(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let treeRequested = false;
  let admissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/uploads"))
      admissions += 1;
  });
  await page.route("**/api/tree", async (route) => {
    treeRequested = true;
    await held;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto(`/?folder=${root.folderId}&page=add-media&view=gallery`);
    const addMedia = page.locator(".add-media-page");
    await expect(addMedia).toBeVisible();
    await expect.poll(() => treeRequested).toBe(true);
    await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
      name: "early-selection.png",
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3])
    });
    await expect(
      addMedia.getByRole("list", { name: "Files to add" })
    ).toContainText("early-selection.png");
    const addFiles = addMedia.getByRole("button", {
      name: "Add files",
      exact: true
    });
    await expect(addFiles).toBeDisabled();
    release();
    await expect(addMedia.locator(".add-media-destination")).toContainText(
      root.label
    );
    await expect(addFiles).toBeEnabled();
    expect(admissions).toBe(0);
  } finally {
    release();
    await page.unroute("**/api/tree");
  }
});

for (const layout of ["desktop", "phone", "landscape"] as const) {
  const compact = layout !== "desktop";
  test(`keeps Add media focused and cancellation explicit on ${layout}`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport:
        layout === "phone"
          ? { width: 320, height: 760 }
          : layout === "landscape"
            ? { width: 812, height: 375 }
            : { width: 1440, height: 980 },
      isMobile: compact,
      hasTouch: compact
    });
    try {
      await context.addInitScript(() => {
        Object.defineProperty(crypto, "randomUUID", { value: undefined });
      });
      const page = await context.newPage();
      await signInAndScan(page);
      const errors: string[] = [];
      let submissions = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          ["/api/uploads", "/api/file-operations/preview"].includes(
            new URL(request.url()).pathname
          )
        )
          submissions += 1;
      });
      const activity = await openActivity(page);
      await expect(
        activity.getByLabel("Choose media", { exact: true })
      ).toHaveCount(0);
      await expect(
        activity.getByRole("heading", { name: "Add media", exact: true })
      ).toHaveCount(0);
      await returnToLibrary(page);
      const addButton = page
        .getByRole("region", { name: "Library controls" })
        .getByRole("button", { name: "Add media", exact: true });
      await expect(addButton).toBeEnabled();
      await addButton.click();
      const addMedia = page.locator(".add-media-page");
      await expect(addMedia).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const heading = addMedia.getByRole("heading", {
        name: "Add media",
        exact: true,
        level: 1
      });
      await expect(heading).toBeFocused();
      await expect(heading).toHaveClass(/sr-only/);
      const headingBounds = (await heading.boundingBox())!;
      expect(headingBounds.width).toBeLessThanOrEqual(1);
      expect(headingBounds.height).toBeLessThanOrEqual(1);
      await expect(
        addMedia.getByRole("button", { name: "Back to library", exact: true })
      ).toHaveCount(0);
      await expect(
        addMedia.getByRole("button", { name: "Discard", exact: true })
      ).toHaveCount(0);
      await expect(
        addMedia.getByRole("region", { name: "Uploads", exact: true })
      ).toHaveCount(0);
      const footer = addMedia.locator(".add-media-footer");
      const cancel = footer.getByRole("button", {
        name: "Cancel",
        exact: true
      });
      const addFiles = footer.getByRole("button", {
        name: "Add files",
        exact: true
      });
      await expect(cancel).toBeEnabled();
      await expect(addFiles).toBeDisabled();
      await expect(
        addMedia.getByRole("button", {
          name: "Choose files or drop photos and videos",
          exact: true
        })
      ).toBeInViewport();
      await addMedia.screenshot({
        path: testInfo.outputPath(`add-media-empty-${layout}.png`)
      });
      await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles([
        {
          name: "review-photo.png",
          mimeType: "image/png",
          buffer: Buffer.from([1, 2, 3])
        },
        {
          name: "review-video.mp4",
          mimeType: "video/mp4",
          buffer: Buffer.from([1, 2, 3, 4])
        },
        ...Array.from({ length: 38 }, (_, index) => ({
          name: `review-${String(index + 1).padStart(2, "0")}.png`,
          mimeType: "image/png",
          buffer: Buffer.from([1, 2, 3])
        }))
      ]);
      await expect(addMedia.getByRole("status")).toContainText(
        "40 files selected"
      );
      await expect(
        addMedia.getByRole("button", { name: "Choose more files", exact: true })
      ).toBeVisible();
      if (compact) {
        for (const control of [
          addMedia.getByRole("button", {
            name: "Choose more files",
            exact: true
          }),
          addMedia.getByRole("button", { name: "Change", exact: true }),
          addMedia.getByRole("button", {
            name: "Remove review-photo.png",
            exact: true
          })
        ]) {
          await control.scrollIntoViewIfNeeded();
          await expect(control).toBeInViewport();
          const bounds = (await control.boundingBox())!;
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
      }
      await addMedia
        .getByRole("button", { name: "Change", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        addMedia.getByRole("region", {
          name: "Destination folders",
          exact: true
        })
      ).toBeVisible();
      await footer.getByRole("button", { name: "Cancel", exact: true }).click();
      const review = addMedia.getByRole("list", { name: "Files to add" });
      await expect(review.getByRole("listitem")).toHaveCount(40);
      await addMedia
        .getByRole("button", { name: "Change", exact: true })
        .click();
      await footer
        .getByRole("button", { name: "Use folder", exact: true })
        .click();
      await expect(review).toContainText("review-photo.png");
      await expect(review.getByRole("listitem")).toHaveCount(40);
      await expect(addFiles).toBeEnabled();
      const cancelBefore = (await cancel.boundingBox())!;
      const addBefore = (await addFiles.boundingBox())!;
      expect(cancelBefore.x + cancelBefore.width).toBeLessThanOrEqual(
        addBefore.x
      );
      expect(Math.abs(cancelBefore.y - addBefore.y)).toBeLessThanOrEqual(1);
      await addMedia.screenshot({
        path: testInfo.outputPath(`add-media-selected-${layout}.png`)
      });
      const body = addMedia.locator(".add-media-body");
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expect(review.getByRole("listitem").last()).toBeInViewport();
      expect(await cancel.boundingBox()).toEqual(cancelBefore);
      expect(await addFiles.boundingBox()).toEqual(addBefore);
      for (const control of [cancel, addFiles]) {
        await expect(control).toBeInViewport();
        expect(
          await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const target = document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2
            );
            return target === element || element.contains(target);
          })
        ).toBe(true);
        if (compact) {
          const bounds = (await control.boundingBox())!;
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
      }
      await addMedia.screenshot({
        path: testInfo.outputPath(`add-media-review-${layout}.png`)
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      // Navigation preserves a draft; Cancel explicitly discards it.
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(addMedia).toBeHidden();
      await addButton.click();
      await expect(review.getByRole("listitem")).toHaveCount(40);
      await cancel.click();
      await expect(addMedia).toBeHidden();
      await expect(addButton).toBeFocused();
      await expect(page).toHaveURL(/page=library/);
      await addButton.click();
      await expect(review).toHaveCount(0);
      await expect(addFiles).toBeDisabled();
      await cancel.click();
      await expect(addButton).toBeFocused();
      await page.reload();
      await expect(
        page.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/page=add-media/);
      await expect(addMedia).toBeVisible();
      await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
        name: "history-draft.png",
        mimeType: "image/png",
        buffer: Buffer.from([1, 2, 3])
      });
      await expect(review).toContainText("history-draft.png");
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await addButton.click();
      await expect(review).toContainText("history-draft.png");
      await cancel.click();
      await addButton.click();
      await expect(review).toHaveCount(0);
      expect(submissions).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

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
    const addMedia = page.locator(".add-media-page");
    const name = `cancelled-${Date.now()}.png`;
    await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3])
    });
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect.poll(() => Boolean(metadata)).toBe(true);
    await expect(addMedia).toBeHidden();
    const activity = page.getByRole("region", {
      name: "Activity",
      exact: true
    });
    const row = activity.getByRole("region", {
      name: `Upload ${name}`,
      exact: true
    });
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

for (const layout of ["desktop", "phone", "landscape"] as const) {
  const phone = layout !== "desktop";
  test(`keeps batch tag intent explicit and file actions unavailable for read-only media on ${layout}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      ...(phone
        ? {
            viewport:
              layout === "landscape"
                ? { width: 812, height: 375 }
                : { width: 320, height: 760 },
            isMobile: true,
            hasTouch: true
          }
        : { viewport: { width: 1440, height: 980 } })
    });
    const page = await context.newPage();
    let original: AssetRecord | undefined;
    try {
      const root = await signInAndScan(page);
      original = (await libraryAssets(page, root.folderId)).find(
        (asset) => asset.name === "family-photo.png"
      )!;
      const tree = (await (
        await page.request.get("/api/tree")
      ).json()) as TreeResponse;
      await page.route("**/api/tree", (route) =>
        route.fulfill({
          json: {
            ...tree,
            roots: tree.roots.map((entry) => ({ ...entry, writable: false })),
            folders: tree.folders.map((entry) => ({
              ...entry,
              writable: false
            }))
          }
        })
      );
      await page.goto(
        `/?folder=${root.folderId}&view=gallery&q=family-photo.png`
      );
      await page
        .getByRole("button", { name: "Select media", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Select family-photo.png", exact: true })
        .click();
      const actions = page.getByRole("region", {
        name: "Selected media actions",
        exact: true
      });
      await expect(
        actions.getByRole("button", { name: "Move to…", exact: true })
      ).toBeDisabled();
      await expect(
        actions.getByRole("button", { name: "Move to Trash", exact: true })
      ).toBeDisabled();
      await expect(actions).toContainText(
        "File changes are unavailable for this selection."
      );
      await actions
        .getByRole("button", { name: "Selection options", exact: true })
        .click();
      await expect(
        page.getByRole("menuitem", { name: "Rename…", exact: true })
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await actions
        .getByRole("button", { name: "Edit details", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Edit details",
        exact: true
      });
      const score = editor.getByRole("textbox", { name: "Score", exact: true });
      await score.fill(String(original.score));
      await expect(
        editor.getByRole("button", { name: "Apply", exact: true })
      ).toBeDisabled();
      await score.fill(String(original.score + 1));
      await editor.getByRole("tab", { name: "Tags", exact: true }).click();
      const input = editor.getByRole("textbox", {
        name: "Tag name",
        exact: true
      });
      await input.fill("First batch draft");
      await input.press("Enter");
      await expect(
        editor.getByRole("list", { name: "Tags to apply", exact: true })
      ).toContainText("First batch draft");
      await input.fill("Second batch draft");
      const pending = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith("/api/assets/batch/tags")
      );
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      expect((await pending).postDataJSON()).toEqual({
        assetIds: [original.id],
        tags: ["First batch draft", "Second batch draft"],
        mode: "add"
      });
      await expect(input).toHaveValue("");
      await expect(
        editor.getByRole("button", { name: "Apply", exact: true })
      ).toBeDisabled();
      await editor.getByRole("tab", { name: "Score", exact: true }).click();
      await expect(score).toHaveValue(String(original.score + 1));
      await editor.getByRole("tab", { name: "Tags", exact: true }).click();
      await editor
        .getByRole("radio", { name: "Replace existing", exact: true })
        .check();
      await expect(editor).toContainText(
        "Replaces all existing tags on 1 selected item."
      );
      await editor
        .getByRole("radio", { name: "Clear all tags", exact: true })
        .check();
      let clearRequests = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().endsWith("/api/assets/batch/tags")
        )
          clearRequests += 1;
      });
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      const confirmation = page.getByRole("alertdialog", {
        name: "Clear all tags?",
        exact: true
      });
      await expect(confirmation).toBeVisible();
      expect(clearRequests).toBe(0);
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await editor
        .getByRole("radio", { name: "Add to existing", exact: true })
        .check();
      for (let index = 0; index < 50; index += 1) {
        await input.fill(`Review tag ${index + 1}`);
        await input.press("Enter");
      }
      await expect(input).toBeFocused();
      await expect
        .poll(() =>
          input.evaluate((field) => {
            const bounds = field.getBoundingClientRect();
            const body = field
              .closest(".batch-details-body")!
              .getBoundingClientRect();
            return bounds.top >= body.top && bounds.bottom <= body.bottom + 1;
          })
        )
        .toBe(true);
      await input.fill("One more tag");
      await expect(editor.getByRole("alert")).toContainText("up to 50 tags");
      await expect(
        editor.getByRole("button", { name: "Apply", exact: true })
      ).toBeDisabled();
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        actions.getByRole("button", { name: "Edit details", exact: true })
      ).toBeFocused();
      await actions.getByRole("button", { name: "Done", exact: true }).click();
      const card = page.locator(`[data-asset-id="${original.id}"]`);
      if (!phone) await card.hover();
      await expect(
        card.getByRole("button", {
          name: "More options for family-photo.png",
          exact: true
        })
      ).toHaveCount(0);
      const open = card.getByRole("button", {
        name: "Open family-photo.png",
        exact: true
      });
      await open.focus();
      await open.press("Shift+F10");
      await expect(
        page.getByRole("menuitem", { name: "Info", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Rename…", exact: true })
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
      await open.press("Shift+F10");
      await page.getByRole("menuitem", { name: "Info", exact: true }).click();
      const info = page.getByRole("dialog", {
        name: "family-photo.png",
        exact: true
      });
      await expect(
        info.getByRole("textbox", { name: "Add a tag", exact: true })
      ).toBeEnabled();
      if (phone) {
        const removeTag = info.getByRole("button", {
          name: "Remove First batch draft",
          exact: true
        });
        for (const control of [
          info.getByRole("textbox", { name: "Add a tag", exact: true }),
          info.getByRole("button", { name: "Add tag", exact: true }),
          removeTag
        ]) {
          const bounds = await control.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
        }
        await removeTag.scrollIntoViewIfNeeded();
        expect(
          await removeTag.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            return (
              document
                .elementFromPoint(
                  bounds.left + bounds.width / 2,
                  bounds.top + bounds.height / 2
                )
                ?.closest("button") === button
            );
          })
        ).toBe(true);
      }
      await info.getByRole("button", { name: "Close", exact: true }).click();
      await expect(info).toBeHidden();
      await expect(open).toBeFocused();
      await open.press("Shift+F10");
      await page
        .getByRole("menuitem", { name: "Edit media", exact: true })
        .click();
      const presentation = page.getByRole("dialog", {
        name: "Edit media",
        exact: true
      });
      await presentation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(presentation).toBeHidden();
      await expect(open).toBeFocused();
    } finally {
      if (original)
        await page.request.put(`/api/assets/${original.id}/tags`, {
          headers: await csrf(page),
          data: { tags: original.tags.map((tag) => tag.displayName) }
        });
      await context.close();
    }
  });
}

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
