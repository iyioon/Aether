import { expect, test, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord
} from "../../apps/web/src/api/client";

async function loginAndScan(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByText("Scan complete")).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
}
async function rankingReady(page: Page) {
  await expect(page.locator(".comparison-choose-surface")).toHaveCount(2);
  await expect(
    page.locator(".comparison-choose-surface").first()
  ).toBeEnabled();
}
async function startRanking(page: Page) {
  await page.getByRole("button", { name: "Compare and rank" }).click();
  await page
    .locator(".leaderboard-header")
    .getByRole("button", { name: "Rank media", exact: true })
    .click();
  await rankingReady(page);
}
const pair = (page: Page) =>
  page
    .locator(".comparison-choose-surface")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label"))
    );

test("retries an aborted out-of-list fullscreen lookup on browser Back", async ({
  page
}) => {
  await loginAndScan(page);
  await page
    .locator(".gallery-viewport img:not([aria-hidden='true'])")
    .first()
    .click();
  await expect(page.locator(".viewer-dialog")).toBeVisible();
  const url = new URL(page.url());
  const assetId = url.searchParams.get("asset")!;
  const folder = url.searchParams.get("folder")!;
  let requests = 0;
  await page.route(`**/api/assets/${assetId}`, async (route) => {
    requests += 1;
    if (requests > 1) await route.continue();
    // Keep the first lookup pending until the app cancels it on history navigation.
  });
  await page.goto(
    `/?folder=${encodeURIComponent(folder)}&view=gallery&type=video&asset=${encodeURIComponent(assetId)}`
  );
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(() => {
    const next = new URL(location.href);
    next.searchParams.delete("asset");
    history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect
    .poll(() => new URL(page.url()).searchParams.has("asset"))
    .toBe(false);
  await page.goBack();
  await expect(page.locator(".viewer-dialog")).toBeVisible();
  expect(requests).toBeGreaterThan(1);
});

test("preserves a newer viewer score when a delayed foreground lookup finishes", async ({
  page
}) => {
  await loginAndScan(page);
  await page
    .locator(".gallery-viewport img:not([aria-hidden='true'])")
    .first()
    .click();
  const viewer = page.locator(".viewer-dialog");
  await expect(viewer).toBeVisible();
  const assetId = new URL(page.url()).searchParams.get("asset")!;
  const detailPath = `/api/assets/${assetId}`;
  let staleAsset: AssetRecord | undefined;
  let releaseLookup: (() => Promise<void>) | undefined;

  await page.route(`**${detailPath}`, async (route) => {
    const response = await route.fetch();
    staleAsset = (await response.json()) as AssetRecord;
    releaseLookup = () => route.fulfill({ response, json: staleAsset });
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true })
    )
  );
  await expect.poll(() => Boolean(releaseLookup)).toBe(true);
  const original = staleAsset!;
  const scoreResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${detailPath}/score` &&
      response.request().method() === "PATCH" &&
      response.status() === 200
  );
  await page.keyboard.press("ArrowUp");
  const updated = (await (await scoreResponse).json()) as {
    asset: AssetRecord;
  };
  expect(updated.asset.score).toBe(original.score + 1);

  await viewer
    .getByRole("button", {
      name: `Show info for ${original.name}`,
      exact: true
    })
    .click();
  const info = page.locator(".media-info-sheet");
  const increase = info.getByRole("button", {
    name: `Increase score for ${original.name}. Current score: ${updated.asset.score}`,
    exact: true
  });
  // Wait until the mutation response has reached React before releasing the old read.
  await expect(increase).toBeEnabled();
  const lookupFinished = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === detailPath &&
      response.request().method() === "GET"
  );
  await releaseLookup!();
  await (await lookupFinished).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(increase).toBeEnabled();
  await expect(
    info.getByRole("button", {
      name: `Increase score for ${original.name}. Current score: ${original.score}`,
      exact: true
    })
  ).toHaveCount(0);
});

test("keeps the visible Gallery asset when foreground refresh changes ordering", async ({
  page
}) => {
  await loginAndScan(page);
  await page.setViewportSize({ width: 393, height: 852 });
  const folder = new URL(page.url()).searchParams.get("folder")!;
  await page.goto(
    `/?folder=${encodeURIComponent(folder)}&view=gallery&size=huge`
  );
  const gallery = page.locator(".gallery-viewport");
  await expect(gallery).toHaveAttribute("aria-busy", "false");
  await gallery.evaluate((node) => node.scrollTo(0, 900));
  const savedAnchor = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
        ).anchorId as string
    );
  await expect.poll(() => savedAnchor()).toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
          ).scrollTop as number
      )
    )
    .toBeGreaterThan(800);
  const before = await savedAnchor();
  let refreshed = false;
  await page.route("**/api/folders/*/assets?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as AssetListResponse;
    const last = body.items.pop();
    if (last) body.items.unshift(last);
    refreshed = true;
    await route.fulfill({ response, json: body });
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true })
    )
  );
  await expect.poll(() => refreshed).toBe(true);
  await expect(gallery).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => savedAnchor()).toBe(before);
  await expect
    .poll(() => gallery.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(1100);
});

test("retains the ordered ranking pair and Undo through reload, Settings, a fresh page and reauthentication", async ({
  page,
  context
}) => {
  await loginAndScan(page);
  await startRanking(page);
  const chosenPair = await pair(page);
  await page.locator(".comparison-choose-surface").first().click();
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  await rankingReady(page);
  const resumedPair = await pair(page);
  await page.reload();
  await rankingReady(page);
  expect(await pair(page)).toEqual(resumedPair);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Server", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Server", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await rankingReady(page);
  expect(await pair(page)).toEqual(resumedPair);
  const reopened = await context.newPage();
  await reopened.goto("/?launch=resume");
  await rankingReady(reopened);
  expect(await pair(reopened)).toEqual(resumedPair);
  await reopened.close();
  await context.clearCookies();
  await page.reload();
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await rankingReady(page);
  expect(await pair(page)).toEqual(resumedPair);
  await page.getByRole("button", { name: "Undo last choice" }).click();
  await rankingReady(page);
  await expect.poll(() => pair(page)).toEqual(chosenPair);
});

test("uses explicit links and browser history consistently and resumes old Home Screen folder URLs", async ({
  page
}) => {
  await loginAndScan(page);
  await startRanking(page);
  const folder = new URL(page.url()).searchParams.get("folder")!;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.goto(
    `/?folder=${encodeURIComponent(folder)}&view=compare&workspace=ranking`
  );
  await rankingReady(page);
  await page.getByRole("button", { name: "Gallery view" }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  await page.goBack();
  await rankingReady(page);
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = match(query);
      if (query === "(display-mode: standalone)")
        Object.defineProperty(result, "matches", { value: true });
      return result;
    };
  });
  await page.goto(`/?folder=${encodeURIComponent(folder)}`);
  await rankingReady(page);
  expect(new URL(page.url()).searchParams.get("view")).toBe("compare");
});

test("restores random Gallery anchors in a fresh page and retains the fullscreen asset", async ({
  page,
  context
}) => {
  await loginAndScan(page);
  await page.setViewportSize({ width: 393, height: 852 });
  const folder = new URL(page.url()).searchParams.get("folder")!;
  await page.goto(
    `/?folder=${encodeURIComponent(folder)}&size=huge&sort=random`
  );
  const gallery = page.locator(".gallery-viewport");
  await expect(gallery).toHaveAttribute("aria-busy", "false");
  await gallery.evaluate((node) => node.scrollTo(0, 900));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
          ).scrollTop as number
      )
    )
    .toBeGreaterThan(800);
  const seed = await page.evaluate(() =>
    localStorage.getItem("aether.random-order.v1")
  );
  const anchor = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
      ).anchorId as string
  );
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 393, height: 852 });
  await reopened.goto("/?launch=resume");
  await expect(reopened.locator(".gallery-viewport")).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await expect
    .poll(() =>
      reopened.locator(".gallery-viewport").evaluate((node) => node.scrollTop)
    )
    .toBeGreaterThan(800);
  expect(
    await reopened.evaluate(() =>
      localStorage.getItem("aether.random-order.v1")
    )
  ).toBe(seed);
  expect(
    await reopened.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
        ).anchorId as string
    )
  ).toBe(anchor);
  await reopened.close();
  await gallery.evaluate((node) => node.scrollTo(0, 0));
  await gallery.locator("img:not([aria-hidden='true'])").first().click();
  await expect(page.locator(".viewer-dialog")).toBeVisible();
  const asset = new URL(page.url()).searchParams.get("asset");
  expect(asset).toBeTruthy();
  await page.reload();
  await expect(page.locator(".viewer-dialog")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("asset")).toBe(asset);
});

test("reconciles a committed ranking choice whose response is lost", async ({
  page
}) => {
  await loginAndScan(page);
  await startRanking(page);
  const mutationIds: string[] = [];
  const receiptIds: string[] = [];
  await page.route("**/api/comparisons", async (route) => {
    const body = route.request().postDataJSON() as { mutationId: string };
    mutationIds.push(body.mutationId);
    const response = await route.fetch();
    const receipt = (await response.json()) as { eventId: string };
    receiptIds.push(receipt.eventId);
    if (mutationIds.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.locator(".comparison-choose-surface").first().click();
  await expect(page.getByText(/could not be confirmed/i)).toBeVisible();
  await page.reload();
  await rankingReady(page);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  expect(receiptIds[1]).toBe(receiptIds[0]);
});

test("restores the leaderboard anchor through Settings, reload and a fresh page", async ({
  page,
  context
}) => {
  await loginAndScan(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page
    .getByRole("button", { name: "Change view, Gallery selected" })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Compare", exact: true })
    .click();
  const leaderboard = page.locator(".leaderboard-view");
  await expect
    .poll(() =>
      leaderboard.evaluate((node) => node.scrollHeight - node.clientHeight)
    )
    .toBeGreaterThan(20);
  const targetScrollTop = await leaderboard.evaluate((node) => {
    const target = Math.min(100, node.scrollHeight - node.clientHeight);
    node.scrollTo(0, target);
    return target;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("aether.scroll.v3.leaderboard") ?? "{}"
          ).scrollTop as number
      )
    )
    .toBeCloseTo(targetScrollTop, 0);
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("aether.scroll.v3.leaderboard") ?? "{}")
          .scrollTop as number
    )
  ).toBeCloseTo(targetScrollTop, 0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect
    .poll(() => leaderboard.evaluate((node) => node.scrollTop))
    .toBeCloseTo(targetScrollTop, 0);
  await page.reload();
  await expect
    .poll(() => leaderboard.evaluate((node) => node.scrollTop))
    .toBeCloseTo(targetScrollTop, 0);
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 393, height: 852 });
  await reopened.goto("/?launch=resume");
  await expect
    .poll(() =>
      reopened.locator(".leaderboard-view").evaluate((node) => node.scrollTop)
    )
    .toBeCloseTo(targetScrollTop, 0);
  await reopened.close();
});
