import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  AssetRecord,
  FileOperation,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";
import { chooseAccountAction } from "./account-menu";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNwSesAAAIkATMgan5NAAAAAElFTkSuQmCC",
  "base64"
);

async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
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
    page.getByRole("region", { name: "Gallery view", exact: true })
  ).toBeVisible();
  await scan(page);
  return (await (await page.request.get("/api/tree")).json()) as TreeResponse;
}

async function records(page: Page, folderId: string, sort = "filename") {
  const response = await page.request.get(
    `/api/folders/${folderId}/assets?limit=100&recursive=true&sort=${sort}&order=asc`
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as AssetListResponse).items;
}

async function operationCompleted(page: Page, operation: FileOperation) {
  await expect
    .poll(
      async () => {
        const result = (await (
          await page.request.get(`/api/file-operations/${operation.id}`)
        ).json()) as FileOperation;
        return result.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
}

async function submitOperation(page: Page, submit: Locator) {
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/file-operations") &&
      response.request().method() === "POST"
  );
  await submit.click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const operation = (await response.json()) as FileOperation;
  await operationCompleted(page, operation);
  return operation;
}

async function addMedia(page: Page, name: string) {
  await page
    .getByRole("region", { name: "Library controls", exact: true })
    .getByRole("button", { name: "Add media", exact: true })
    .click();
  const add = page.locator(".add-media-page");
  await add.getByLabel("Choose media", { exact: true }).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: png
  });
  await add.getByRole("button", { name: "Add files", exact: true }).click();
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  await expect(
    activity.getByRole("region", { name: `Upload ${name}`, exact: true })
  ).toContainText("Completed", { timeout: 30_000 });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(activity).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Gallery view", exact: true })
  ).toBeVisible();
}

async function editMenu(page: Page, name: string, action: string) {
  await page
    .getByRole("button", { name: `Open ${name}`, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function showScoreControls(page: Page) {
  await page.getByRole("button", { name: /^View options/ }).click();
  const options = page.getByRole("dialog", {
    name: "View options",
    exact: true
  });
  await options.getByRole("tab", { name: "Layout", exact: true }).click();
  const score = options.getByRole("checkbox", { name: "Score", exact: true });
  if (!(await score.isChecked())) await score.check();
  await page.keyboard.press("Escape");
}

async function visibleAnchor(page: Page) {
  return page.locator(".gallery-viewport").evaluate((viewport) => {
    const bounds = viewport.getBoundingClientRect();
    const visible = [
      ...viewport.querySelectorAll<HTMLElement>("[data-asset-id]")
    ].filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom;
    });
    const anchor = visible[0]!;
    return {
      id: anchor.dataset.assetId!,
      offset: anchor.getBoundingClientRect().top - bounds.top,
      scrollTop: viewport.scrollTop,
      actionableIds: visible
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
        })
        .map((card) => card.dataset.assetId!)
    };
  });
}

async function expectStableDepth(
  page: Page,
  anchor: { id: string; offset: number }
) {
  const gallery = page.locator(".gallery-viewport");
  await expect(gallery).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(async () => {
      const current = await gallery
        .locator(`[data-asset-id="${anchor.id}"]`)
        .evaluate((card) => {
          const viewport = card.closest(".gallery-viewport")!;
          return (
            card.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top
          );
        });
      // Virtual rows remeasure on remount; allow a small measurement adjustment
      // while requiring the same card to remain at the visible scroll anchor.
      return Math.abs(current - anchor.offset);
    })
    .toBeLessThanOrEqual(8);
  await expect(gallery.locator(".load-more-row")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Update results", exact: true })
  ).toHaveCount(0);
  const ids = await gallery
    .locator("[data-asset-id]")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-asset-id"))
    );
  expect(new Set(ids).size).toBe(ids.length);
}

