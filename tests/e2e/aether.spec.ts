import { expect, test } from "@playwright/test";

const password = "aether-e2e-password";

test("supports login, scan, batch annotation, fullscreen, and feed", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByText("Aether", { exact: true })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter" }).click();

  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Scan library" }).click();

  await expect(page.getByText("Scan complete")).toBeVisible({
    timeout: 15_000
  });
  await expect(
    page.getByRole("treeitem", { name: "media, 5 items" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("treeitem", { name: "Trips, 2 items" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("radio", { name: "Mist" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "mist");
  await expect
    .poll(async () =>
      page.locator(".settings-page").evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      )
    )
    .toBe(true);
  await page.getByRole("tab", { name: "Server" }).click();
  await expect(page.getByText("Password protected")).toBeVisible();
  await expect(page.getByText("test-session-secret")).toHaveCount(0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();
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

  await page.getByRole("button", { name: "Select media" }).click();
  await page.getByRole("button", { name: "Select family-photo.png" }).click();
  await page.getByRole("button", { name: "Select beach-walk.png" }).click();

  const batchActions = page.locator('[aria-label="Selected media actions"]');
  await expect(batchActions).toContainText(/2\s*items selected/);

  await batchActions
    .getByRole("button", { name: "Increase score to 1" })
    .click();
  await batchActions
    .getByRole("region", { name: "Score and favorite" })
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await expect(page.getByText("2 items updated.")).toBeVisible();

  await batchActions.getByRole("textbox", { name: "Tag name" }).fill("Trip");
  await batchActions
    .getByRole("form", { name: "Tag selected media" })
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await expect(page.getByText("Trip added to 2 items.")).toBeVisible();

  await batchActions.getByRole("button", { name: "Done selecting" }).click();
  await expect(batchActions).toHaveCount(0);

  await page.getByRole("button", { name: /^Filters:/ }).click();
  await page.getByRole("textbox", { name: "Tags" }).fill("Trip");
  await page.keyboard.press("Enter");
  const filteredGallery = page.getByRole("region", { name: "Gallery view" });
  await expect(
    filteredGallery.getByRole("img", { name: "family-photo.png" })
  ).toBeVisible();
  await expect(
    filteredGallery.getByRole("img", { name: "beach-walk.png" })
  ).toBeVisible();
  await expect(
    filteredGallery.getByRole("img", { name: "city-night.png" })
  ).toHaveCount(0);

  await page.getByRole("img", { name: "family-photo.png" }).click();
  const viewer = page.locator(".viewer-dialog");
  await expect(viewer).toBeVisible();
  await viewer
    .getByRole("button", { name: "Show info for family-photo.png" })
    .click();

  const details = page.locator(".media-info-sheet");
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Suggest tags" }).click();
  await expect(details.getByRole("button", { name: /Family/ })).toBeVisible();
  await details.getByRole("button", { name: /Family/ }).click();
  await expect(details).toContainText("Family");
  await details.getByRole("button", { name: "Close" }).click();
  await expect(details).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  await page.getByRole("button", { name: "Feed view" }).click();
  const feed = page.getByRole("region", { name: "Feed view" });
  await expect(feed).toBeVisible();
  await expect(page.getByText("family-photo.png")).toBeVisible();
  const feedImage = feed.getByRole("img", { name: "family-photo.png" });
  await expect(feedImage).toHaveAttribute("data-preview-source", "original");
  await expect(feedImage).toHaveAttribute("src", /\/api\/assets\/.+\/media/);

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

test("collapses the desktop sidebar without breaking the mobile drawer", async ({
  page
}) => {
  await page.goto("/");

  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();

  const sidebarToggle = page.getByRole("button", { name: "Toggle Sidebar" });
  await sidebarToggle.click();

  await expect(
    page.locator('[data-slot="sidebar"][data-state="collapsed"]')
  ).toBeVisible();
  await expect(page.locator("#library-sidebar")).toHaveCSS(
    "left",
    /-\d+px/
  );

  const breadcrumb = page.locator(".library-path-navigation nav");
  await expect(sidebarToggle).toBeVisible();
  await expect(breadcrumb.getByText("media", { exact: true })).toBeVisible();

  const toggleBox = await sidebarToggle.boundingBox();
  const breadcrumbBox = await breadcrumb.boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(breadcrumbBox).not.toBeNull();
  expect(toggleBox!.x).toBeLessThan(breadcrumbBox!.x);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebarToggle).toBeVisible();
  await sidebarToggle.click();

  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();
});
