import { expect, test } from "@playwright/test";

const topics = [
  ["Get started", "Get started"],
  ["Browsing", "Browse your library"],
  ["Edit media", "Edit media"],
  ["Ranking", "Rank media"],
  ["Organizing", "Organize media"],
  ["Keyboard", "Keyboard shortcuts"]
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/?page=guide");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "User guide" })).toBeVisible();
});

test("switches guide panels without anchors and supports keyboard tab navigation", async ({
  page
}) => {
  const guide = page.locator(".guide-page");
  const tabs = guide.getByRole("tablist", { name: "Guide topics" });
  await expect(tabs.getByRole("tab")).toHaveCount(topics.length);
  await expect(guide.getByRole("tabpanel")).toHaveCount(1);
  await expect(
    guide.getByRole("heading", { name: "Scan your folders" })
  ).toBeVisible();

  const start = tabs.getByRole("tab", { name: "Get started", exact: true });
  await start.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "Browsing", exact: true })
  ).toBeFocused();
  await expect(guide.getByRole("tabpanel", { name: "Browsing" })).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Scan your folders" })
  ).toHaveCount(0);
  await expect(
    guide.getByRole("heading", { name: "Browse your library" })
  ).toBeVisible();

  await page.keyboard.press("End");
  await expect(
    tabs.getByRole("tab", { name: "Keyboard", exact: true })
  ).toBeFocused();
  await expect(
    guide.getByRole("heading", { name: "Keyboard shortcuts" })
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(start).toBeFocused();
  await expect(start).toHaveAttribute("aria-selected", "true");

  await tabs.getByRole("tab", { name: "Edit media", exact: true }).click();
  await expect(
    guide.getByRole("tabpanel", { name: "Edit media" })
  ).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Playback", exact: true })
  ).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Framing", exact: true })
  ).toBeVisible();
  await expect(guide.getByRole("tabpanel")).toHaveCount(1);
  expect(new URL(page.url()).hash).toBe("");
  expect(
    await page.locator(".library-main").evaluate((node) => node.scrollTop)
  ).toBe(0);

  await page.setViewportSize({ width: 800, height: 900 });
  await expect
    .poll(() =>
      tabs
        .getByRole("tab")
        .evaluateAll((elements) =>
          elements.every(
            (element) => element.scrollWidth <= element.clientWidth
          )
        )
    )
    .toBe(true);
  await expect
    .poll(() =>
      guide.evaluate((element) => element.scrollWidth <= element.clientWidth)
    )
    .toBe(true);
});

test("keeps guide topics reachable and content within narrow phone screens", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();
  const url = new URL("/?page=guide", page.url());
  url.port = process.env.AETHER_E2E_API_PORT ?? "3130";
  for (const width of [320, 393]) {
    const context = await browser.newContext({
      storageState,
      viewport: { width, height: 852 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block"
    });
    try {
      const phone = await context.newPage();
      await phone.goto(url.href);
      const guide = phone.locator(".guide-page");
      const tabs = guide.getByRole("tablist", { name: "Guide topics" });
      for (const [label, heading] of topics) {
        const tab = tabs.getByRole("tab", { name: label, exact: true });
        await tab.tap();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(
          guide.getByRole("heading", { name: heading, exact: true })
        ).toBeVisible();
        await expect(guide.getByRole("tabpanel")).toHaveCount(1);
        const layout = await guide.evaluate((node) => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          contentWidth: node.scrollWidth,
          availableWidth: node.clientWidth,
          targets: [...node.querySelectorAll('[role="tab"]')].map((target) => {
            const bounds = target.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height };
          })
        }));
        expect(layout.documentWidth).toBeLessThanOrEqual(
          layout.viewportWidth + 1
        );
        expect(layout.contentWidth).toBeLessThanOrEqual(
          layout.availableWidth + 1
        );
        for (const target of layout.targets) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        }
      }
    } finally {
      await context.close();
    }
  }
});
