import { openLibrarySearch } from "./library-search";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "ordered-sorting-fixture";
const directory = path.resolve(".e2e/media", folderName);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let assets: AssetRecord[];

async function csrf(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}
async function scan(page: Page) {
  const result = await page.request.post(`${origin}/api/admin/scan`, {
    headers: await csrf(page)
  });
  expect(result.status()).toBe(202);
  const { jobId } = (await result.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const { jobs } = (await (
          await page.request.get(`${origin}/api/admin/jobs`)
        ).json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
}
async function seed(page: Page) {
  for (const [index, asset] of assets.entries()) {
    expect(
      (
        await page.request.patch(`${origin}/api/assets/${asset.id}/score`, {
          headers: await csrf(page),
          data: { score: index + 1, favorite: false }
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await page.request.put(`${origin}/api/assets/${asset.id}/tags`, {
          headers: await csrf(page),
          data: {
            tags:
              index === 0
                ? ["alpha", "shared"]
                : index === 1
                  ? ["beta", "shared"]
                  : index === 2
                    ? ["alpha"]
                    : []
          }
        })
      ).ok()
    ).toBe(true);
  }
}
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    await page
      .getByLabel("Password", { exact: true })
      .fill("aether-e2e-password");
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Gallery view", exact: true })
    ).toBeVisible();
    await mkdir(directory, { recursive: true });
    for (const name of ["a.png", "b.png", "c.png", "d.png"])
      await writeFile(path.join(directory, name), png);
    await scan(page);
    const tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === folderName
    )!.id;
    assets = (
      (await (
        await page.request.get(
          `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
        )
      ).json()) as AssetListResponse
    ).items;
    expect(assets).toHaveLength(4);
    await seed(page);
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
  test(`matches all or any tags, finds untagged items and restores filters (${layout})`, async ({
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
      await page.goto(
        `${origin}/?folder=${folderId}&view=gallery&sort=filename&size=compact`
      );
      const panel = await openLibrarySearch(page);
      const input = panel.getByRole("textbox", { name: "Tags", exact: true });
      for (const tag of ["alpha", "shared"]) {
        await input.fill(tag);
        await input.press("Enter");
      }
      await expect(
        panel.getByRole("combobox", { name: "Tag matching" })
      ).toHaveText("Match all tags");
      await choose(page, "Tag matching", "Match any tag");
      await panel.getByRole("button", { name: "Search", exact: true }).click();
      await expectNames(page, ["a.png", "b.png", "c.png"]);
      await page.reload();
      await openLibrarySearch(page);
      await expect(
        panel.getByRole("combobox", { name: "Tag matching" })
      ).toHaveText("Match any tag");
      await choose(page, "Tag matching", "Match all tags");
      await panel.getByRole("button", { name: "Search", exact: true }).click();
      await expectNames(page, ["a.png"]);
      await openLibrarySearch(page);
      await choose(page, "Tag status", "Untagged");
      await expect(
        panel.getByRole("button", { name: /^Remove .* tag filter$/ })
      ).toHaveCount(0);
      await expect(
        panel.getByRole("textbox", { name: "Tags", exact: true })
      ).toHaveCount(0);
      await panel.getByRole("button", { name: "Search", exact: true }).click();
      await expectNames(page, ["d.png"]);
      expect(new URL(page.url()).searchParams.getAll("tag")).toEqual([]);
      await openLibrarySearch(page);
      await panel.getByRole("button", { name: "Clear", exact: true }).click();
      await panel.getByRole("button", { name: "Search", exact: true }).click();
      await expectNames(page, ["a.png", "b.png", "c.png", "d.png"]);
    } finally {
      await context.close();
    }
  });
}
async function choose(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function expectNames(page: Page, names: string[]) {
  await expect
    .poll(() =>
      page
        .locator(".media-tile")
        .getByRole("button", { name: /^Open .*\.png$/ })
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label"))
        )
    )
    .toEqual(names.map((name) => `Open ${name}`));
}

for (const phone of [false, true]) {
  test(`reorders sort priorities and keeps secondary-score edits stable (${phone ? "phone" : "desktop"})`, async ({
    browser
  }, testInfo) => {
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
      await seed(page);
      expect(
        (
          await page.request.patch(
            `${origin}/api/assets/${assets[1]!.id}/score`,
            { headers: await csrf(page), data: { favorite: true } }
          )
        ).ok()
      ).toBe(true);
      await page.goto(
        `${origin}/?folder=${folderId}&view=gallery&sort=filename&size=compact`
      );
      await expectNames(page, ["a.png", "b.png", "c.png", "d.png"]);
      await page.getByRole("button", { name: /^View options/ }).click();
      const panel = page.getByRole("dialog", {
        name: "View options",
        exact: true
      });
      await panel.getByRole("tab", { name: "Sort", exact: true }).click();
      await choose(page, "Sort field 1", "Favorites");
      await panel
        .getByRole("button", { name: "Add sort", exact: true })
        .click();
      await choose(page, "Sort field 2", "Score");
      await choose(page, "Sort direction 2", "Lowest first");
      await expectRules(page, ["favorite:desc", "score:asc"]);
      const handle = panel.getByRole("button", {
        name: "Reorder Score",
        exact: true
      });
      const destination = panel.getByRole("button", {
        name: "Reorder Favorites",
        exact: true
      });
      await handle.scrollIntoViewIfNeeded();
      const start = (await handle.boundingBox())!;
      const end = (await destination.boundingBox())!;
      const from = {
        x: start.x + start.width / 2,
        y: start.y + start.height / 2
      };
      const to = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
      if (phone) {
        const session = await context.newCDPSession(page);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [from]
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [to]
        });
        await expectRules(page, ["favorite:desc", "score:asc"]);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: []
        });
        await session.detach();
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await expectRules(page, ["favorite:desc", "score:asc"]);
        await page.mouse.up();
      }
      await expectRules(page, ["score:asc", "favorite:desc"]);
      await handle.press("ArrowDown");
      await expectRules(page, ["favorite:desc", "score:asc"]);
      await page.screenshot({
        path: testInfo.outputPath(`sorting-${phone ? "phone" : "desktop"}.png`)
      });
      if (phone) {
        await page.setViewportSize({ width: 320, height: 568 });
        expect(
          await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("sorting-320.png") });
        await page.setViewportSize({ width: 393, height: 852 });
      }
      await panel.getByRole("button", { name: "Close view options" }).click();
      await expectNames(page, ["b.png", "a.png", "c.png", "d.png"]);
      await page.getByRole("button", { name: /^View options/ }).click();
      await panel
        .getByRole("button", { name: "Move Score up", exact: true })
        .click();
      await expectRules(page, ["score:asc", "favorite:desc"]);
      await panel.getByRole("button", { name: "Close view options" }).click();
      await expectNames(page, ["a.png", "b.png", "c.png", "d.png"]);
      await page.getByRole("button", { name: /^View options/ }).click();
      await panel
        .getByRole("button", { name: "Reorder Score", exact: true })
        .press("ArrowDown");
      await expectRules(page, ["favorite:desc", "score:asc"]);
      await expect(
        panel.getByRole("button", { name: "Reorder Score", exact: true })
      ).toBeFocused();
      await panel.getByRole("button", { name: "Close view options" }).click();
      await page.reload();
      await expectNames(page, ["b.png", "a.png", "c.png", "d.png"]);
      await page.getByRole("button", { name: /^View options/ }).click();
      await panel.getByRole("tab", { name: "Layout", exact: true }).click();
      await panel.getByRole("checkbox", { name: "Score", exact: true }).check();
      await panel.getByRole("button", { name: "Close view options" }).click();
      // Repeated edits must keep the clicked card in place even when a secondary criterion changes.
      const tile = page.locator(".media-tile").filter({
        has: page.getByRole("button", { name: "Open a.png", exact: true })
      });
      const increase = tile.getByRole("button", {
        name: /^Increase score for a\.png\. Current score: /
      });
      for (let index = 0; index < 4; index++) {
        const saved = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/assets/${assets[0]!.id}/score`) &&
            response.request().method() === "PATCH" &&
            response.ok()
        );
        await increase.click();
        await saved;
      }
      await expectNames(page, ["b.png", "a.png", "c.png", "d.png"]);
      await page
        .getByRole("button", { name: "Update results", exact: true })
        .click();
      await expectNames(page, ["b.png", "c.png", "d.png", "a.png"]);
      await page.getByRole("button", { name: /^View options/ }).click();
      await panel.getByRole("tab", { name: "Sort", exact: true }).click();
      await panel
        .getByRole("checkbox", { name: "Random order", exact: true })
        .check();
      await expect(
        panel.getByRole("list", { name: "Sort criteria" })
      ).toHaveCount(0);
      expect(new URL(page.url()).searchParams.getAll("sortBy")).toEqual([]);
      await panel.getByRole("button", { name: "Close view options" }).click();
      await page.reload();
      await page.getByRole("button", { name: /^View options/ }).click();
      await panel.getByRole("tab", { name: "Sort", exact: true }).click();
      await panel
        .getByRole("checkbox", { name: "Random order", exact: true })
        .uncheck();
      await expectRules(page, ["favorite:desc", "score:asc"]);
      const addSort = panel.getByRole("button", {
        name: "Add sort",
        exact: true
      });
      for (const [offset, label] of [
        "Date modified",
        "Filename",
        "Tags"
      ].entries()) {
        await addSort.click();
        await expect(
          panel.getByRole("combobox", { name: `Sort field ${offset + 3}` })
        ).toHaveText(label);
      }
      await expect(
        panel.getByRole("combobox", { name: /^Sort field \d$/ })
      ).toHaveCount(5);
      await expect(addSort).toBeDisabled();
      await panel.getByRole("combobox", { name: "Sort field 5" }).click();
      for (const label of ["Favorites", "Score", "Date modified", "Filename"])
        await expect(
          page.getByRole("option", { name: label, exact: true })
        ).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
      await panel
        .getByRole("button", { name: "Remove Tags sort", exact: true })
        .click();
      await expect(
        panel.getByRole("combobox", { name: "Sort field 4" })
      ).toBeFocused();
      await expect(addSort).toBeEnabled();
      for (const label of ["Filename", "Date modified"])
        await panel
          .getByRole("button", { name: `Remove ${label} sort`, exact: true })
          .click();
      await expectRules(page, ["favorite:desc", "score:asc"]);
    } finally {
      await context.close();
    }
  });
}
async function expectRules(page: Page, criteria: string[]) {
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("sortBy"))
    .toEqual(criteria);
}