test("automatically reconciles managed files while retaining a deep gallery and its visible anchor", async ({
  browser
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL: productionBaseURL });
  const page = await context.newPage();
  const fixtureName = `Managed-depth-${randomUUID()}`;
  const fixture = path.resolve(".e2e", "media", fixtureName);
  try {
    await mkdir(path.join(fixture, "Gallery"), { recursive: true });
    await mkdir(path.join(fixture, "Destination"));
    await Promise.all(
      Array.from({ length: 85 }, (_, index) =>
        writeFile(
          path.join(
            fixture,
            "Gallery",
            `depth-${String(index).padStart(4, "0")}.png`
          ),
          png
        )
      )
    );
    const tree = await signInAndScan(page);
    const folder = tree.folders.find(
      (entry) => entry.relativePath === `${fixtureName}/Gallery`
    )!;
    // The fixture disables watching, so this checks that managed commits do not
    // depend on a scan. Production watchers can separately observe file events.
    const jobsBefore = (await (
      await page.request.get("/api/admin/jobs")
    ).json()) as { jobs: ScanJob[] };
    await page.goto(
      `/?folder=${folder.id}&view=gallery&sort=filename&order=asc&size=small`
    );
    const gallery = page.locator(".gallery-viewport");
    await expect(gallery).toHaveAttribute("aria-busy", "false");
    await gallery.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(gallery.locator(".load-more-row")).toHaveCount(0);
    await gallery.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });
    await expect
      .poll(async () => (await visibleAnchor(page)).scrollTop)
      .toBeGreaterThan(300);
    const anchor = await visibleAnchor(page);

    await addMedia(page, "depth-0000-added.png");
    await expectStableDepth(page, anchor);
    const restoredScrollTop = await gallery.evaluate(
      (element) => element.scrollTop
    );
    await gallery.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(
      page.getByRole("button", {
        name: "Open depth-0000-added.png",
        exact: true
      })
    ).toBeVisible();
    await gallery.evaluate((element, scrollTop) => {
      element.scrollTop = scrollTop;
    }, restoredScrollTop);
    await expectStableDepth(page, anchor);
    const afterUpload = await records(page, folder.id);
    expect(afterUpload).toHaveLength(86);
    expect(
      afterUpload.some((asset) => asset.name === "depth-0000-added.png")
    ).toBe(true);

    let visible = await visibleAnchor(page);
    let assets = await records(page, folder.id);
    const renamed = assets.find(
      (asset) =>
        asset.id === visible.actionableIds.find((id) => id !== anchor.id)
    )!;
    const renamedName = renamed.name.replace(".png", "-renamed.png");
    await editMenu(page, renamed.name, "Rename…");
    const rename = page.getByRole("dialog", {
      name: "Rename media",
      exact: true
    });
    await rename
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(renamedName.slice(0, -4));
    await submitOperation(
      page,
      rename.getByRole("button", { name: "Rename", exact: true })
    );
    await expect(rename).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Open ${renamedName}`, exact: true })
    ).toBeVisible();
    await expectStableDepth(page, anchor);

    visible = await visibleAnchor(page);
    assets = await records(page, folder.id);
    const trashed = assets.find(
      (asset) =>
        asset.id === visible.actionableIds.find((id) => id !== anchor.id)
    )!;
    await editMenu(page, trashed.name, "Move to Trash");
    const confirmation = page.getByRole("alertdialog", {
      name: "Move to Trash?",
      exact: true
    });
    await submitOperation(
      page,
      confirmation.getByRole("button", { name: "Move to Trash", exact: true })
    );
    await expect(page.locator(`[data-asset-id="${trashed.id}"]`)).toHaveCount(
      0
    );
    await expectStableDepth(page, anchor);

    await chooseAccountAction(page, "Trash");
    await page
      .getByRole("button", { name: `Restore ${trashed.name}`, exact: true })
      .click();
    const restore = page.getByRole("dialog", {
      name: "Restore media",
      exact: true
    });
    await submitOperation(
      page,
      restore.getByRole("button", { name: "Restore", exact: true })
    );
    await expect(restore).toBeHidden();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(page.locator(`[data-asset-id="${trashed.id}"]`)).toBeVisible();
    await expectStableDepth(page, anchor);

    visible = await visibleAnchor(page);
    assets = await records(page, folder.id);
    const moved = assets.find(
      (asset) =>
        asset.id === visible.actionableIds.find((id) => id !== anchor.id)
    )!;
    await editMenu(page, moved.name, "Move to…");
    const move = page.getByRole("dialog", { name: "Move media", exact: true });
    await move
      .getByRole("button", { name: "Back to parent folder", exact: true })
      .click();
    await move
      .getByRole("button", { name: "Open Destination", exact: true })
      .click();
    await submitOperation(
      page,
      move.getByRole("button", { name: "Move here", exact: true })
    );
    await expect(page.locator(`[data-asset-id="${moved.id}"]`)).toHaveCount(0);
    await expectStableDepth(page, anchor);
    const jobsAfter = (await (
      await page.request.get("/api/admin/jobs")
    ).json()) as { jobs: ScanJob[] };
    expect(jobsAfter.jobs.map((job) => job.id)).toEqual(
      jobsBefore.jobs.map((job) => job.id)
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
    if (!page.isClosed()) await scan(page);
    await context.close();
  }
});

for (const phone of [false, true]) {
  test(`keeps pending score order through an upload and offers one toolbar update on ${phone ? "phone" : "desktop"}`, async ({
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
    const fixtureName = `Managed-score-${randomUUID()}`;
    const fixture = path.resolve(".e2e", "media", fixtureName);
    try {
      await mkdir(fixture);
      await Promise.all(
        ["score-a.png", "score-b.png", "score-c.png"].map((name) =>
          writeFile(path.join(fixture, name), png)
        )
      );
      const tree = await signInAndScan(page);
      const folder = tree.folders.find(
        (entry) => entry.relativePath === fixtureName
      )!;
      const initial = await records(page, folder.id);
      for (const [index, asset] of initial.entries()) {
        const response = await page.request.patch(
          `/api/assets/${asset.id}/score`,
          {
            headers: await csrf(page),
            data: { score: index + 1 }
          }
        );
        expect(response.ok()).toBe(true);
      }
      await page.goto(
        `/?folder=${folder.id}&view=gallery&sort=score&order=asc&size=small`
      );
      await showScoreControls(page);
      const gallery = page.locator(".gallery-viewport");
      const originalIds = initial.map((asset) => asset.id);
      const order = () =>
        gallery
          .locator("[data-asset-id]")
          .evaluateAll((cards) =>
            cards.map((card) => card.getAttribute("data-asset-id"))
          );
      await expect.poll(order).toEqual(originalIds);
      const increase = gallery.getByRole("button", {
        name: /^Increase score for score-a.png/
      });
      for (let current = 2; current <= 5; current++) {
        await increase.click();
        await expect(increase).toHaveAccessibleName(
          new RegExp(`Current score: ${current}$`)
        );
        await expect(increase).toBeEnabled();
      }
      const update = page
        .getByRole("region", { name: "Library results", exact: true })
        .getByRole("button", { name: "Update results", exact: true });
      await expect(update).toBeEnabled();
      expect(await order()).toEqual(originalIds);

      const uploadName = `score-added-${phone ? "phone" : "desktop"}.png`;
      await addMedia(page, uploadName);
      await expect(
        gallery.getByRole("button", { name: `Open ${uploadName}`, exact: true })
      ).toBeVisible();
      await expect(increase).toHaveAccessibleName(/Current score: 5$/);
      expect((await order()).filter((id) => originalIds.includes(id!))).toEqual(
        originalIds
      );
      await expect(update).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Update results", exact: true })
      ).toHaveCount(1);
      await expect(
        gallery.getByRole("button", { name: "Update results", exact: true })
      ).toHaveCount(0);
      for (const close of await page
        .getByRole("button", { name: "Close toast", exact: true })
        .all())
        await close.click();
      await page.screenshot({
        path: testInfo.outputPath("pending-results.png"),
        animations: "disabled"
      });
      const authoritativeOrder = (await records(page, folder.id, "score")).map(
        (asset) => asset.id
      );
      expect(
        authoritativeOrder.filter((id) => originalIds.includes(id))
      ).not.toEqual(originalIds);
      await update.click();
      await expect(update).toBeHidden();
      await expect.poll(order).toEqual(authoritativeOrder);
      const saved = (await (
        await page.request.get(`/api/assets/${initial[0]!.id}`)
      ).json()) as AssetRecord;
      expect(saved.score).toBe(5);
    } finally {
      await rm(fixture, { recursive: true, force: true });
      if (!page.isClosed()) await scan(page);
      await context.close();
    }
  });
}

test("removes a managed rename outside the search while a score order is pending", async ({
  browser
}) => {
  const context = await browser.newContext({ baseURL: productionBaseURL });
  const page = await context.newPage();
  const fixtureName = `Managed-search-${randomUUID()}`;
  const fixture = path.resolve(".e2e", "media", fixtureName);
  try {
    await mkdir(fixture);
    await Promise.all(
      ["score-a.png", "score-b.png", "score-c.png"].map((name) =>
        writeFile(path.join(fixture, name), png)
      )
    );
    const tree = await signInAndScan(page);
    const folder = tree.folders.find(
      (entry) => entry.relativePath === fixtureName
    )!;
    const initial = await records(page, folder.id);
    for (const [index, asset] of initial.entries()) {
      const response = await page.request.patch(
        `/api/assets/${asset.id}/score`,
        {
          headers: await csrf(page),
          data: { score: index + 1 }
        }
      );
      expect(response.ok()).toBe(true);
    }
    await page.goto(
      `/?folder=${folder.id}&view=gallery&sort=score&order=asc&q=score&size=small`
    );
    await showScoreControls(page);
    const gallery = page.locator(".gallery-viewport");
    const increase = gallery.getByRole("button", {
      name: /^Increase score for score-a.png/
    });
    await increase.click();
    await expect(increase).toHaveAccessibleName(/Current score: 2$/);
    await expect(increase).toBeEnabled();
    const update = page
      .getByRole("region", { name: "Library results", exact: true })
      .getByRole("button", { name: "Update results", exact: true });
    await expect(update).toBeEnabled();
    await editMenu(page, "score-a.png", "Rename…");
    const rename = page.getByRole("dialog", {
      name: "Rename media",
      exact: true
    });
    await rename
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("renamed");
    await submitOperation(
      page,
      rename.getByRole("button", { name: "Rename", exact: true })
    );
    await expect(rename).toBeHidden();
    await expect(
      gallery.locator(`[data-asset-id="${initial[0]!.id}"]`)
    ).toHaveCount(0);
    await expect
      .poll(() =>
        gallery
          .locator("[data-asset-id]")
          .evaluateAll((cards) =>
            cards.map((card) => card.getAttribute("data-asset-id"))
          )
      )
      .toEqual(initial.slice(1).map((asset) => asset.id));
    await expect(update).toBeEnabled();
    const saved = (await (
      await page.request.get(`/api/assets/${initial[0]!.id}`)
    ).json()) as AssetRecord;
    expect(saved).toMatchObject({ name: "renamed.png", score: 2 });
    expect(new URL(page.url()).searchParams.get("q")).toBe("score");
  } finally {
    await rm(fixture, { recursive: true, force: true });
    if (!page.isClosed()) await scan(page);
    await context.close();
  }
});

test("defers an in-flight managed result behind a later menu and rejects it after folder navigation", async ({
  browser
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: productionBaseURL });
  const page = await context.newPage();
  const fixtureName = `Managed-race-${randomUUID()}`;
  const fixture = path.resolve(".e2e", "media", fixtureName);
  const releases: Array<() => void> = [];
  let holdNext:
    | {
        gate: Promise<void>;
        started: () => void;
        finished: () => void;
      }
    | undefined;
  function holdNextRead() {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    let finished: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const settled = new Promise<void>((resolve) => {
      finished = resolve;
    });
    holdNext = { gate, started, finished };
    releases.push(release);
    return { ready, release, settled };
  }
  try {
    await mkdir(path.join(fixture, "Gallery"), { recursive: true });
    await mkdir(path.join(fixture, "Other"));
    await Promise.all([
      writeFile(path.join(fixture, "Gallery", "race-a.png"), png),
      writeFile(path.join(fixture, "Gallery", "race-b.png"), png),
      writeFile(path.join(fixture, "Other", "other-only.png"), png)
    ]);
    const tree = await signInAndScan(page);
    const folder = tree.folders.find(
      (entry) => entry.relativePath === `${fixtureName}/Gallery`
    )!;
    const other = tree.folders.find(
      (entry) => entry.relativePath === `${fixtureName}/Other`
    )!;
    await page.goto(
      `/?folder=${folder.id}&view=gallery&sort=filename&order=asc&size=small`
    );
    const gallery = page.locator(".gallery-viewport");
    await expect(
      gallery.getByRole("button", { name: "Open race-a.png", exact: true })
    ).toBeVisible();
    await page.route(`**/api/folders/${folder.id}/assets?*`, async (route) => {
      const held = holdNext;
      if (!held) {
        await route.continue();
        return;
      }
      holdNext = undefined;
      const response = await route.fetch();
      held.started();
      await held.gate;
      await route.fulfill({ response }).catch(() => undefined);
      held.finished();
    });
    const firstRead = holdNextRead();
    await addMedia(page, "race-added.png");
    await firstRead.ready;
    const folderRow = page
      .getByRole("tree", { name: "Media folders", exact: true })
      .locator(`[data-folder-id="${folder.id}"]`);
    await folderRow.click({ button: "right" });
    const menu = page.getByRole("menu", {
      name: "Actions for Gallery",
      exact: true
    });
    await expect(menu).toBeVisible();
    firstRead.release();
    await expect(gallery).toHaveAttribute("aria-busy", "false");
    await expect(
      gallery.locator('button[aria-label="Open race-added.png"]')
    ).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      gallery.getByRole("button", { name: "Open race-added.png", exact: true })
    ).toBeVisible();

    const oldRead = holdNextRead();
    await editMenu(page, "race-a.png", "Rename…");
    const rename = page.getByRole("dialog", {
      name: "Rename media",
      exact: true
    });
    await rename
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("race-a-renamed");
    await submitOperation(
      page,
      rename.getByRole("button", { name: "Rename", exact: true })
    );
    await expect(rename).toBeHidden();
    await oldRead.ready;
    await page
      .getByRole("tree", { name: "Media folders", exact: true })
      .locator(`[data-folder-id="${other.id}"]`)
      .click();
    await expect(
      gallery.getByRole("button", { name: "Open other-only.png", exact: true })
    ).toBeVisible();
    oldRead.release();
    await oldRead.settled;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(
      gallery.getByRole("button", { name: "Open other-only.png", exact: true })
    ).toBeVisible();
    await expect(gallery.locator("[data-asset-id]")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("folder")).toBe(other.id);
  } finally {
    for (const release of releases) release();
    await rm(fixture, { recursive: true, force: true });
    if (!page.isClosed()) await scan(page);
    await context.close();
  }
});
