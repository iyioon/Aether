import { expect, test } from "@playwright/test";

const topics = [
  ["Browse", "Sign in and scan"],
  ["Edit media", "Open the editor"],
  ["Rank media", "Compare media"],
  ["Manage media", "Edit details"],
  ["Media files", "Read and write access"],
  ["Help", "Loading, saving and transfers"]
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/?page=guide");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "User guide" })).toBeVisible();
});

test("switches one guide panel at a time with keyboard navigation and topic links", async ({
  page
}) => {
  const guide = page.locator(".guide-page");
  const tabs = guide.getByRole("tablist", { name: "Guide topics" });
  await expect(tabs.getByRole("tab")).toHaveCount(topics.length);
  await expect(guide.getByRole("tabpanel")).toHaveCount(1);
  await expect(
    guide.getByRole("heading", { name: "Sign in and scan" })
  ).toBeVisible();
  const browse = tabs.getByRole("tab", { name: "Browse", exact: true });
  await browse.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "Edit media", exact: true })
  ).toBeFocused();
  await expect(
    guide.getByRole("heading", { name: "Open the editor" })
  ).toBeVisible();
  await expect(
    guide.getByRole("heading", { name: "Sign in and scan" })
  ).toHaveCount(0);
  await expect(page).toHaveURL(/topic=edit/);
  await page.keyboard.press("End");
  await expect(
    tabs.getByRole("tab", { name: "Help", exact: true })
  ).toBeFocused();
  await expect(
    guide.getByRole("heading", { name: "Loading, saving and transfers" })
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(browse).toBeFocused();
  await tabs.getByRole("tab", { name: "Media files", exact: true }).click();
  await page.reload();
  await expect(
    guide.getByRole("heading", { name: "Read and write access" })
  ).toBeVisible();
  await page.goto("/?page=guide&topic=invalid");
  await expect(
    guide.getByRole("heading", { name: "Sign in and scan" })
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await expect(guide.getByText("Your originals stay unchanged")).toHaveCount(0);
});

test("keeps topics and procedures usable on narrow phones, landscape and zoom", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();
  const url = new URL("/?page=guide&topic=browse", page.url());
  url.port = process.env.AETHER_E2E_API_PORT ?? "3130";
  for (const [width, height] of [
    [320, 852],
    [393, 852],
    [844, 390]
  ]) {
    const context = await browser.newContext({
      storageState,
      viewport: { width: width!, height: height! },
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
      await phone.locator(".guide-shell").evaluate((element) => {
        (element as HTMLElement).style.zoom = "2";
      });
      await expect(
        guide.getByRole("heading", { name: "Loading, saving and transfers" })
      ).toBeVisible();
      expect(
        await guide.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1
        )
      ).toBe(true);
    } finally {
      await context.close();
    }
  }
});
