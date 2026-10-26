import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByText("Scan complete")).toBeVisible();
});

test("applies and restores sort, filters, and gallery layout from one panel", async ({
  page
}) => {
  const trigger = page.getByRole("button", { name: /^View options/ });
  const panel = page.getByRole("dialog", { name: "View options", exact: true });
  await expect(
    page.getByRole("region", { name: "Library controls" }).getByRole("button")
  ).toHaveCount(2);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Filters", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    panel.getByRole("tab", { name: "Sort", exact: true })
  ).toBeFocused();
  await panel.getByRole("radio", { name: "Filename", exact: true }).check();
  await expect(panel.getByRole("radio", { name: "Ascending" })).toBeChecked();
  await panel.getByRole("radio", { name: "Descending" }).check();
  await expectQuery(page, { sort: "filename", order: "desc" });
  await panel.getByRole("radio", { name: "Random", exact: true }).check();
  await expect(
    panel.getByRole("radiogroup", { name: "Sort direction" })
  ).toHaveCount(0);
  await panel.getByRole("radio", { name: "Filename", exact: true }).check();

  await panel.getByRole("tab", { name: "Layout", exact: true }).click();
  await panel.getByRole("combobox", { name: "Grid size" }).click();
  await page.getByRole("option", { name: "Large", exact: true }).click();
  await panel.getByRole("combobox", { name: "Aspect ratio" }).click();
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

  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("family");
  await expectQuery(page, { q: "family" });
  await trigger.click();
  await panel.getByRole("tab", { name: "Filters", exact: true }).click();
  await panel.getByRole("radio", { name: "Images", exact: true }).check();
  await panel.getByRole("radio", { name: "Favorites", exact: true }).check();
  const tags = panel.getByRole("textbox", { name: "Tags", exact: true });
  await tags.fill("Travel");
  await tags.press("Enter");
  await tags.fill("travel");
  await expect(
    panel.getByRole("button", { name: "Add tag filter" })
  ).toBeDisabled();
  await tags.press("Enter");
  await expectQuery(page, { type: "image", score: "favorites", tag: "Travel" });
  await expect(trigger).toHaveAccessibleName("View options, 3 active filters");
  await panel.getByRole("button", { name: "Close view options" }).click();
  await page.reload();
  await trigger.click();
  await expect(
    panel.getByRole("radio", { name: "Images", exact: true })
  ).toBeChecked();
  await expect(
    panel.getByRole("radio", { name: "Favorites", exact: true })
  ).toBeChecked();
  await expect(
    panel.getByRole("button", { name: "Remove Travel tag filter" })
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(trigger).toHaveAccessibleName("View options");
  await expectQuery(page, {
    type: null,
    score: null,
    tag: null,
    q: "family",
    sort: "filename",
    order: null,
    size: "large",
    aspect: "landscape"
  });
  await expect(
    page.getByRole("img", { name: "family-photo.png" })
  ).toBeVisible();
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
    page.getByRole("searchbox", { name: "Search" })
  ).not.toBeFocused();
  await page.getByRole("searchbox", { name: "Search" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Feed view", exact: true }).click();
  await trigger.click();
  await expect(panel.getByRole("tab")).toHaveText(["Filters", "Sort"]);
  await panel.getByRole("button", { name: "Close view options" }).click();
  await page
    .getByRole("button", { name: "Compare and rank", exact: true })
    .click();
  await trigger.click();
  await expect(panel.getByRole("tablist")).toHaveCount(0);
  await expect(
    panel.getByRole("radiogroup", { name: "Media filters" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("restores gallery content when a pending sort returns to the previous query", async ({
  page
}) => {
  const trigger = page.getByRole("button", { name: /^View options/ });
  const panel = page.getByRole("dialog", { name: "View options", exact: true });
  const gallery = page.getByRole("region", { name: "Gallery view" });
  await trigger.click();
  await panel.getByRole("tab", { name: "Sort", exact: true }).click();
  await panel.getByRole("radio", { name: "Filename", exact: true }).check();
  await expectQuery(page, { sort: "filename", order: null });
  await expect(gallery).toHaveAttribute("aria-busy", "false");
  let heldDescending = false;
  let releaseDescending!: () => void;
  const descendingDelay = new Promise<void>((resolve) => {
    releaseDescending = resolve;
  });
  await page.route("**/api/folders/*/assets?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("sort") === "filename" && params.get("order") === "desc") {
      heldDescending = true;
      await descendingDelay;
    }
    await route.continue().catch(() => undefined);
  });
  try {
    await panel.getByRole("radio", { name: "Descending", exact: true }).check();
    await expect.poll(() => heldDescending).toBe(true);
    await expect(gallery).toHaveAttribute("aria-busy", "true");
    const ascendingResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/assets") &&
        url.searchParams.get("sort") === "filename" &&
        url.searchParams.get("order") === "asc" &&
        response.ok()
      );
    });
    await panel.getByRole("radio", { name: "Ascending", exact: true }).check();
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

test("keeps the phone sheet reachable with long filters, rotation, and a short viewport", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();
  const url = new URL("/?view=gallery", page.url());
  url.port = process.env.AETHER_E2E_API_PORT ?? "3130";
  for (let i = 0; i < 20; i++)
    url.searchParams.append("tag", `long-filter-${i}-${"x".repeat(24)}`);
  const context = await browser.newContext({
    storageState,
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    serviceWorkers: "block"
  });
  try {
    const phone = await context.newPage();
    const cdp = await context.newCDPSession(phone);
    await phone.goto(url.href);
    const trigger = phone.getByRole("button", { name: /^View options/ });
    await trigger.tap();
    const panel = phone.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await expect(panel).toHaveClass(/view-options-sheet/);
    const body = panel.locator(".view-options-body");
    await expect(
      panel.getByRole("textbox", { name: "Tags", exact: true })
    ).toBeDisabled();
    await panel.getByRole("button", { name: /^Remove long-filter-0-/ }).tap();
    await expect(
      panel.getByRole("textbox", { name: "Tags", exact: true })
    ).toBeEnabled();
    await panel
      .getByRole("textbox", { name: "Tags", exact: true })
      .fill("replacement");
    await panel
      .getByRole("button", { name: "Add tag filter", exact: true })
      .tap();
    await expect(
      panel.getByRole("textbox", { name: "Tags", exact: true })
    ).toBeDisabled();
    const targets = await panel
      .locator(".view-options-choice, [role=tab], .view-options-heading button")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { width, height } = element.getBoundingClientRect();
          return { width, height };
        })
      );
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
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
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect(
        panel.getByRole("tab", { name: "Filters", exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        panel.getByRole("button", { name: "Close view options" })
      ).toBeInViewport({ ratio: 1 });
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
      const bodyBounds = (await body.boundingBox())!;
      expect(bodyBounds.y + bodyBounds.height).toBeLessThanOrEqual(
        viewport.height - insets.bottom
      );
      await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
      await expect(
        panel.getByRole("button", { name: "Clear filters", exact: true })
      ).toBeInViewport({ ratio: 1 });
      await panel.getByRole("tab", { name: "Layout", exact: true }).tap();
      await expect(
        panel.getByRole("combobox", { name: "Grid size" })
      ).toBeInViewport({ ratio: 1 });
      await panel.getByRole("combobox", { name: "Grid size" }).tap();
      await phone.getByRole("option", { name: "Tiny", exact: true }).tap();
      await panel.getByRole("tab", { name: "Filters", exact: true }).tap();
    }
    await panel
      .getByRole("button", { name: "Clear filters", exact: true })
      .tap();
    await expect(
      panel.getByRole("textbox", { name: "Tags", exact: true })
    ).toBeEnabled();
    await panel.getByRole("button", { name: "Close view options" }).tap();
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName("View options");
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