test("keeps restored and appended Leaderboard pages on one library revision", async ({
  browser
}) => {
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    await context.addInitScript((id) => {
      localStorage.setItem(
        "aether.scroll.v3.leaderboard",
        JSON.stringify({
          contextKey: JSON.stringify([id, "all", "all", "", []]),
          loadedCount: 300,
          scrollTop: 0
        })
      );
    }, folderId);
    const records = Array.from({ length: 360 }, (_, index) => ({
      ...assets[0]!,
      id: `leaderboard-revision-${index}`,
      name: `revision-${String(index).padStart(3, "0")}.png`,
      score: 400 - index
    }));
    let revision = 1;
    let reordered = records;
    let failNextAppend = false;
    const requests: Array<{ offset: number; revision: string | null }> = [];
    await page.route(`**/api/folders/${folderId}/assets?**`, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("sort") !== "score") return route.continue();
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      const expected = params.get("expectedRevision");
      requests.push({ offset, revision: expected });
      if (offset === 250 && revision === 1) {
        revision = 2;
        reordered = [...records.slice(60), ...records.slice(0, 60)];
      }
      if (expected !== null && expected !== String(revision))
        return route.fulfill({
          status: 409,
          json: { error: "library_changed" }
        });
      if (offset === 300 && failNextAppend) {
        failNextAppend = false;
        return route.fulfill({
          status: 503,
          json: { error: "request_failed" }
        });
      }
      return route.fulfill({
        json: {
          folderId,
          items: reordered.slice(offset, offset + limit).map((asset) => ({
            ...asset,
            score: 400 - reordered.indexOf(asset)
          })),
          page: {
            offset,
            limit,
            total: reordered.length,
            revision: String(revision)
          },
          sort: "score",
          order: "desc",
          sortCriteria: [{ field: "score", direction: "desc" }],
          type: "all",
          recursive: true,
          search: "",
          tags: [],
          score: "all",
          seed: 0
        } satisfies AssetListResponse
      });
    });
    await page.goto(
      `${origin}/?folder=${folderId}&view=compare&workspace=leaderboard&sort=date`
    );
    const entries = page.locator("[data-leaderboard-asset-id]");
    const ids = () =>
      entries.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-leaderboard-asset-id"))
      );
    await expect(entries).toHaveCount(300);
    await expect
      .poll(ids)
      .toEqual(reordered.slice(0, 300).map((asset) => asset.id));
    expect(requests).toContainEqual({ offset: 250, revision: "1" });
    expect(requests).toContainEqual({ offset: 250, revision: "2" });

    // A new leading result invalidates the accepted prefix; replace that window
    // rather than joining the old prefix to a different revision's next page.
    revision = 3;
    reordered = [...reordered.slice(1), reordered[0]!];
    const loadMore = page.getByRole("button", {
      name: "Load more",
      exact: true
    });
    await loadMore.click();
    await expect
      .poll(ids)
      .toEqual(reordered.slice(0, 300).map((asset) => asset.id));
    expect(requests).toContainEqual({ offset: 300, revision: "2" });
    await expect(entries).toHaveCount(300);

    failNextAppend = true;
    await loadMore.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(entries).toHaveCount(300);
    await loadMore.click();
    await expect(entries).toHaveCount(348);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(ids)
      .toEqual(reordered.slice(0, 348).map((asset) => asset.id));
    expect(requests).toContainEqual({ offset: 300, revision: "3" });
  } finally {
    await context.close();
  }
});
