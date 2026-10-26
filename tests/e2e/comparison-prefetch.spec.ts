import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  ComparisonDecisionResponse,
  ComparisonPairResponse,
  ComparisonPrefetchResponse
} from "../../apps/web/src/api/client";

interface VoteBody {
  mutationId: string;
  leftAssetId: string;
  rightAssetId: string;
  nextPairAssetIds?: [string, string];
}

interface InstrumentedWindow extends Window {
  comparisonDecodedSources: string[];
  comparisonHidden: boolean;
  comparisonFirstSwapReady?: boolean;
}

const prefetchRoute = "**/api/folders/*/comparisons/prefetch";
const resumeRoute = "**/api/folders/*/comparisons/resume";
const heldRoutes = new WeakMap<Page, Set<Route>>();

function trackHeldRoute(page: Page, route: Route): void {
  const routes = heldRoutes.get(page) ?? new Set<Route>();
  routes.add(route);
  heldRoutes.set(page, routes);
}

test.afterEach(async ({ page }) => {
  await Promise.all(
    [...(heldRoutes.get(page) ?? [])].map((route) =>
      route.abort("aborted").catch(() => undefined)
    )
  );
  await page.unrouteAll({ behavior: "wait" });
});

async function signInAndScan(page: Page): Promise<string> {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByText("Scan complete")).toBeVisible({
    timeout: 15_000
  });
  await expect
    .poll(() => new URL(page.url()).searchParams.get("folder"))
    .toBeTruthy();
  return new URL(page.url()).searchParams.get("folder")!;
}

async function openRanking(page: Page, folderId: string): Promise<void> {
  await page.goto(
    `/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking`
  );
  await rankingReady(page);
}

async function rankingReady(page: Page): Promise<void> {
  await expect(page.locator(".comparison-choose-surface")).toHaveCount(2);
  await expect(
    page.locator(".comparison-choose-surface").first()
  ).toBeEnabled();
}

async function visiblePairIds(page: Page): Promise<string[]> {
  return page
    .locator(".comparison-card")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-asset-id")!)
    );
}

function pairIds(pair: ComparisonPairResponse): [string, string] {
  return [pair.left.id, pair.right.id];
}

function displaySources(pair: ComparisonPairResponse): string[] {
  return [pair.left, pair.right].map(
    (asset) => `/api/assets/${asset.id}/thumbnail?size=640`
  );
}

async function observeImageDecoding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as InstrumentedWindow;
    target.comparisonDecodedSources = [];
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const source = new URL(this.src, location.href);
      return decode.call(this).then(() => {
        target.comparisonDecodedSources.push(source.pathname + source.search);
      });
    };
  });
}

async function waitForDecodedPair(
  page: Page,
  pair: ComparisonPairResponse
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as InstrumentedWindow).comparisonDecodedSources
      )
    )
    .toEqual(expect.arrayContaining(displaySources(pair)));
}

async function finishFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function fulfillHeldRoute(
  route: Route,
  body: ComparisonPrefetchResponse
): Promise<void> {
  try {
    await route.fulfill({ json: body });
  } catch {
    // A cancelled browser request may already be closed when its response arrives.
  }
}

test("decodes upcoming comparisons before a choice and swaps only after the vote is confirmed", async ({
  page
}) => {
  await observeImageDecoding(page);
  const folderId = await signInAndScan(page);
  const batches: ComparisonPrefetchResponse[] = [];
  let resumeRequests = 0;
  await page.route(resumeRoute, async (route) => {
    resumeRequests += 1;
    await route.continue();
  });
  await page.route(prefetchRoute, async (route) => {
    const response = await route.fetch();
    batches.push((await response.json()) as ComparisonPrefetchResponse);
    await route.fulfill({ response });
  });
  await openRanking(page, folderId);
  const originalPair = await visiblePairIds(page);
  await expect.poll(() => batches.length).toBe(1);
  expect(batches[0].pairs).toHaveLength(3);
  for (const prepared of batches[0].pairs) {
    await waitForDecodedPair(page, prepared);
  }
  const prepared = batches[0].pairs[0];
  const preparedIds = pairIds(prepared);
  const resumesBeforeVote = resumeRequests;
  let vote: VoteBody | undefined;
  let releaseVote: (() => Promise<void>) | undefined;
  await page.route("**/api/comparisons", async (route) => {
    vote = route.request().postDataJSON() as VoteBody;
    const response = await route.fetch();
    trackHeldRoute(page, route);
    releaseVote = () => route.fulfill({ response });
  });
  await page.evaluate(
    (expectedNames) => {
      const target = window as unknown as InstrumentedWindow;
      const observer = new MutationObserver(() => {
        const choices = [
          ...document.querySelectorAll(".comparison-choose-surface")
        ];
        if (
          choices
            .map((choice) => choice.getAttribute("aria-label"))
            .join("|") === expectedNames.join("|")
        ) {
          target.comparisonFirstSwapReady = [
            ...document.querySelectorAll(".comparison-card .media-image-shell")
          ].every((shell) => shell.classList.contains("ready"));
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector(".comparison-pair")!, {
        childList: true,
        subtree: true,
        attributes: true
      });
    },
    [`Choose ${prepared.left.name}`, `Choose ${prepared.right.name}`]
  );

  await page.locator(".comparison-choose-surface").first().click();
  await expect.poll(() => Boolean(releaseVote)).toBe(true);
  expect(vote?.nextPairAssetIds).toEqual(preparedIds);
  expect(await visiblePairIds(page)).toEqual(originalPair);
  for (const choice of await page.locator(".comparison-choose-surface").all()) {
    await expect(choice).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "Skip this pair" })
  ).toBeDisabled();
  await releaseVote!();
  await rankingReady(page);
  expect(await visiblePairIds(page)).toEqual(preparedIds);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as InstrumentedWindow).comparisonFirstSwapReady
      )
    )
    .toBe(true);
  await expect.poll(() => batches.length).toBe(2);
  await finishFrames(page);
  expect(resumeRequests).toBe(resumesBeforeVote);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
});

