import { setLibrarySearch } from "./library-search";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

async function prepareFolder(page: Page, fixtureName: string, count = 82) {
  const directory = path.resolve(".e2e", "media", fixtureName);
  await mkdir(directory);
  for (let index = 0; index < count; index++)
    await writeFile(
      path.join(directory, `${String(index).padStart(4, "0")}.png`),
      png
    );
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  const headers = {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
  const scan = await page.request.post("/api/admin/scan", { headers });
  expect(scan.status()).toBe(202);
  const { jobId } = (await scan.json()) as { jobId: string };
  await expect
    .poll(async () => {
      const { jobs } = (await (
        await page.request.get("/api/admin/jobs")
      ).json()) as { jobs: ScanJob[] };
      return jobs.find((job) => job.id === jobId)?.status;
    })
    .toBe("completed");
  const tree = (await (
    await page.request.get("/api/tree")
  ).json()) as TreeResponse;
  const folder = tree.folders.find(
    (entry) => entry.relativePath === fixtureName
  )!;
  expect(folder).toBeDefined();
  return folder;
}

async function expectLoadedCount(page: Page, count: number) {
  await page.getByRole("button", { name: "Select media", exact: true }).click();
  await page
    .getByRole("button", { name: "Selection options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Select loaded", exact: true })
    .click();
  await expect(page.locator(".batch-summary")).toHaveText(
    new RegExp(`${count}\\s*items selected`)
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

for (const phone of [false, true]) {
  test(`announces a delayed initial Feed load on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    const fixtureName = `Feed-loading-${randomUUID()}`;
    const directory = path.resolve(".e2e", "media", fixtureName);
    let releaseResponse = () => {};
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    try {
      const folder = await prepareFolder(page, fixtureName, 2);
      await page.route(
        `**/api/folders/${folder.id}/assets?*`,
        async (route) => {
          await responseGate;
          await route.continue();
        }
      );
      await page.goto(
        `/?folder=${folder.id}&view=feed&sort=filename&order=asc`
      );
      const feed = page.getByRole("region", {
        name: "Feed view",
        exact: true
      });
      const loadingStatus = page
        .getByRole("status")
        .filter({ hasText: /^Loading feed$/ });
      await expect(feed).toHaveAttribute("aria-busy", "true");
      await expect(loadingStatus).toHaveCount(1);
      await expect(loadingStatus).toHaveAttribute("aria-atomic", "true");
      // The busy region must not defer its own loading announcement.
      await expect(feed.getByRole("status")).toHaveCount(0);
      await expect(feed.getByRole("article")).toHaveCount(0);
      await expect(feed.locator(".media-skeleton")).toBeVisible();
      await expect(page.locator(".empty-library")).toHaveCount(0);

      releaseResponse();
      await expect(feed).toHaveAttribute("aria-busy", "false");
      await expect(loadingStatus).toHaveCount(0);
      await expect(feed.locator(".media-skeleton")).toHaveCount(0);
      await expect(
        feed.getByRole("article", { name: "image: 0000.png", exact: true })
      ).toBeInViewport();
      await feed.press("ArrowDown");
      await expect(
        feed.getByRole("article", { name: "image: 0001.png", exact: true })
      ).toBeInViewport();
    } finally {
      releaseResponse();
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test(`recovers failed initial and changed-query gallery loads on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    const fixtureName = `Load-recovery-${randomUUID()}`;
    const directory = path.resolve(".e2e", "media", fixtureName);
    try {
      const folder = await prepareFolder(page, fixtureName);
      let rejectInitial = true;
      let rejectSearch = true;
      let initialRequests = 0;
      let searchRequests = 0;
      await page.route(
        `**/api/folders/${folder.id}/assets?*`,
        async (route) => {
          const url = new URL(route.request().url());
          const searched = url.searchParams.get("search") === "0001";
          if (searched) searchRequests += 1;
          else initialRequests += 1;
          if (searched ? rejectSearch : rejectInitial) {
            await route.fulfill({
              status: 503,
              json: { error: "unavailable" }
            });
          } else await route.continue();
        }
      );
      await page.goto(
        `/?folder=${folder.id}&view=gallery&sort=filename&order=asc`
      );
      const failure = page.locator(".library-load-error");
      await expect(failure).toContainText("Unable to load media.");
      await expect(failure).toHaveAttribute("role", "alert");
      await expect(page.locator(".gallery-loading-layer")).toHaveCount(0);
      await expect(page.locator(".empty-library")).toHaveCount(0);
      await expect(page.locator(".asset-card")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Select media", exact: true })
      ).toBeDisabled();
      const failedInitialRequests = initialRequests;
      // A failed read must wait for user intent rather than restart itself.
      await page.waitForTimeout(350);
      expect(initialRequests).toBe(failedInitialRequests);

      rejectInitial = false;
      await failure.getByRole("button", { name: "Retry", exact: true }).click();
      const gallery = page.getByRole("region", { name: "Gallery view" });
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      await expect(
        gallery.getByRole("button", { name: "Open 0000.png", exact: true })
      ).toBeVisible();
      await expect(failure).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^View options/ })
      ).toBeFocused();

      await setLibrarySearch(page, "0001");
      await expect(failure).toContainText("Unable to load media.");
      await expect(page.locator(".gallery-loading-layer")).toHaveCount(0);
      await expect(page.locator(".empty-library")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Open 0000.png", exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Select media", exact: true })
      ).toBeDisabled();
      const failedSearchRequests = searchRequests;
      await page.waitForTimeout(350);
      expect(searchRequests).toBe(failedSearchRequests);

      rejectSearch = false;
      await failure.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        gallery.getByRole("button", { name: "Open 0001.png", exact: true })
      ).toBeVisible();
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      await expect(failure).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^View options/ })
      ).toBeFocused();
      await expect(
        gallery.getByRole("button", { name: "Open 0000.png", exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test(`keeps gallery depth through failed paging and foreground refresh on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    const fixtureName = `Paging-recovery-${randomUUID()}`;
    const directory = path.resolve(".e2e", "media", fixtureName);
    try {
      const folder = await prepareFolder(page, fixtureName);
      let rejectAppend = true;
      let rejectRefresh = false;
      let appendRequests = 0;
      const refreshLimits: number[] = [];
      await page.route(
        `**/api/folders/${folder.id}/assets?*`,
        async (route) => {
          const url = new URL(route.request().url());
          const isAppend = url.searchParams.get("offset") === "80";
          if (isAppend) appendRequests += 1;
          if (!isAppend && url.searchParams.get("limit") === "82")
            refreshLimits.push(Number(url.searchParams.get("limit")));
          if ((isAppend && rejectAppend) || rejectRefresh)
            await route.fulfill({
              status: 503,
              json: { error: "unavailable" }
            });
          else await route.continue();
        }
      );
      await page.goto(
        `/?folder=${folder.id}&view=gallery&sort=filename&order=asc&size=huge`
      );
      const gallery = page.getByRole("region", { name: "Gallery view" });
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      await expect(
        gallery.getByRole("button", { name: "Open 0000.png", exact: true })
      ).toBeVisible();
      await gallery.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const failure = page.locator(".library-load-error");
      await expect(failure).toContainText("Unable to load more media.");
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      expect(appendRequests).toBe(1);
      await expectLoadedCount(page, 80);
      await gallery.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(
        gallery.getByRole("button", { name: "Open 0000.png", exact: true })
      ).toBeVisible();
      await gallery.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      // Re-entering the sentinel and its loading-state changes cannot retry.
      await page.waitForTimeout(350);
      expect(appendRequests).toBe(1);

      rejectAppend = false;
      await failure.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(failure).toHaveCount(0);
      await expect(gallery.locator(".load-more-row")).toHaveCount(0);
      await expect.poll(() => appendRequests).toBe(2);
      await expectLoadedCount(page, 82);

      await gallery.evaluate((element) => element.scrollTo(0, 1000));
      const savedPosition = () =>
        page.evaluate(() => {
          const saved = JSON.parse(
            localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
          ) as { anchorId?: string; scrollTop?: number };
          return saved;
        });
      await expect
        .poll(async () => (await savedPosition()).scrollTop ?? 0)
        .toBeCloseTo(1000, 0);
      const before = await savedPosition();
      const beforeScroll = await gallery.evaluate(
        (element) => element.scrollTop
      );
      rejectRefresh = true;
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true })
        )
      );
      await expect(failure).toContainText("Unable to load media.");
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      await expect(
        page.getByRole("button", { name: "Select media", exact: true })
      ).toBeEnabled();
      await expect(
        page.getByRole("region", { name: "Library results" })
      ).toHaveCount(0);
      await expect
        .poll(async () => (await savedPosition()).anchorId)
        .toBe(before.anchorId);
      await expect
        .poll(() => gallery.evaluate((element) => element.scrollTop))
        .toBeCloseTo(beforeScroll, 0);
      expect(refreshLimits).toEqual([82]);

      await page
        .getByRole("button", { name: "Select media", exact: true })
        .click();
      await expect(
        failure.getByRole("button", { name: "Retry", exact: true })
      ).toBeDisabled();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect(
        failure.getByRole("button", { name: "Retry", exact: true })
      ).toBeEnabled();

      rejectRefresh = false;
      await failure.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(failure).toHaveCount(0);
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      await expect
        .poll(async () => (await savedPosition()).anchorId)
        .toBe(before.anchorId);
      await expect
        .poll(() => gallery.evaluate((element) => element.scrollTop))
        .toBeCloseTo(beforeScroll, 0);
      expect(refreshLimits).toEqual([82, 82]);
      await expectLoadedCount(page, 82);
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  for (const view of ["gallery", "feed"] as const) {
    test(`retains a deep ${view} checkpoint when restoration paging fails on ${phone ? "phone" : "desktop"}`, async ({
      browser
    }) => {
      const context = await browser.newContext({
        baseURL: productionBaseURL,
        viewport: phone
          ? { width: 393, height: 852 }
          : { width: 1440, height: 980 },
        isMobile: phone,
        hasTouch: phone,
        serviceWorkers: "block"
      });
      const page = await context.newPage();
      const fixtureName = `Deep-recovery-${randomUUID()}`;
      const directory = path.resolve(".e2e", "media", fixtureName);
      try {
        if (!phone && view === "gallery")
          await page.addInitScript(() =>
            localStorage.setItem(
              "aether.gallery.metadata-fields",
              JSON.stringify(["score"])
            )
          );
        const folder = await prepareFolder(page, fixtureName);
        await page.goto(
          `/?folder=${folder.id}&view=${view}&sort=filename&order=asc&size=huge`
        );
        const content = page.getByRole("region", {
          name: view === "gallery" ? "Gallery view" : "Feed view",
          exact: true
        });
        await expect(content).toHaveAttribute("aria-busy", "false");
        await expect
          .poll(() =>
            page.evaluate(() =>
              Boolean(
                JSON.parse(
                  localStorage.getItem("aether.scroll.v3.library-content") ??
                    "{}"
                ).contextKey
              )
            )
          )
          .toBe(true);
        const response = (await (
          await page.request.get(
            `/api/folders/${folder.id}/assets?limit=100&sort=filename&order=asc`
          )
        ).json()) as AssetListResponse;
        const last = response.items[81]!;
        expect(last.name).toBe("0081.png");
        // A saved position from a deeper window must survive a failed restore.
        await page.addInitScript(
          ({ assetId }) => {
            const key = "aether.scroll.v3.library-content";
            const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
            localStorage.setItem(
              key,
              JSON.stringify({
                ...saved,
                anchorId: assetId,
                anchorOffset: 0,
                index: 81
              })
            );
          },
          { assetId: last.id }
        );
        let rejectAppend = true;
        let appendRequests = 0;
        await page.route(
          `**/api/folders/${folder.id}/assets?*`,
          async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.get("offset") === "80") {
              appendRequests += 1;
              if (rejectAppend) {
                await route.fulfill({
                  status: 503,
                  json: { error: "unavailable" }
                });
                return;
              }
            }
            await route.continue();
          }
        );
        await page.reload();
        const failure = page.locator(".library-load-error");
        await expect(failure).toContainText("Unable to load more media.");
        await expect(content).toHaveAttribute("aria-busy", "false");
        if (view === "gallery") {
          await expect(content.locator(".gallery-loading-layer")).toHaveCount(
            0
          );
          await expect(content.locator(".gallery-content")).not.toHaveAttribute(
            "inert"
          );
          await expect(
            content.getByRole("button", { name: /^Open / }).first()
          ).toBeEnabled();
        } else {
          await expect(content).not.toHaveAttribute("inert");
          await expect(content.locator(".media-skeleton")).toHaveCount(0);
        }
        if (phone && view === "feed") {
          const controls = page.locator(".feed-view-controls");
          await expect(controls).toBeVisible();
          const controlsBox = await controls.boundingBox();
          const failureBox = await failure.boundingBox();
          expect(failureBox!.y).toBeGreaterThanOrEqual(
            controlsBox!.y + controlsBox!.height
          );
          await expect(
            failure.getByRole("button", { name: "Retry", exact: true })
          ).toBeInViewport();
        }
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                JSON.parse(
                  localStorage.getItem("aether.scroll.v3.library-content") ??
                    "{}"
                ).anchorId
            )
          )
          .toBe(last.id);
        await page.waitForTimeout(350);
        expect(appendRequests).toBe(1);

        if (!phone && view === "gallery") {
          const card = content.getByRole("button", { name: /^Open / }).first();
          const ignoredKeys = await card.evaluate((element) => {
            const before =
              element.closest<HTMLElement>(".gallery-viewport")!.scrollTop;
            const prevented = ["Home", "End"].flatMap((key) =>
              [
                { isComposing: true },
                { altKey: true },
                { ctrlKey: true },
                { metaKey: true },
                { shiftKey: true }
              ].map((modifiers) => {
                const event = new KeyboardEvent("keydown", {
                  key,
                  code: key,
                  bubbles: true,
                  cancelable: true,
                  ...modifiers
                });
                element.dispatchEvent(event);
                return event.defaultPrevented;
              })
            );
            return {
              prevented,
              scrolled:
                element.closest<HTMLElement>(".gallery-viewport")!.scrollTop !==
                before
            };
          });
          expect(ignoredKeys).toEqual({
            prevented: Array(10).fill(false),
            scrolled: false
          });
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  JSON.parse(
                    localStorage.getItem("aether.scroll.v3.library-content") ??
                      "{}"
                  ).anchorId
              )
            )
            .toBe(last.id);
        }

        rejectAppend = false;
        await failure
          .getByRole("button", { name: "Retry", exact: true })
          .click();
        await expect(failure).toHaveCount(0);
        await expect(content).toHaveAttribute("aria-busy", "false");
        const restoredItem =
          view === "gallery"
            ? content.getByRole("button", {
                name: `Open ${last.name}`,
                exact: true
              })
            : content.getByRole("article", {
                name: `image: ${last.name}`,
                exact: true
              });
        await expect(restoredItem).toBeInViewport();
        expect(appendRequests).toBe(2);

        if (!phone) {
          rejectAppend = true;
          await page.reload();
          await expect(failure).toContainText("Unable to load more media.");
          await expect(content).toHaveAttribute("aria-busy", "false");
          if (view === "gallery")
            await content
              .getByRole("button", { name: /^Open / })
              .first()
              .press("Home");
          else
            await content
              .getByRole("button", {
                name: "Open 0000.png fullscreen",
                exact: true
              })
              .press("Home");
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  JSON.parse(
                    localStorage.getItem("aether.scroll.v3.library-content") ??
                      "{}"
                  ).index
              )
            )
            .toBe(0);
          if (view === "gallery") {
            await expect(content).toBeFocused();
            await expect
              .poll(() => content.evaluate((element) => element.scrollTop))
              .toBe(0);
          }
          rejectAppend = false;
          await failure
            .getByRole("button", { name: "Retry", exact: true })
            .click();
          await expect(failure).toHaveCount(0);
          if (view === "gallery")
            await expect(content.locator(".load-more-row")).toHaveCount(0);
          else await expect(content.getByRole("article")).toHaveCount(82);
          await expect(content).toHaveAttribute("aria-busy", "false");
          const first =
            view === "gallery"
              ? content.getByRole("button", {
                  name: "Open 0000.png",
                  exact: true
                })
              : content.getByRole("article", {
                  name: "image: 0000.png",
                  exact: true
                });
          await expect(first).toBeInViewport();
          await expect(restoredItem).not.toBeInViewport();

          if (view === "gallery") {
            await content.press("End");
            await expect(content).toBeFocused();
            // Fractional row measurements can round the loaded extent by one pixel.
            await expect
              .poll(() =>
                content.evaluate(
                  (element) =>
                    element.scrollHeight -
                    element.clientHeight -
                    element.scrollTop
                )
              )
              .toBeLessThanOrEqual(1);
            await expect(restoredItem).toBeInViewport();
            await content.press("Home");
            await expect
              .poll(() => content.evaluate((element) => element.scrollTop))
              .toBe(0);
            await expect(first).toBeInViewport();
          }

          rejectAppend = true;
          await page.reload();
          await expect(failure).toContainText("Unable to load more media.");
          await expect(content).toHaveAttribute("aria-busy", "false");
          const scrollingSurface =
            view === "gallery" ? content : content.locator(".feed-view");
          const wheelTarget =
            view === "gallery"
              ? content
                  .getByRole("button", { name: /^Increase score for/ })
                  .first()
              : content.getByRole("button", {
                  name: "Open 0000.png fullscreen",
                  exact: true
                });
          await wheelTarget.hover();
          const beforeWheel = await scrollingSurface.evaluate(
            (element) => element.scrollTop
          );
          await page.mouse.wheel(0, 700);
          await expect
            .poll(() =>
              scrollingSurface.evaluate((element) => element.scrollTop)
            )
            .not.toBe(beforeWheel);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  JSON.parse(
                    localStorage.getItem("aether.scroll.v3.library-content") ??
                      "{}"
                  ).index
              )
            )
            .toBeLessThan(80);
          await expect
            .poll(async () => {
              const savedTop = await page.evaluate(
                () =>
                  JSON.parse(
                    localStorage.getItem("aether.scroll.v3.library-content") ??
                      "{}"
                  ).scrollTop as number
              );
              const actualTop = await scrollingSurface.evaluate(
                (element) => element.scrollTop
              );
              return Math.abs(savedTop - actualTop);
            })
            .toBeLessThan(1);
          const browsedAnchor = await page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem("aether.scroll.v3.library-content") ?? "{}"
              ).anchorId as string
          );
          rejectAppend = false;
          await failure
            .getByRole("button", { name: "Retry", exact: true })
            .click();
          await expect(failure).toHaveCount(0);
          if (view === "gallery")
            await expect(content.locator(".load-more-row")).toHaveCount(0);
          else await expect(content.getByRole("article")).toHaveCount(82);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  JSON.parse(
                    localStorage.getItem("aether.scroll.v3.library-content") ??
                      "{}"
                  ).anchorId
              )
            )
            .toBe(browsedAnchor);
          await expect(restoredItem).not.toBeInViewport();
        }
      } finally {
        await context.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}

test("replaces a paging failure with Update results when curation changes ordering", async ({
  browser
}) => {
  const context = await browser.newContext({
    baseURL: productionBaseURL,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const fixtureName = `Curation-recovery-${randomUUID()}`;
  const directory = path.resolve(".e2e", "media", fixtureName);
  try {
    await page.addInitScript(() =>
      localStorage.setItem(
        "aether.gallery.metadata-fields",
        JSON.stringify(["score"])
      )
    );
    const folder = await prepareFolder(page, fixtureName);
    await page.route(`**/api/folders/${folder.id}/assets?*`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("offset") === "80")
        await route.fulfill({
          status: 503,
          json: { error: "unavailable" }
        });
      else await route.continue();
    });
    await page.goto(
      `/?folder=${folder.id}&view=gallery&sort=score&order=desc&size=huge`
    );
    const gallery = page.getByRole("region", { name: "Gallery view" });
    await expect(gallery).toHaveAttribute("aria-busy", "false");
    await gallery.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const failure = page.locator(".library-load-error");
    await expect(failure).toContainText("Unable to load more media.");
    await gallery.evaluate((element) => {
      element.scrollTop = 0;
    });
    await gallery
      .getByRole("button", { name: /^Increase score for/ })
      .first()
      .click();
    const update = page
      .getByRole("region", { name: "Library results" })
      .getByRole("button", { name: "Update results", exact: true });
    await expect(update).toBeEnabled();
    await expect(failure).toHaveCount(0);
    await update.click();
    await expect(update).toBeHidden();
    await expect(gallery).toHaveAttribute("aria-busy", "false");
    await expect(failure).toHaveCount(0);
    await expectLoadedCount(page, 80);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
