import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ScanJob, TreeResponse } from "../../apps/web/src/api/client";
import { openAccountMenu } from "./account-menu";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;

async function signInAndScan(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.post("/api/admin/scan", {
    headers: { "x-csrf-token": csrf }
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
  return (await (await page.request.get("/api/tree")).json()) as TreeResponse;
}

for (const phone of [false, true]) {
  test(`keeps deep folders, tag filters and score actions accessible on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
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
    const fixtureName = `Library-details-${randomUUID()}`;
    const fixture = path.resolve(".e2e", "media", fixtureName);
    const parents = [
      fixtureName,
      "An unusually long collection folder name",
      "Another folder with a descriptive long name",
      "The current folder with its full descriptive name"
    ];
    const relativePath = parents.join("/");
    const heldScoreResponses: (() => void)[] = [];
    let scoreWrites = 0;
    async function releaseScoreResponse() {
      await expect.poll(() => heldScoreResponses.length).toBe(1);
      heldScoreResponses.shift()!();
    }
    try {
      const png = await sharp(randomBytes(12), {
        raw: { width: 2, height: 2, channels: 3 }
      })
        .png()
        .toBuffer();
      await mkdir(path.join(fixture, ...parents.slice(1)), { recursive: true });
      await writeFile(
        path.join(fixture, ...parents.slice(1), "details-photo.png"),
        png
      );
      const tree = await signInAndScan(page);
      const folder = tree.folders.find(
        (entry) => entry.relativePath === relativePath
      )!;
      expect(folder).toBeDefined();
      await page.goto(`/?folder=${folder.id}&view=gallery`);
      const breadcrumb = page.locator(".library-folder-breadcrumb");
      const current = breadcrumb.locator('[aria-current="page"]');
      await expect(current).toHaveText(folder.label);
      const currentBounds = await current.boundingBox();
      expect(currentBounds!.width).toBeGreaterThan(40);
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth
      }));
      expect(currentBounds!.x + currentBounds!.width).toBeLessThanOrEqual(
        geometry.width
      );
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width + 1);
      const parentTrigger = breadcrumb.getByRole("button", {
        name: "Show parent folders",
        exact: true
      });
      if (phone) {
        for (const target of [
          breadcrumb.locator(".library-root-folder > button"),
          parentTrigger
        ]) {
          const bounds = await target.boundingBox();
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
        }
      }
      await parentTrigger.press("Enter");
      const parentMenu = page.getByRole("menu", {
        name: "Parent folders",
        exact: true
      });
      await expect(parentMenu.getByRole("menuitem")).toHaveText(
        parents.slice(0, -1)
      );
      await page.keyboard.press("Escape");
      await expect(parentTrigger).toBeFocused();
      await parentTrigger.click();
      await parentMenu
        .getByRole("menuitem", { name: parents[1], exact: true })
        .click();
      await expect(current).toHaveText(parents[1]!);
      const parent = tree.folders.find(
        (entry) => entry.relativePath === parents.slice(0, 2).join("/")
      )!;
      await expect
        .poll(() => new URL(page.url()).searchParams.get("folder"))
        .toBe(parent.id);

      await page.goto(`/?folder=${folder.id}&view=gallery`);
      const options = page.getByRole("button", { name: /^View options/ });
      await options.click();
      const tagInput = page.getByLabel("Tags", { exact: true });
      for (const tag of ["ux-first", "ux-second"]) {
        await tagInput.fill(tag);
        await tagInput.press("Enter");
      }
      const firstTag = page.getByRole("button", {
        name: "Remove ux-first tag filter",
        exact: true
      });
      const secondTag = page.getByRole("button", {
        name: "Remove ux-second tag filter",
        exact: true
      });
      await firstTag.press("Enter");
      await expect(firstTag).toHaveCount(0);
      await expect(secondTag).toBeFocused();
      await secondTag.press("Enter");
      await expect(secondTag).toHaveCount(0);
      await expect(tagInput).toBeFocused();
      await page.getByRole("tab", { name: "Layout", exact: true }).click();
      await page.getByRole("checkbox", { name: "Score", exact: true }).check();
      await page.getByRole("button", { name: "Close view options" }).click();

      await page.route("**/api/assets/*/score", async (route) => {
        if (route.request().method() !== "PATCH") {
          await route.continue();
          return;
        }
        scoreWrites += 1;
        const response = await route.fetch();
        await new Promise<void>((resolve) => heldScoreResponses.push(resolve));
        await route.fulfill({ response });
      });
      const increase = page.getByRole("button", {
        name: /^Increase score for details-photo\.png\. Current score: /,
        exact: false
      });
      const decrease = page.getByRole("button", {
        name: "Decrease score for details-photo.png",
        exact: true
      });
      await expect(decrease).toHaveAttribute("tabindex", "-1");
      await increase.press("Enter");
      await expect(increase).toBeDisabled();
      await expect(increase).toBeFocused();
      await increase.press("Enter");
      await increase.press("Space");
      expect(scoreWrites).toBe(1);
      await releaseScoreResponse();
      await expect(increase).toBeEnabled();
      await expect(increase).toHaveAccessibleName(
        "Increase score for details-photo.png. Current score: 1"
      );
      await expect(increase).toBeFocused();

      await decrease.press("Enter");
      await expect(decrease).toBeDisabled();
      await expect(decrease).toHaveAttribute("tabindex", "-1");
      await expect(increase).toBeFocused();
      await releaseScoreResponse();
      await expect(increase).toBeEnabled();
      await expect(increase).toHaveAccessibleName(
        "Increase score for details-photo.png. Current score: 0"
      );
      await expect(increase).toBeFocused();
      await expect(decrease).toHaveAttribute("tabindex", "-1");

      await increase.press("Enter");
      await releaseScoreResponse();
      await expect(decrease).toBeEnabled();
      await decrease.press("Enter");
      await expect(decrease).toBeDisabled();
      const search = page.getByRole("searchbox", {
        name: "Search",
        exact: true
      });
      await search.focus();
      await releaseScoreResponse();
      await expect(increase).toBeEnabled();
      await expect(increase).toHaveAccessibleName(
        "Increase score for details-photo.png. Current score: 0"
      );
      await expect(search).toBeFocused();
      await increase.press("Enter");
      await releaseScoreResponse();
      await expect(increase).toBeEnabled();
      await expect(decrease).toBeEnabled();
      expect(scoreWrites).toBe(5);

      await increase.focus();
      await page.keyboard.press("Tab");
      await expect(decrease).toBeFocused();
      await expect(decrease).toHaveCSS("outline-style", "solid");
      await expect(decrease).toHaveCSS("outline-width", "2px");
      await expect(increase).toHaveCSS("outline-style", "none");
      await page.keyboard.press("Shift+Tab");
      await expect(increase).toBeFocused();
      await expect(increase).toHaveCSS("outline-width", "2px");
      await expect(decrease).toHaveCSS("outline-style", "none");

      let account = await openAccountMenu(page);
      const activity = account.getByRole("menuitem", {
        name: "Activity",
        exact: true
      });
      await expect(activity).not.toHaveAttribute("aria-haspopup", "dialog");
      await activity.click();
      await expect(
        page.getByRole("heading", { name: "Activity", exact: true })
      ).toBeVisible();
      account = await openAccountMenu(page);
      await expect(
        account.getByRole("menuitem", { name: "Activity", exact: true })
      ).toHaveAttribute("aria-current", "page");
    } finally {
      heldScoreResponses.forEach((release) => release());
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
      await rm(fixture, { recursive: true, force: true });
    }
  });
}