test("keeps decoded thumbnails visible while displayed originals are delayed, then handles loading and failure", async ({
  page
}) => {
  const folderId = await signInAndScan(page);
  const originals: Route[] = [];
  let releaseOriginals = false;
  const finishOriginal = (route: Route) =>
    new URL(route.request().url()).pathname.includes(`/${failingId}/`)
      ? route.abort("failed")
      : route.continue();
  const holdOriginal = async (route: Route) => {
    if (releaseOriginals) {
      await finishOriginal(route);
      return;
    }
    originals.push(route);
    trackHeldRoute(page, route);
  };
  await page.route("**/api/assets/*/media", holdOriginal);
  await page.goto(
    `/?folder=${encodeURIComponent(folderId)}&view=compare&workspace=ranking&q=candidate`
  );
  await rankingReady(page);
  const shells = page.locator(".comparison-card .media-image-shell");
  await expect(shells).toHaveCount(2);
  await expect(
    page.locator(
      ".comparison-card .media-image-shell.thumbnail-ready:not(.ready)"
    )
  ).toHaveCount(2);
  await expect.poll(() => originals.length).toBeGreaterThanOrEqual(2);
  const thumbnailState = await shells.evaluateAll((elements) =>
    elements.map((shell) => {
      const thumbnail = shell.querySelector<HTMLImageElement>(
        ".media-image-thumbnail"
      )!;
      return {
        decoded: thumbnail.complete && thumbnail.naturalWidth > 0,
        thumbnailOpacity: getComputedStyle(thumbnail).opacity,
        loadingOpacity: getComputedStyle(
          shell.querySelector(".media-image-loading")!
        ).opacity
      };
    })
  );
  expect(thumbnailState).toEqual([
    { decoded: true, thumbnailOpacity: "1", loadingOpacity: "0" },
    { decoded: true, thumbnailOpacity: "1", loadingOpacity: "0" }
  ]);
  const failingId = (await visiblePairIds(page))[0];
  releaseOriginals = true;
  await Promise.all(
    originals.map((route) => finishOriginal(route).catch(() => undefined))
  );
  await expect(
    page.locator(".comparison-card .media-image-shell.ready")
  ).toHaveCount(2);
  await expect(
    page.locator(".comparison-card img[data-preview-source='original']")
  ).toHaveCount(1);
  await expect(
    page.locator(".comparison-card img[data-preview-source='thumbnail']")
  ).toHaveCount(1);
  await expect(page.locator(".comparison-card .media-placeholder")).toHaveCount(
    0
  );
});

