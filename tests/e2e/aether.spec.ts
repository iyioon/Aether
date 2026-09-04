import { expect, test } from "@playwright/test";

const password = "aether-e2e-password";

test("supports login, scan, batch annotation, fullscreen, and feed", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Aether" })).toBeVisible();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter" }).click();

  await expect(page.getByRole("heading", { name: "media" })).toBeVisible();
  await page.getByRole("button", { name: "Scan library" }).click();

  await expect(page.getByText("Scan complete")).toBeVisible({
    timeout: 15_000
  });
  await expect(page.getByText("7 items indexed")).toBeVisible({
    timeout: 15_000
  });
  const tripsFolder = page.getByRole("treeitem", { name: /Trips/ });
  await expect(tripsFolder).toBeVisible();
  await page.getByRole("button", { name: "Collapse all folders" }).click();
  await expect(tripsFolder).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all folders" }).click();
  await expect(page.getByRole("treeitem", { name: /Trips/ })).toBeVisible();
  const gifPreview = page.getByRole("img", { name: "loop-memory.gif" });
  await expect(gifPreview).toBeVisible();
  await expect(gifPreview).toHaveAttribute("data-preview-source", "original");
  await expect(gifPreview).toHaveAttribute("src", /\/api\/assets\/.+\/media/);
  const webpPreview = page.getByRole("img", { name: "animated-memory.webp" });
  await expect(webpPreview).toBeVisible();
  await expect(webpPreview).toHaveAttribute("data-preview-source", "original");
  await expect(webpPreview).toHaveAttribute("src", /\/api\/assets\/.+\/media/);
  const apngPreview = page.getByRole("img", { name: "apng-candidate.apng" });
  await expect(apngPreview).toBeVisible();
  await expect(apngPreview).toHaveAttribute("data-preview-source", "original");
  await expect(apngPreview).toHaveAttribute("src", /\/api\/assets\/.+\/media/);
  const avifPreview = page.getByRole("img", { name: "avif-candidate.avif" });
  await expect(avifPreview).toBeVisible();
  await expect(avifPreview).toHaveAttribute("data-preview-source", "original");
  await expect(avifPreview).toHaveAttribute("src", /\/api\/assets\/.+\/media/);

  await page.getByLabel("Select family-photo.png").check();
  await page.getByLabel("Select beach-walk.png").check();

  const batchActions = page.getByRole("region", {
    name: "Selected media actions"
  });
  await expect(batchActions).toContainText(/2\s*items selected/);

  await page.getByRole("button", { name: "Set 4 star rating" }).click();
  await expect(batchActions).toContainText("2 items updated.");

  await page.getByPlaceholder("Tag selection").fill("Trip");
  await page.getByRole("button", { name: "Add tag to selected media" }).click();
  await expect(batchActions).toContainText("Trip added to 2 items.");

  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(batchActions).toHaveCount(0);

  await page.getByPlaceholder("Any tag").fill("Trip");
  await page.keyboard.press("Enter");
  await expect(page.getByText("2 items indexed")).toBeVisible();

  await page.getByRole("img", { name: "family-photo.png" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("family-photo.png");
  await page.getByRole("button", { name: "Suggest tags" }).click();
  await expect(viewer.getByRole("button", { name: /Family/ })).toBeVisible();
  await viewer.getByRole("button", { name: /Family/ }).click();
  await expect(viewer).toContainText("Family");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  await page.getByRole("button", { name: "Feed view" }).click();
  const feed = page.getByRole("region", { name: "Feed view" });
  await expect(feed).toBeVisible();
  await expect(page.getByText("family-photo.png")).toBeVisible();

  const feedScroller = page.locator(".feed-view");
  await feedScroller.evaluate((element) => element.scrollTo({ top: 0 }));
  const initialFeedScroll = await feedScroller.evaluate((element) => element.scrollTop);
  const feedBox = await feedScroller.boundingBox();

  expect(feedBox).not.toBeNull();
  await page.mouse.move(
    (feedBox?.x ?? 0) + (feedBox?.width ?? 0) / 2,
    (feedBox?.y ?? 0) + (feedBox?.height ?? 0) / 2
  );
  await page.mouse.wheel(0, 640);
  await expect
    .poll(async () => feedScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(initialFeedScroll);

  const scrolledFeedTop = await feedScroller.evaluate((element) => element.scrollTop);
  await feed.focus();
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => feedScroller.evaluate((element) => element.scrollTop))
    .toBeLessThan(scrolledFeedTop);
});
