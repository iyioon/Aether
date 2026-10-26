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
      page
        .locator(".settings-page")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
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
  await expect(webpPreview).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      webpPreview.evaluate((node) => {
        if (!(node instanceof HTMLCanvasElement)) return false;
        const pixel = node.getContext("2d")?.getImageData(0, 0, 1, 1).data;
        return Boolean(pixel && pixel[3] === 255 && pixel[0]! > 0);
      })
    )
    .toBe(true);
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

  await batchActions.getByRole("checkbox", { name: "Change score" }).click();
  await batchActions
    .getByRole("button", {
      name: "Increase score for selected media. Current score: 0"
    })
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

  await page.getByRole("button", { name: /^View options/ }).click();
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
  await expect(
    feed.getByRole("img", { name: "family-photo.png" })
  ).toBeVisible();
  await expect(feed.locator(".feed-meta-button")).toHaveCount(0);
  const feedImage = feed.getByRole("img", { name: "family-photo.png" });
  await expect(feedImage).toHaveAttribute("data-preview-source", "original");
  await expect(feedImage).toHaveAttribute("src", /\/api\/assets\/.+\/media/);

  const feedScroller = page.locator(".feed-view");
  await feedScroller.evaluate((element) => element.scrollTo({ top: 0 }));
  const initialFeedScroll = await feedScroller.evaluate(
    (element) => element.scrollTop
  );
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

  const scrolledFeedTop = await feedScroller.evaluate(
    (element) => element.scrollTop
  );
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
  const desktopSidebar = page.locator('[data-slot="sidebar"]');
  const sidebarGap = page.locator('[data-slot="sidebar-gap"]');
  const sidebarPanel = page.locator("#library-sidebar");
  await sidebarToggle.click();

  await expect(desktopSidebar).toHaveAttribute("data-state", "collapsed");
  // The collapsed wrapper has zero width once its transition finishes.
  await expect(sidebarGap).toHaveCSS("width", "0px");
  await expect(sidebarPanel).not.toBeInViewport();

  const breadcrumb = page.locator(".library-path-navigation nav");
  await expect(sidebarToggle).toBeVisible();
  await expect(breadcrumb.getByText("media", { exact: true })).toBeVisible();

  const toggleBox = await sidebarToggle.boundingBox();
  const breadcrumbBox = await breadcrumb.boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(breadcrumbBox).not.toBeNull();
  expect(toggleBox!.x).toBeLessThan(breadcrumbBox!.x);

  await sidebarToggle.click();
  await expect(desktopSidebar).toHaveAttribute("data-state", "expanded");
  await expect(sidebarPanel).toHaveCSS("left", "0px");
  await expect(sidebarPanel).toBeInViewport({ ratio: 1 });
  await sidebarToggle.click();
  await expect(sidebarGap).toHaveCSS("width", "0px");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebarToggle).toBeVisible();
  await sidebarToggle.click();

  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
});

test("recovers from server and session interruptions and restores navigation", async ({
  context,
  page
}) => {
  let serverAvailable = false;
  await page.route("**/api/auth/me", async (route) => {
    if (!serverAvailable) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporarily_unavailable" })
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Aether is unavailable" })
  ).toBeVisible();

  serverAvailable = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter" }).click();

  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByText("Scan complete")).toBeVisible({
    timeout: 15_000
  });

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Compare and rank" }).click();
  await expect(
    page.getByRole("heading", { name: "Leaderboard" })
  ).toBeVisible();
  await page
    .locator(".leaderboard-header")
    .getByRole("button", { name: "Rank media", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Leaderboard" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Leaderboard" })).toBeVisible();

  // Hold new reads so a background 401 cannot remove the button before its click.
  let releaseExpiredRequests!: () => void;
  const expiredRequests = new Promise<void>((resolve) => {
    releaseExpiredRequests = resolve;
  });
  await page.route("**/api/**", async (route) => {
    await expiredRequests;
    await route.continue().catch(() => undefined);
  });
  try {
    await context.clearCookies();
    await page.getByRole("button", { name: "Leaderboard" }).click();
  } finally {
    releaseExpiredRequests();
  }
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByText(/session expired/i)).toBeVisible();
});