test("retries a lost vote response with the same prepared pair and restores Undo", async ({
  page
}) => {
  await observeImageDecoding(page);
  const folderId = await signInAndScan(page);
  let prepared: ComparisonPairResponse | undefined;
  await page.route(prefetchRoute, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as ComparisonPrefetchResponse;
    prepared ??= body.pairs[0];
    await route.fulfill({ response });
  });
  await openRanking(page, folderId);
  const originalPair = await visiblePairIds(page);
  await expect.poll(() => Boolean(prepared)).toBe(true);
  await waitForDecodedPair(page, prepared!);
  const votes: VoteBody[] = [];
  const receipts: ComparisonDecisionResponse[] = [];
  await page.route("**/api/comparisons", async (route) => {
    votes.push(route.request().postDataJSON() as VoteBody);
    const response = await route.fetch();
    receipts.push((await response.json()) as ComparisonDecisionResponse);
    if (votes.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.locator(".comparison-choose-surface").first().click();
  await expect(page.getByText(/could not be confirmed/i)).toBeVisible();
  expect(votes[0].nextPairAssetIds).toEqual(pairIds(prepared!));
  await page.reload();
  await rankingReady(page);
  expect(votes).toHaveLength(2);
  expect(votes[1]).toEqual(votes[0]);
  expect(receipts[1].eventId).toBe(receipts[0].eventId);
  expect(await visiblePairIds(page)).toEqual(pairIds(prepared!));
  await page.getByRole("button", { name: "Undo last choice" }).click();
  await rankingReady(page);
  expect(await visiblePairIds(page)).toEqual(originalPair);
});

test("discards a delayed batch after Settings and a folder change, including a two-item library", async ({
  page
}) => {
  const folderId = await signInAndScan(page);
  let held: { route: Route; body: ComparisonPrefetchResponse } | undefined;
  let batches = 0;
  await page.route(prefetchRoute, async (route) => {
    batches += 1;
    const response = await route.fetch();
    const body = (await response.json()) as ComparisonPrefetchResponse;
    if (batches === 1) {
      held = { route, body };
      trackHeldRoute(page, route);
    } else await route.fulfill({ response });
  });
  await openRanking(page, folderId);
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "Trips, 2 items", exact: true })
    .click();
  await rankingReady(page);
  const tripsPair = await visiblePairIds(page);
  await expect(
    page.locator(".comparison-choose-surface").first()
  ).toHaveAttribute("aria-label", /Choose (beach-walk|city-night)\.png/);
  await expect(
    page.locator(".comparison-choose-surface").last()
  ).toHaveAttribute("aria-label", /Choose (beach-walk|city-night)\.png/);
  await fulfillHeldRoute(held!.route, held!.body);
  await finishFrames(page);
  expect(await visiblePairIds(page)).toEqual(tripsPair);
  let vote: VoteBody | undefined;
  await page.route("**/api/comparisons", async (route) => {
    vote = route.request().postDataJSON() as VoteBody;
    await route.continue();
  });
  await page.locator(".comparison-choose-surface").first().click();
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  expect(vote?.nextPairAssetIds).toBeUndefined();
  expect(vote && [vote.leftAssetId, vote.rightAssetId]).toEqual(tripsPair);
  await page.getByRole("button", { name: "Undo last choice" }).click();
  await rankingReady(page);
  expect(await visiblePairIds(page)).toEqual(tripsPair);
});

test("keeps ranking available when background pair requests and media fail", async ({
  page
}) => {
  const folderId = await signInAndScan(page);
  let prefetchRequests = 0;
  await page.route(prefetchRoute, async (route) => {
    prefetchRequests += 1;
    await route.fulfill({
      status: 503,
      json: { error: "prefetch_unavailable" }
    });
  });
  await page.route("**/api/assets/*/thumbnail?*", (route) =>
    route.abort("failed")
  );
  await page.route("**/api/assets/*/media", (route) => route.abort("failed"));
  await openRanking(page, folderId);
  await expect.poll(() => prefetchRequests).toBe(1);
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/comparisons" &&
      response.request().method() === "POST"
  );
  await page.locator(".comparison-choose-surface").first().click();
  const result = await response;
  expect(result.ok()).toBe(true);
  expect(
    (result.request().postDataJSON() as VoteBody).nextPairAssetIds
  ).toBeUndefined();
  await rankingReady(page);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  await expect(
    page.getByText("Comparison unavailable", { exact: true })
  ).toHaveCount(0);
});

test("validates a prepared skip and refills after Undo restores the prior pair", async ({
  page
}) => {
  await observeImageDecoding(page);
  const folderId = await signInAndScan(page);
  const batches: ComparisonPrefetchResponse[] = [];
  const resumedPairs: Array<[string, string] | null> = [];
  await page.route(prefetchRoute, async (route) => {
    const response = await route.fetch();
    batches.push((await response.json()) as ComparisonPrefetchResponse);
    await route.fulfill({ response });
  });
  await page.route(resumeRoute, async (route) => {
    const body = route.request().postDataJSON() as {
      pairAssetIds: [string, string] | null;
    };
    resumedPairs.push(body.pairAssetIds);
    await route.continue();
  });
  await openRanking(page, folderId);
  await expect.poll(() => batches.length).toBe(1);
  await waitForDecodedPair(page, batches[0].pairs[0]);
  const skippedTo = pairIds(batches[0].pairs[0]);
  await page.getByRole("button", { name: "Skip this pair" }).click();
  await rankingReady(page);
  expect(await visiblePairIds(page)).toEqual(skippedTo);
  expect(resumedPairs).toContainEqual(skippedTo);
  await expect.poll(() => batches.length).toBe(2);
  await page.locator(".comparison-choose-surface").first().click();
  await rankingReady(page);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  const batchesBeforeUndo = batches.length;
  await page.getByRole("button", { name: "Undo last choice" }).click();
  await rankingReady(page);
  expect(await visiblePairIds(page)).toEqual(skippedTo);
  await expect.poll(() => batches.length).toBeGreaterThan(batchesBeforeUndo);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeDisabled();
});

