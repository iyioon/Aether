import { expect, test, type Page } from "@playwright/test";

const password = "aether-e2e-password";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByText("Scan complete")).toBeVisible();
});

test("fits both comparison cards and touch controls on short and tall phones", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();
  const rankingUrl = productionUrl(new URL("/?view=compare", page.url()).href);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 393, height: 852 }
  ]) {
    const context = await browser.newContext({
      storageState,
      viewport,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block"
    });
    try {
      const phone = await context.newPage();
      await phone.goto(rankingUrl);
      await openRanking(phone);

      const geometry = await phone.evaluate(() => {
        const main = document.querySelector<HTMLElement>(".library-main")!;
        const pair = document.querySelector<HTMLElement>(".comparison-pair")!;
        const footer = document.querySelector<HTMLElement>(
          ".comparison-session-footer"
        )!;
        return {
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          mainHeight: main.clientHeight,
          mainScrollHeight: main.scrollHeight,
          pairHeight: pair.clientHeight,
          pairScrollHeight: pair.scrollHeight,
          footerTop: footer.getBoundingClientRect().top,
          footerBottom: footer.getBoundingClientRect().bottom,
          cards: [...pair.querySelectorAll(".comparison-card")].map((card) => {
            const bounds = card.getBoundingClientRect();
            return { height: bounds.height, bottom: bounds.bottom };
          }),
          targets: [
            ...footer.querySelectorAll(".comparison-session-actions button")
          ].map((button) => {
            const bounds = button.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height };
          })
        };
      });

      expect(geometry.documentWidth).toBeLessThanOrEqual(
        geometry.viewportWidth + 1
      );
      expect(geometry.mainScrollHeight).toBeLessThanOrEqual(
        geometry.mainHeight + 1
      );
      expect(geometry.pairScrollHeight).toBeLessThanOrEqual(
        geometry.pairHeight + 1
      );
      expect(geometry.cards).toHaveLength(2);
      for (const card of geometry.cards) {
        expect(card.height).toBeGreaterThan(0);
        expect(card.bottom).toBeLessThan(geometry.footerTop);
      }
      expect(geometry.footerBottom).toBeLessThanOrEqual(
        geometry.viewportHeight + 1
      );
      expect(geometry.targets).toHaveLength(3);
      for (const target of geometry.targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await context.close();
    }
  }
});

test("uses a working drawer on wide touch landscape screens", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();
  const galleryUrl = productionUrl(page.url());

  for (const viewport of [
    { width: 932, height: 430 },
    { width: 956, height: 440 }
  ]) {
    const context = await browser.newContext({
      storageState,
      viewport,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block"
    });
    try {
      const phone = await context.newPage();
      await phone.goto(galleryUrl);
      await expect(
        phone.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      await expect(
        phone.locator('[data-slot="sidebar-container"]')
      ).toHaveCount(0);
      await expect(phone.locator('[data-slot="sidebar-gap"]')).toHaveCount(0);
      await phone.getByRole("button", { name: "Toggle Sidebar" }).click();
      const drawer = phone.getByRole("dialog", {
        name: "Sidebar",
        exact: true
      });
      await expect(drawer).toBeVisible();
      await expect(
        drawer.getByRole("navigation", { name: "Media folders" })
      ).toBeVisible();
      await phone.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    } finally {
      await context.close();
    }
  }
});

test("keeps gallery search and toolbar controls reachable on narrow phones", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();

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
      await phone.goto(productionUrl(page.url()));
      await expect(
        phone.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      const geometry = await phone.evaluate(() => ({
        width: innerWidth,
        searchWidth: document
          .querySelector('[aria-label="Search"]')!
          .getBoundingClientRect().width,
        targets: [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".library-path-actions button"
          )
        ].map((button) => {
          const bounds = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          );
          return {
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            height: bounds.height,
            reachable: hit?.closest("button") === button
          };
        })
      }));

      expect(geometry.searchWidth).toBeGreaterThanOrEqual(100);
      expect(geometry.targets).toHaveLength(7);
      for (const target of geometry.targets) {
        expect(target.left).toBeGreaterThanOrEqual(0);
        expect(target.right).toBeLessThanOrEqual(geometry.width);
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.reachable).toBe(true);
      }
    } finally {
      await context.close();
    }
  }
});

