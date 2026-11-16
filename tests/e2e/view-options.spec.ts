import { chooseAccountAction } from "./account-menu";
import { expect, test, type Page } from "@playwright/test";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByText("Scan complete")).toBeVisible();
});

test("applies and restores sort and gallery layout independently of search", async ({
  page
}) => {
  const trigger = page.getByRole("button", { name: /^View options/ });
  const panel = page.getByRole("dialog", { name: "View options", exact: true });
  await expect(
    page.getByRole("region", { name: "Library controls" }).getByRole("button")
  ).toHaveCount(3);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Layout", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    panel.getByRole("tab", { name: "Sort", exact: true })
  ).toBeFocused();
  await panel.getByRole("combobox", { name: "Sort field 1" }).click();
  await page.getByRole("option", { name: "Filename", exact: true }).click();
  await expect(
    panel.getByRole("combobox", { name: "Sort direction 1" })
  ).toHaveText("A to Z");
  await panel.getByRole("combobox", { name: "Sort direction 1" }).click();
  await page.getByRole("option", { name: "Z to A", exact: true }).click();
  await expectQuery(page, {
    sort: "filename",
    order: "desc",
    sortBy: "filename:desc"
  });
  await panel.getByRole("checkbox", { name: "Random order" }).check();
  await expect(
    panel.getByRole("combobox", { name: "Sort direction 1" })
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Close view options" }).click();
  await trigger.click();
  await panel.getByRole("tab", { name: "Sort", exact: true }).click();
  await panel.getByRole("checkbox", { name: "Random order" }).uncheck();
  await expect(
    panel.getByRole("combobox", { name: "Sort field 1" })
  ).toHaveText("Filename");
  await expect(
    panel.getByRole("combobox", { name: "Sort direction 1" })
  ).toHaveText("Z to A");
  await panel.getByRole("combobox", { name: "Sort direction 1" }).click();
  await page.getByRole("option", { name: "A to Z", exact: true }).click();

  await panel.getByRole("tab", { name: "Layout", exact: true }).click();
  await panel.getByRole("combobox", { name: "Grid size" }).click();
  await page.getByRole("option", { name: "Large", exact: true }).click();
  await panel.getByRole("combobox", { name: "Media layout" }).click();
  await page.getByRole("option", { name: "Landscape", exact: true }).click();
  await expect(page.locator(".virtual-gallery")).toHaveAttribute(
    "data-aspect",
    "Landscape"
  );
  await expect(page.locator(".tile-meta").first()).toBeVisible();
  await panel.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
  await panel.getByRole("checkbox", { name: "Tags", exact: true }).check();
  await expect(page.locator(".tile-meta")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.reload();
  await trigger.click();
  await expectQuery(page, {
    sort: "filename",
    order: null,
    sortBy: "filename:asc",
    size: "large",
    aspect: "landscape"
  });
  await panel.getByRole("tab", { name: "Layout", exact: true }).click();
  await expect(
    panel.getByRole("checkbox", { name: "Title", exact: true })
  ).not.toBeChecked();
  await expect(
    panel.getByRole("checkbox", { name: "Tags", exact: true })
  ).toBeChecked();
  await panel.getByRole("button", { name: "Card info options" }).click();
  await page.getByRole("menuitem", { name: "Hide all" }).click();
  await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Card info options" }).click();
  await page.getByRole("menuitem", { name: "Restore defaults" }).click();
  await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(3);
});

test("keeps view options scoped to the current view and dismisses nested controls correctly", async ({
  page
}) => {
  const trigger = page.getByRole("button", { name: /^View options/ });
  const panel = page.getByRole("dialog", { name: "View options", exact: true });
  await trigger.click();
  await panel.getByRole("tab", { name: "Layout", exact: true }).click();
  await panel.getByRole("combobox", { name: "Grid size" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(panel).toHaveClass(/view-options-sheet/);
  await expect(
    panel.getByRole("tab", { name: "Layout", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 1440, height: 980 });
  await expect(panel).toHaveClass(/view-options-popover/);
  await panel.getByRole("combobox", { name: "Grid size" }).press("/");
  await expect(
    page.getByRole("dialog", { name: "Search", exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const searchDialog = page.getByRole("dialog", {
    name: "Search",
    exact: true
  });
  await expect(searchDialog).toBeVisible();
  await searchDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Feed view", exact: true }).click();
  await trigger.click();
  await expect(panel.getByRole("tab")).toHaveText(["Sort", "Layout"]);
  await panel.getByRole("button", { name: "Close view options" }).click();
  await page
    .getByRole("button", { name: "Compare and rank", exact: true })
    .click();
  await trigger.click();
  await expect(panel.getByRole("tab")).toHaveCount(0);
  await expect(
    panel.getByRole("combobox", { name: "Media layout", exact: true })
  ).toBeVisible();
  await expect(
    panel.getByRole("radiogroup", { name: "Media filters" })
  ).toHaveCount(0);
  await chooseAccountAction(page, "Settings");
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

for (const phone of [false, true]) {
  test(`preserves focus moved during view options dismissal (${phone ? "phone" : "desktop"})`, async ({
    page
  }) => {
    await page.setViewportSize(
      phone ? { width: 393, height: 852 } : { width: 1440, height: 980 }
    );
    await page.addStyleTag({
      content:
        '.view-options-panel[data-state="closed"] { animation-duration: 400ms !important; }'
    });
    const trigger = page.getByRole("button", {
      name: "View options",
      exact: true
    });
    const panel = page.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    const search = page.getByRole("button", { name: "Search", exact: true });
    await trigger.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close view options" }).click();
    await search.focus();
    await expect(panel).toHaveCount(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(search).toBeFocused();
    await page.keyboard.press("Enter");
    const searchDialog = page.getByRole("dialog", {
      name: "Search",
      exact: true
    });
    await expect(searchDialog).toBeVisible();
    await expect(panel).toHaveCount(0);
    await searchDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(search).toBeFocused();
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close view options" }).click();
    await trigger.click();
    await expect(panel).toHaveAttribute("data-state", "open");
    const randomOrder = panel.getByRole("checkbox", {
      name: "Random order",
      exact: true
    });
    await randomOrder.focus();
    await panel.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
    await expect(randomOrder).toBeFocused();
    await expect(page.locator(".view-options-trigger")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    if (phone) {
      await expect(search).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    }
    await search.click();
    await expect(searchDialog).toBeVisible();
    await expect(panel).toHaveCount(0);
    const filename = searchDialog.getByRole("searchbox", {
      name: "Filename or path",
      exact: true
    });
    await expect(filename).toBeFocused();
  });
}

test("remembers independent layout and card info in Gallery, Feed and Ranking", async ({
  page
}) => {
  const trigger = page.getByRole("button", { name: /^View options/ });
  const panel = page.getByRole("dialog", { name: "View options", exact: true });
  async function layout(aspect: string | null, title: boolean) {
    await trigger.click();
    await expect(panel).toBeVisible();
    const layoutTab = panel.getByRole("tab", { name: "Layout", exact: true });
    if (await layoutTab.count()) await layoutTab.click();
    if (aspect) {
      await panel.getByRole("combobox", { name: "Media layout" }).click();
      await page.getByRole("option", { name: aspect, exact: true }).click();
    } else
      await expect(
        panel.getByRole("combobox", { name: "Media layout" })
      ).toHaveCount(0);
    await panel
      .getByRole("checkbox", { name: "Title", exact: true })
      .setChecked(title);
    await panel.getByRole("button", { name: "Close view options" }).click();
  }
  await layout("Portrait", true);
  await page.getByRole("button", { name: "Feed view", exact: true }).click();
  await expect(page.locator(".feed-item").first()).toHaveAttribute(
    "data-aspect",
    "Portrait"
  );
  await expect(page.locator(".feed-meta-button")).toHaveCount(0);
  await layout(null, true);
  await expect(page.locator(".feed-meta-button").first()).toBeVisible();
  const frame = (await page.locator(".feed-frame").first().boundingBox())!;
  expect(frame.width).toBeLessThan(frame.height);
  expect(frame.width).toBeLessThanOrEqual(470);
  await page
    .getByRole("button", { name: "Compare and rank", exact: true })
    .click();
  await page
    .locator(".leaderboard-header")
    .getByRole("button", { name: "Rank media", exact: true })
    .click();
  const cards = page.locator(".comparison-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute("data-aspect", "Original");
  await expect(cards.locator(".media-card-info")).toHaveCount(0);
  const ids = await cards.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-asset-id"))
  );
  await layout("Landscape", true);
  await expect(cards.locator(".media-card-info")).toHaveCount(2);
  expect(
    await cards.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-asset-id"))
    )
  ).toEqual(ids);
  await expect(cards.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await page.reload();
  await expect(cards.first()).toHaveAttribute("data-aspect", "Landscape");
  await page.getByRole("button", { name: "Feed view", exact: true }).click();
  await expect(page.locator(".feed-item").first()).toHaveAttribute(
    "data-aspect",
    "Portrait"
  );
  await expect(page.locator(".feed-meta-button").first()).toBeVisible();
  await page.getByRole("button", { name: "Gallery view", exact: true }).click();
  await expect(page.locator(".virtual-gallery")).toHaveAttribute(
    "data-aspect",
    "Portrait"
  );
});

test("restores gallery content when a pending sort returns to the previous query", async ({
  page
}) => {
  const trigger = page.getByRole("button", { name: /^View options/ });
  const panel = page.getByRole("dialog", { name: "View options", exact: true });
  const gallery = page.getByRole("region", { name: "Gallery view" });
  await trigger.click();
  await panel.getByRole("tab", { name: "Sort", exact: true }).click();
  await panel.getByRole("combobox", { name: "Sort field 1" }).click();
  await page.getByRole("option", { name: "Filename", exact: true }).click();
  await expectQuery(page, {
    sort: "filename",
    order: null,
    sortBy: "filename:asc"
  });
  await expect(gallery).toHaveAttribute("aria-busy", "false");
  let heldDescending = false;
  let releaseDescending!: () => void;
  const descendingDelay = new Promise<void>((resolve) => {
    releaseDescending = resolve;
  });
  await page.route("**/api/folders/*/assets?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("sortBy") === "filename:desc") {
      heldDescending = true;
      await descendingDelay;
    }
    await route.continue().catch(() => undefined);
  });
  try {
    await panel.getByRole("combobox", { name: "Sort direction 1" }).click();
    await page.getByRole("option", { name: "Z to A", exact: true }).click();
    await expect.poll(() => heldDescending).toBe(true);
    await expect(gallery).toHaveAttribute("aria-busy", "true");
    const ascendingResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/assets") &&
        url.searchParams.get("sortBy") === "filename:asc" &&
        response.ok()
      );
    });
    await panel.getByRole("combobox", { name: "Sort direction 1" }).click();
    await page.getByRole("option", { name: "A to Z", exact: true }).click();
    await ascendingResponse;
    await expect(gallery).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".virtual-gallery")).not.toHaveClass(
      /is-scroll-pending/
    );
    await expect(page.locator(".tile-meta").first()).toBeVisible();
  } finally {
    releaseDescending();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("keeps phone layout controls reachable after rotation and in a short viewport", async ({
  browser,
  page
}) => {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    serviceWorkers: "block"
  });
  try {
    const phone = await context.newPage();
    const cdp = await context.newCDPSession(phone);
    await phone.goto(`${productionBaseURL}/?view=gallery`);
    const trigger = phone.getByRole("button", {
      name: "View options",
      exact: true
    });
    await trigger.tap();
    const panel = phone.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await panel.getByRole("tab", { name: "Layout", exact: true }).tap();
    const playback = panel.locator(".view-options-playback");
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 852 },
      { width: 932, height: 430 },
      { width: 393, height: 360 }
    ]) {
      await phone.setViewportSize(viewport);
      const landscape = viewport.width > viewport.height;
      const insets = {
        top: landscape ? 0 : 59,
        bottom: 34,
        left: landscape ? 44 : 0,
        right: landscape ? 44 : 0
      };
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
      await expect(panel).toHaveClass(/view-options-sheet/);
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect(
        panel.getByRole("tab", { name: "Layout", exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        panel.getByRole("button", { name: "Close view options" })
      ).toBeInViewport({ ratio: 1 });
      await expect(playback).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() =>
          panel.evaluate((node) => node.scrollWidth <= node.clientWidth)
        )
        .toBe(true);
      const bounds = (await panel.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(insets.top);
      expect(bounds.x).toBeGreaterThanOrEqual(insets.left);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        viewport.width - insets.right
      );
      const playbackBounds = (await playback.boundingBox())!;
      expect(playbackBounds.y + playbackBounds.height).toBeLessThanOrEqual(
        viewport.height - insets.bottom
      );
      const grid = panel.getByRole("combobox", { name: "Grid size" });
      await grid.scrollIntoViewIfNeeded();
      await grid.tap();
      await phone.getByRole("option", { name: "Tiny", exact: true }).tap();
    }
    await panel.getByRole("button", { name: "Close view options" }).tap();
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.tap();
    await phone.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

async function expectQuery(page: Page, values: Record<string, string | null>) {
  await expect
    .poll(() => {
      const params = new URL(page.url()).searchParams;
      return Object.fromEntries(
        Object.keys(values).map((key) => [key, params.get(key)])
      );
    })
    .toEqual(values);
}