test("clears superseded Undo when the server validates a prepared skip", async ({
  page
}) => {
  await observeImageDecoding(page);
  const folderId = await signInAndScan(page);
  const batches: ComparisonPrefetchResponse[] = [];
  const resumedPairs: Array<[string, string] | null> = [];
  let savedChoice: VoteBody | undefined;
  await page.route(prefetchRoute, async (route) => {
    const response = await route.fetch();
    batches.push((await response.json()) as ComparisonPrefetchResponse);
    await route.fulfill({ response });
  });
  await page.route(resumeRoute, async (route) => {
    const body = route.request().postDataJSON() as {
      pairAssetIds: [string, string] | null;
    };
    resumedPairs.push(body.pairAssetIds);
    await route.continue();
  });
  await page.route("**/api/comparisons", async (route) => {
    savedChoice = route.request().postDataJSON() as VoteBody;
    await route.continue();
  });
  await openRanking(page, folderId);
  await expect.poll(() => batches.length).toBe(1);
  await waitForDecodedPair(page, batches[0].pairs[0]);
  const refillFinished = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/comparisons/prefetch") &&
      response.ok()
  );
  await page.locator(".comparison-choose-surface").first().click();
  await rankingReady(page);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeEnabled();
  await expect.poll(() => batches.length).toBeGreaterThan(1);
  await (await refillFinished).finished();
  for (const pair of batches[1].pairs) await waitForDecodedPair(page, pair);
  await finishFrames(page);
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const replacement = await page.request.post("/api/comparisons", {
    headers: { "x-csrf-token": csrf },
    data: {
      leftAssetId: savedChoice!.leftAssetId,
      rightAssetId: savedChoice!.rightAssetId,
      winnerAssetId: savedChoice!.rightAssetId
    }
  });
  expect(replacement.ok()).toBe(true);
  const beforeSkip = await visiblePairIds(page);
  const resumesBeforeSkip = resumedPairs.length;
  await page.getByRole("button", { name: "Skip this pair" }).click();
  await rankingReady(page);
  expect(resumedPairs).toHaveLength(resumesBeforeSkip + 1);
  expect(resumedPairs.at(-1)).not.toBeNull();
  expect(resumedPairs.at(-1)).not.toEqual(beforeSkip);
  await expect(
    page.getByRole("button", { name: "Undo last choice" })
  ).toBeDisabled();
});

test("cancels hidden-page preparation and resumes the same pair before refilling", async ({
  page
}) => {
  await page.addInitScript(() => {
    const target = window as unknown as InstrumentedWindow;
    target.comparisonHidden = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (target.comparisonHidden ? "hidden" : "visible")
    });
  });
  const folderId = await signInAndScan(page);
  let batches = 0;
  let resumes = 0;
  let held: { route: Route; body: ComparisonPrefetchResponse } | undefined;
  await page.route(resumeRoute, async (route) => {
    resumes += 1;
    await route.continue();
  });
  await page.route(prefetchRoute, async (route) => {
    batches += 1;
    const response = await route.fetch();
    const body = (await response.json()) as ComparisonPrefetchResponse;
    if (batches === 1) {
      held = { route, body };
      trackHeldRoute(page, route);
    } else await route.fulfill({ response });
  });
  await openRanking(page, folderId);
  const before = await visiblePairIds(page);
  await expect.poll(() => Boolean(held)).toBe(true);
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      new URL(request.url()).pathname.endsWith("/comparisons/prefetch")
  });
  await page.evaluate(() => {
    (window as unknown as InstrumentedWindow).comparisonHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await aborted;
  const hiddenResumes = resumes;
  await fulfillHeldRoute(held!.route, held!.body);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true })
    );
  });
  await finishFrames(page);
  expect(batches).toBe(1);
  expect(resumes).toBe(hiddenResumes);
  await page.evaluate(() => {
    (window as unknown as InstrumentedWindow).comparisonHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => batches).toBeGreaterThan(1);
  await rankingReady(page);
  expect(await visiblePairIds(page)).toEqual(before);
});
