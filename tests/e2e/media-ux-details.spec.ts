import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const folderName = "media-ux-details-fixture";
const directory = path.resolve(".e2e/media", folderName);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let folderId: string;
let assets: AssetRecord[];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    await page
      .getByLabel("Password", { exact: true })
      .fill("aether-e2e-password");
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Gallery view" })
    ).toBeVisible();
    await mkdir(directory, { recursive: true });
    for (let index = 0; index < 3; index += 1)
      await sharp({
        create: {
          width: 120,
          height: 160,
          channels: 3,
          background: ["#547893", "#937854", "#549378"][index]!
        }
      })
        .png()
        .toFile(path.join(directory, `detail-${index}.png`));
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
    expect(assets).toHaveLength(3);
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
  const options = {
    viewport: phone
      ? { width: 393, height: 852 }
      : { width: 1440, height: 980 },
    isMobile: phone,
    hasTouch: phone
  };

  test(`opens score details without voting and names comparison coverage (${layout})`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState, ...options });
    try {
      await context.addInitScript(() =>
        localStorage.setItem(
          "aether.compare.metadata-fields",
          JSON.stringify(["score"])
        )
      );
      const page = await context.newPage();
      let choices = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          /\/api\/comparisons(?:\?|$)/.test(request.url())
        )
          choices += 1;
      });
      await page.goto(
        `${origin}/?folder=${folderId}&view=compare&workspace=ranking`
      );
      const cards = page.locator(".comparison-card[data-asset-id]");
      await expect(cards).toHaveCount(2);
      const originalPair = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-asset-id"))
      );
      const coverage = page.getByRole("progressbar", {
        name: "Comparison coverage",
        exact: true
      });
      await expect(coverage).toHaveAttribute(
        "aria-valuetext",
        /\d+ of 3 items compared/
      );
      const score = cards
        .first()
        .getByRole("button", { name: /Show score breakdown/ });
      if (phone) await score.tap();
      else await score.press("Enter");
      const details = page.getByRole("dialog", {
        name: "Score breakdown",
        exact: true
      });
      await expect(details).toBeVisible();
      await expect(details).toContainText("Manual score");
      await page.keyboard.press("ArrowRight");
      expect(
        await cards.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-asset-id"))
        )
      ).toEqual(originalPair);
      await page.keyboard.press("Escape");
      await expect(details).toHaveCount(0);
      await expect(score).toBeFocused();
      await expect(page.locator(".comparison-view")).toBeVisible();
      expect(choices).toBe(0);
    } finally {
      await context.close();
    }
  });

  test(`preserves pinch gestures and pages without reduced-motion animation (${layout})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      ...options,
      reducedMotion: "reduce"
    });
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/?folder=${folderId}&view=feed&sort=filename`);
      const feed = page.getByRole("region", { name: "Feed view", exact: true });
      await expect(feed).toHaveAttribute("aria-busy", "false");
      const viewport = feed.locator(".feed-view");
      await expect(viewport).toHaveCSS("touch-action", "pan-y pinch-zoom");
      await expect
        .poll(() =>
          viewport.evaluate((node) => getComputedStyle(node).scrollBehavior)
        )
        .toBe("auto");
      await feed.evaluate((node) => {
        node.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: 180,
            ctrlKey: true
          })
        );
        const touch = (identifier: number, y: number) =>
          new Touch({ identifier, target: node, clientX: 80, clientY: y });
        node.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [touch(1, 500)],
            changedTouches: [touch(1, 500)]
          })
        );
        node.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [touch(1, 500), touch(2, 400)],
            changedTouches: [touch(2, 400)]
          })
        );
        node.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            touches: [],
            changedTouches: [touch(1, 200), touch(2, 300)]
          })
        );
        node.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [touch(3, 500)],
            changedTouches: [touch(3, 500)]
          })
        );
        // The second finger can begin outside Feed; its movement must still cancel paging.
        node.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            touches: [touch(3, 450), touch(4, 400)],
            changedTouches: [touch(3, 450)]
          })
        );
        node.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            touches: [],
            changedTouches: [touch(3, 200)]
          })
        );
      });
      await feed.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      await expect
        .poll(() => viewport.evaluate((node) => node.scrollTop))
        .toBe(0);
      await feed.focus();
      await feed.press("ArrowDown");
      await expect
        .poll(() =>
          viewport.evaluate((node) => node.scrollTop / node.clientHeight)
        )
        .toBe(1);
    } finally {
      await context.close();
    }
  });

  test(`finishes failed tag loading without enabling writes and recovers on retry (${layout})`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState, ...options });
    const page = await context.newPage();
    const asset = assets[phone ? 1 : 0]!;
    let reads = 0;
    let writes = 0;
    let releaseRetry = () => {};
    try {
      await page.route(
        `${origin}/api/assets/${asset.id}/tags`,
        async (route) => {
          if (route.request().method() !== "GET") {
            writes += 1;
            await route.abort();
            return;
          }
          reads += 1;
          if (reads % 2 === 1) {
            await route.fulfill({
              status: 503,
              json: { error: "unavailable" }
            });
            return;
          }
          await new Promise<void>((resolve) => {
            releaseRetry = resolve;
          });
          await route.fulfill({
            json: {
              tags: [
                {
                  id: "retained-tag",
                  displayName: "Retained tag",
                  normalizedName: "retained tag",
                  usageCount: 1
                }
              ]
            }
          });
        }
      );
      await page.goto(
        `${origin}/?folder=${folderId}&view=gallery&sort=filename`
      );
      const card = page.getByRole("button", {
        name: `Open ${asset.name}`,
        exact: true
      });
      for (const moveFocus of [false, true]) {
        await card.focus();
        await card.press("Shift+F10");
        await page.getByRole("menuitem", { name: "Info", exact: true }).click();
        const info = page.locator(".media-info-sheet");
        const input = info.getByRole("textbox", {
          name: "Add a tag",
          exact: true
        });
        const group = info.getByRole("group", { name: "Add tag", exact: true });
        const retry = info.getByRole("button", {
          name: "Retry tags",
          exact: true
        });
        await expect(info.getByRole("alert")).toHaveText(
          "Tags could not be loaded. Try again."
        );
        await expect(group).toHaveAttribute("aria-busy", "false");
        await expect(input).toBeDisabled();
        await expect(
          info.getByRole("button", { name: "Add tag", exact: true })
        ).toBeDisabled();
        const close = info.getByRole("button", { name: "Close", exact: true });
        await expect(close).toBeEnabled();
        await retry.press("Enter");
        await expect(group).toHaveAttribute("aria-busy", "true");
        await expect(input).toBeDisabled();
        await expect(retry).toBeVisible();
        await expect(retry).toBeDisabled();
        await expect(retry).toBeFocused();
        await expect.poll(() => reads).toBe(moveFocus ? 4 : 2);
        await retry.press("Enter");
        expect(reads).toBe(moveFocus ? 4 : 2);
        await expect(
          info.getByRole("status").filter({ hasText: "Loading tags…" })
        ).toBeVisible();
        const score = info.getByRole("button", {
          name: new RegExp(`Increase score for ${asset.name}`)
        });
        if (moveFocus) await score.focus();
        releaseRetry();
        await expect(group).toHaveAttribute("aria-busy", "false");
        await expect(input).toBeEnabled();
        await expect(
          info.getByRole("button", { name: "Remove Retained tag", exact: true })
        ).toBeVisible();
        await expect(info.getByRole("alert")).toHaveCount(0);
        await expect(retry).toHaveCount(0);
        await expect(moveFocus ? score : input).toBeFocused();
        await close.click();
        await expect(info).toHaveCount(0);
      }
      expect(reads).toBe(4);
      expect(writes).toBe(0);
    } finally {
      releaseRetry();
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  });

  test(`announces tag work and preserves editing focus without stealing it (${layout})`, async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState, ...options });
    const page = await context.newPage();
    const asset = assets[phone ? 1 : 0]!;
    const tagsUrl = `${origin}/api/assets/${asset.id}/tags`;
    let releaseRead = () => {};
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let releaseSave = () => {};
    let saveWaiting = false;
    try {
      const token = (await context.cookies()).find(
        (cookie) => cookie.name === "aether_csrf"
      )!.value;
      expect(
        (
          await page.request.put(tagsUrl, {
            headers: { "x-csrf-token": token },
            data: { tags: [] }
          })
        ).ok()
      ).toBe(true);
      await page.route(tagsUrl, async (route) => {
        const response = await route.fetch();
        if (route.request().method() === "GET") await readGate;
        else if (route.request().method() === "PUT") {
          saveWaiting = true;
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
        }
        await route.fulfill({ response });
        saveWaiting = false;
      });
      await page.goto(
        `${origin}/?folder=${folderId}&view=gallery&sort=filename`
      );
      const card = page.getByRole("button", {
        name: `Open ${asset.name}`,
        exact: true
      });
      await card.focus();
      await card.press("Shift+F10");
      await page.getByRole("menuitem", { name: "Info", exact: true }).click();
      const info = page.locator(".media-info-sheet");
      const input = info.getByRole("textbox", {
        name: "Add a tag",
        exact: true
      });
      const close = info.getByRole("button", { name: "Close", exact: true });
      await expect(
        info.getByRole("status").filter({ hasText: "Loading tags…" })
      ).toBeVisible();
      await expect(input).toBeDisabled();
      releaseRead();
      await expect(input).toBeEnabled();
      await input.fill("Detail alpha");
      await input.press("Enter");
      await expect.poll(() => saveWaiting).toBe(true);
      await expect(
        info.getByRole("status").filter({ hasText: "Saving tags…" })
      ).toBeVisible();
      await expect(
        info.getByRole("group", { name: "Add tag", exact: true })
      ).toHaveAttribute("aria-busy", "true");
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("readonly", "");
      await expect(close).toBeVisible();
      await expect(close).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(info).toBeVisible();
      releaseSave();
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();

      await input.fill("Detail beta");
      await info.getByRole("button", { name: "Add tag", exact: true }).click();
      await expect.poll(() => saveWaiting).toBe(true);
      releaseSave();
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();

      const removeAlpha = info.getByRole("button", {
        name: "Remove Detail alpha",
        exact: true
      });
      await removeAlpha.click();
      await expect.poll(() => saveWaiting).toBe(true);
      releaseSave();
      await expect(removeAlpha).toHaveCount(0);
      const removeBeta = info.getByRole("button", {
        name: "Remove Detail beta",
        exact: true
      });
      await expect(removeBeta).toBeFocused();
      await removeBeta.click();
      await expect.poll(() => saveWaiting).toBe(true);
      releaseSave();
      await expect(removeBeta).toHaveCount(0);
      await expect(input).toBeFocused();

      await input.fill("Detail gamma");
      await input.press("Enter");
      await expect.poll(() => saveWaiting).toBe(true);
      const score = info.getByRole("button", {
        name: new RegExp(`Increase score for ${asset.name}`)
      });
      await score.focus();
      releaseSave();
      await expect(input).toHaveValue("");
      await expect(score).toBeFocused();
      await close.click();
      await expect(info).toHaveCount(0);
    } finally {
      releaseRead();
      releaseSave();
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  });
}

async function scan(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: { "x-csrf-token": token }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(async () => {
      const { jobs } = (await (
        await page.request.get(`${origin}/api/admin/jobs`)
      ).json()) as { jobs: ScanJob[] };
      return jobs.find((job) => job.id === jobId)?.status;
    })
    .toBe("completed");
}