test("uses only an overlaid view switcher in mobile Feed and preserves navigation and filters", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block"
  });
  try {
    const phone = await context.newPage();
    await phone.goto(
      productionUrl(
        new URL("/?view=feed&type=image&q=beach-walk&sort=filename", page.url())
          .href
      )
    );
    const switcher = phone.getByRole("group", { name: "Library view" });
    const feed = phone.getByRole("region", { name: "Feed view" });
    await expect(
      feed.getByRole("img", { name: "beach-walk.png" })
    ).toBeVisible();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 852 },
      { width: 932, height: 430 }
    ]) {
      await phone.setViewportSize(viewport);
      await expect(phone.getByRole("banner")).toHaveCount(0);
      await expect(
        phone.getByRole("searchbox", { name: "Search" })
      ).toHaveCount(0);
      await expect(
        phone.getByRole("button", { name: "Toggle Sidebar" })
      ).toHaveCount(0);
      await expect(switcher.getByRole("button")).toHaveCount(3);
      await expect(
        switcher.getByRole("button", { name: "Feed view", exact: true })
      ).toHaveAttribute("aria-pressed", "true");
      const bounds = (await feed.boundingBox())!;
      expect(bounds.y).toBe(0);
      expect(bounds.height).toBe(viewport.height);
      const targets = await switcher
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              top: rect.top,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              reachable: button.contains(
                document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2
                )
              )
            };
          })
        );
      for (const target of targets) {
        expect(target.top).toBeGreaterThanOrEqual(12);
        expect(target.right).toBeLessThanOrEqual(viewport.width - 12);
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.reachable).toBe(true);
      }
    }

    await feed
      .getByRole("button", {
        name: "Hide feed controls and details",
        exact: true
      })
      .tap();
    await expect(phone.locator(".feed-meta")).toBeHidden();
    await switcher
      .getByRole("button", { name: "Compare and rank", exact: true })
      .tap();
    await expect(
      phone.getByRole("heading", { name: "Leaderboard", exact: true })
    ).toBeVisible();
    await expect(phone.getByRole("banner")).toBeVisible();
    await phone.goBack();
    await expect(feed).toBeVisible();
    await expect(phone.locator(".feed-view-switcher")).toBeVisible();
    await switcher
      .getByRole("button", { name: "Gallery view", exact: true })
      .press("Enter");
    const search = phone.getByRole("searchbox", { name: "Search" });
    await expect(search).toHaveValue("beach-walk");
    expect(new URL(phone.url()).searchParams.get("type")).toBe("image");
    expect(new URL(phone.url()).searchParams.get("sort")).toBe("filename");

    await search.fill("no-matching-feed-item");
    await expect
      .poll(() => new URL(phone.url()).searchParams.get("q"))
      .toBe("no-matching-feed-item");
    await phone.getByRole("button", { name: "Feed view", exact: true }).tap();
    await expect(
      phone.getByText("No media in this feed", { exact: true })
    ).toBeVisible();
    await switcher
      .getByRole("button", { name: "Gallery view", exact: true })
      .tap();
    await expect(search).toHaveValue("no-matching-feed-item");
  } finally {
    await context.close();
  }

  await page.getByRole("button", { name: "Feed view", exact: true }).click();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
  await expect(page.locator(".feed-view-switcher")).toHaveCount(0);
});

test("keeps sidebar navigation available across the fine-pointer breakpoint", async ({
  page
}) => {
  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });

  for (const width of [761, 767]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCount(
      0
    );
    await expect(toggle).toBeVisible();
    await toggle.click();
    const drawer = page.getByRole("dialog", { name: "Sidebar", exact: true });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("navigation", { name: "Media folders" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  }

  await page.setViewportSize({ width: 768, height: 900 });
  const desktopSidebar = page.locator('[data-slot="sidebar-container"]');
  await expect(desktopSidebar).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();
  await toggle.click();
  await expect(desktopSidebar).toHaveCSS("left", /-\d+px/);
  await toggle.click();
  await expect(desktopSidebar).toHaveCSS("left", "0px");
  await expect(
    page.getByRole("navigation", { name: "Media folders" })
  ).toBeVisible();
});

async function openRanking(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Leaderboard" })
  ).toBeVisible();
  await page
    .locator(".leaderboard-header")
    .getByRole("button", { name: "Rank media", exact: true })
    .click();
  await expect(page.locator(".comparison-choose-surface")).toHaveCount(2);
  await expect(
    page.locator(".comparison-choose-surface").first()
  ).toBeEnabled();
}

function productionUrl(url: string): string {
  // Test phone layouts against the bundled app served by the fixture API.
  const target = new URL(url);
  target.port = process.env.AETHER_E2E_API_PORT ?? "3130";
  return target.href;
}
