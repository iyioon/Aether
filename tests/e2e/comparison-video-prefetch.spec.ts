import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response
} from "@playwright/test";
import type {
  ComparisonDecisionResponse,
  ComparisonPrefetchResponse,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const run = promisify(execFile);
const rangeBytes = 512 * 1_024;
const fixtureFolder = "comparison-prefetch-videos";
const fixtureDirectory = path.resolve(".e2e", "media", fixtureFolder);

test("prepares bounded authenticated video ranges, plays the next pair, and keeps media out of browser storage", async ({
  browser,
  page
}) => {
  let productionContext: BrowserContext | undefined;
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();

  try {
    await seedVideos();
    await scanLibrary(page);
    const treeResponse = await page.request.get("/api/tree");
    expect(treeResponse.ok()).toBe(true);
    const tree = (await treeResponse.json()) as TreeResponse;
    const folder = tree.folders.find(
      (entry) => entry.relativePath === fixtureFolder
    );
    expect(folder).toBeDefined();

    productionContext = await browser.newContext({
      storageState: await page.context().storageState()
    });
    const ranking = await productionContext.newPage();
    const rangeResponses: Response[] = [];
    ranking.on("response", (response) => {
      const request = response.request();
      if (
        assetIdFromMediaUrl(response.url()) &&
        request.resourceType() === "fetch" &&
        request.headers().range === `bytes=0-${rangeBytes - 1}`
      ) {
        rangeResponses.push(response);
      }
    });

    const preparedResponse = ranking.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/comparisons/prefetch") &&
        response.status() === 200
    );
    const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
    await ranking.goto(
      `${origin}/?folder=${encodeURIComponent(folder!.id)}&view=compare&workspace=ranking&type=video`
    );
    await comparisonReady(ranking);
    await expect
      .poll(async () => (await visibleVideoIds(ranking)).length)
      .toBe(2);
    const originalIds = await visibleVideoIds(ranking);
    expect(originalIds).toHaveLength(2);
    const prepared = (await (
      await preparedResponse
    ).json()) as ComparisonPrefetchResponse;
    expect(prepared.pairs.length).toBeGreaterThan(0);
    expect(prepared.pairs.length).toBeLessThanOrEqual(3);
    const upcomingIds = new Set(
      prepared.pairs
        .flatMap((pair) => [pair.left.id, pair.right.id])
        .filter((id) => !originalIds.includes(id))
    );
    expect(upcomingIds.size).toBeGreaterThan(0);

    await expect
      .poll(() =>
        rangeResponses.some((response) =>
          upcomingIds.has(assetIdFromMediaUrl(response.url())!)
        )
      )
      .toBe(true);
    const warmed = rangeResponses.find((response) =>
      upcomingIds.has(assetIdFromMediaUrl(response.url())!)
    )!;
    expect(await warmed.finished()).toBeNull();
    expect(warmed.status()).toBe(206);
    expect(warmed.headers()["content-range"]).toMatch(/^bytes 0-524287\/\d+$/);
    expect(Number(warmed.headers()["content-length"])).toBe(rangeBytes);
    expect((await warmed.body()).byteLength).toBe(rangeBytes);
    const authenticatedHeaders = await warmed.request().allHeaders();
    expect(
      Boolean(authenticatedHeaders.cookie?.includes("aether_session="))
    ).toBe(true);

    const decisionResponse = ranking.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/comparisons" &&
        response.request().method() === "POST" &&
        response.status() === 200
    );
    await ranking.locator(".comparison-choose-surface").first().click();
    const decision = (await (
      await decisionResponse
    ).json()) as ComparisonDecisionResponse;
    expect(decision.nextPair).toBeTruthy();
    const expectedIds = [
      decision.nextPair!.left.id,
      decision.nextPair!.right.id
    ];
    expect(expectedIds).toEqual([
      prepared.pairs[0]!.left.id,
      prepared.pairs[0]!.right.id
    ]);
    await comparisonReady(ranking);
    await expect.poll(() => visibleVideoIds(ranking)).toEqual(expectedIds);
    await expect(
      ranking.locator(".comparison-card video[data-preview-source='original']")
    ).toHaveCount(2);
    await expect(
      ranking.locator(".comparison-card .media-video-shell.ready")
    ).toHaveCount(2);
    await expect
      .poll(() =>
        ranking.locator(".comparison-card video").evaluateAll((videos) =>
          videos.every((element) => {
            const video = element as HTMLVideoElement;
            return (
              video.readyState >= 2 &&
              video.videoWidth > 0 &&
              video.currentTime > 0
            );
          })
        )
      )
      .toBe(true);

    await ranking.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const persistence = await ranking.evaluate(async () => ({
      cachedUrls: (
        await Promise.all(
          (await caches.keys()).map(async (name) =>
            (await (await caches.open(name)).keys()).map(
              (request) => request.url
            )
          )
        )
      ).flat(),
      storage: JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage }
      }),
      databases: (await indexedDB.databases()).map((database) => database.name)
    }));
    expect(
      persistence.cachedUrls.some(
        (url) => new URL(url).pathname === "/index.html"
      )
    ).toBe(true);
    expect(
      persistence.cachedUrls.some((url) =>
        new URL(url).pathname.startsWith("/api/")
      )
    ).toBe(false);
    expect(persistence.databases).toEqual([]);
    expect(persistence.storage).not.toMatch(/(?:data:(?:video|image)\/|blob:)/);
    for (const pair of prepared.pairs) {
      expect(persistence.storage).not.toContain(pair.left.name);
      expect(persistence.storage).not.toContain(pair.right.name);
    }
  } finally {
    await productionContext?.close();
    await rm(fixtureDirectory, { force: true, recursive: true });
    await scanLibrary(page);
  }
});

async function seedVideos() {
  await mkdir(fixtureDirectory, { recursive: true });
  const firstFile = path.join(fixtureDirectory, "video-0.mp4");
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "10",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    "-y",
    firstFile
  ]);
  expect((await stat(firstFile)).size).toBeGreaterThan(rangeBytes);
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      copyFile(firstFile, path.join(fixtureDirectory, `video-${index + 1}.mp4`))
    )
  );
}

async function scanLibrary(page: Page) {
  const cookies = await page.context().cookies();
  const csrfToken = cookies.find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(csrfToken).toBeTruthy();
  const response = await page.request.post("/api/admin/scan", {
    headers: { "x-csrf-token": csrfToken! }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const jobsResponse = await page.request.get("/api/admin/jobs");
        const { jobs } = (await jobsResponse.json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("completed");
}

async function comparisonReady(page: Page) {
  await expect(page.locator(".comparison-choose-surface")).toHaveCount(2);
  await expect(
    page.locator(".comparison-choose-surface").first()
  ).toBeEnabled();
}

async function visibleVideoIds(page: Page): Promise<string[]> {
  return page
    .locator(".comparison-card video[src]")
    .evaluateAll((videos) =>
      videos.map((video) =>
        decodeURIComponent(
          new URL((video as HTMLVideoElement).src).pathname.split("/")[3]!
        )
      )
    );
}

function assetIdFromMediaUrl(url: string): string | null {
  const match = /^\/api\/assets\/([^/]+)\/media$/.exec(new URL(url).pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}
