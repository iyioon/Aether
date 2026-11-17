import { openLibrarySearch, setLibrarySearch } from "./library-search";
import { expect, test, type Page } from "@playwright/test";
import type { TreeResponse } from "../../apps/web/src/api/client";

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
    { width: 568, height: 320 },
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
      const firstFolder = drawer.getByRole("treeitem").first();
      await expect(firstFolder).toBeInViewport();
      const folderBounds = await firstFolder.boundingBox();
      expect(folderBounds!.height).toBeGreaterThanOrEqual(44);
      const account = drawer.getByRole("button", {
        name: "Account",
        exact: true
      });
      await expect(account).toBeInViewport();
      await account.click();
      const signOut = phone.getByRole("menuitem", {
        name: "Sign out",
        exact: true
      });
      await expect(signOut).toBeInViewport();
      await phone.keyboard.press("Escape");
      await expect(account).toBeFocused();
      await phone.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expectToolbarRow(phone, 44);
      if (viewport.width === 932)
        await phone.screenshot({
          path: test.info().outputPath("gallery-toolbar-932-landscape.png")
        });
    } finally {
      await context.close();
    }
  }
});

test("keeps Search and toolbar controls together and reachable on narrow phones", async ({
  browser,
  page
}) => {
  const storageState = await page.context().storageState();

  for (const viewport of [
    { width: 320, height: 852 },
    { width: 360, height: 852 },
    { width: 393, height: 852 },
    { width: 568, height: 320 }
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
      await phone.goto(productionUrl(page.url()));
      await expect(
        phone.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      await expect(
        phone.getByRole("region", { name: "Gallery view" })
      ).toHaveAttribute("aria-busy", "false");
      await expect(
        phone.getByRole("button", { name: "Select media", exact: true })
      ).toBeEnabled();
      await expectToolbarRow(phone, 44);
      if (viewport.width === 320)
        await phone.screenshot({
          path: test.info().outputPath("gallery-toolbar-320.png")
        });
      const search = phone.getByRole("button", { name: "Search", exact: true });
      const viewMenu = phone.getByRole("button", {
        name: "Change view, Gallery selected"
      });
      const searchBounds = (await search.boundingBox())!;
      const viewBounds = (await viewMenu.boundingBox())!;
      expect(viewBounds.x + viewBounds.width).toBeLessThanOrEqual(
        searchBounds.x
      );
      expect(
        Math.abs(
          viewBounds.y +
            viewBounds.height / 2 -
            searchBounds.y -
            searchBounds.height / 2
        )
      ).toBeLessThanOrEqual(1);
      await phone.keyboard.press("/");
      const dialog = phone.getByRole("dialog", { name: "Search", exact: true });
      const input = dialog.getByRole("searchbox", {
        name: "Filename or path",
        exact: true
      });
      await expect(input).toBeFocused();
      await input.fill("beach-walk");
      await dialog.getByRole("button", { name: "Search", exact: true }).tap();
      await expect(
        phone.getByRole("img", { name: "beach-walk.png" })
      ).toBeVisible();
      await viewMenu.tap();
      await expect(
        phone.getByRole("menuitemradio", { name: "Gallery", exact: true })
      ).toBeChecked();
      await phone.keyboard.press("Escape");
      await expect(viewMenu).toBeFocused();
      await viewMenu.press("Enter");
      await phone
        .getByRole("menuitemradio", { name: "Feed", exact: true })
        .tap();
      await expect(
        phone.getByRole("region", { name: "Feed view" })
      ).toBeVisible();
      await phone
        .getByRole("button", { name: "Gallery view", exact: true })
        .tap();
      expect(new URL(phone.url()).searchParams.get("q")).toBe("beach-walk");
      const restoredSearch = await openLibrarySearch(phone);
      await expect(
        restoredSearch.getByRole("searchbox", {
          name: "Filename or path",
          exact: true
        })
      ).toHaveValue("beach-walk");
      await restoredSearch
        .getByRole("button", { name: "Cancel", exact: true })
        .tap();
    } finally {
      await context.close();
    }
  }
});

test("keeps controls with Search through long paths, sidebar changes and pending results", async ({
  page
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "aether.gallery.metadata-fields",
      JSON.stringify(["title", "score"])
    )
  );
  const url = new URL(productionUrl(page.url()));
  url.searchParams.set("view", "gallery");
  url.searchParams.set("sort", "score");
  const tree = (await (
    await page.request.get(new URL("/api/tree", url).href)
  ).json()) as TreeResponse;
  const folder = tree.folders.find((entry) => entry.relativePath === "Trips")!;
  expect(folder).toBeDefined();
  const parentId = "toolbar-long-parent";
  const parentLabel = "A long parent folder name with enough text to truncate";
  const currentLabel =
    "A long current folder name that must remain identifiable";
  const longTree: TreeResponse = {
    ...tree,
    roots: tree.roots.map((root) => ({
      ...root,
      label: "A long library root label"
    })),
    folders: [
      ...tree.folders.map((entry) =>
        entry.id === folder.id
          ? { ...entry, parentId, label: currentLabel }
          : entry
      ),
      {
        ...folder,
        id: parentId,
        label: parentLabel,
        relativePath: parentLabel
      }
    ]
  };
  await page.route("**/api/tree", (route) => route.fulfill({ json: longTree }));
  url.searchParams.set("folder", folder.id);

  for (const width of [320, 360, 393, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    await page.goto(url.href);
    const gallery = page.getByRole("region", { name: "Gallery view" });
    await expect(gallery).toHaveAttribute("aria-busy", "false");
    await expect(
      page.locator(".library-current-folder [data-slot=breadcrumb-page]")
    ).toHaveAttribute("title", currentLabel);
    for (const expanded of width >= 768 ? [true, false] : [false]) {
      const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
      if (width >= 768) {
        if ((await toggle.getAttribute("aria-expanded")) !== String(expanded))
          await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
        await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCSS(
          "left",
          expanded ? "0px" : /-\d+px/
        );
        await expect
          .poll(() =>
            page.evaluate((expanded) => {
              const gap = document
                .querySelector('[data-slot="sidebar-gap"]')!
                .getBoundingClientRect();
              const sidebar = document
                .querySelector('[data-slot="sidebar-container"]')!
                .getBoundingClientRect();
              return Math.abs(gap.width - (expanded ? sidebar.width : 0));
            }, expanded)
          )
          .toBeLessThan(1);
      }
      const before = await expectToolbarRow(
        page,
        width < 768 ? 44 : 32,
        width === 1440
      );
      const increaseScore = gallery
        .getByRole("button", { name: /^Increase score for/ })
        .first();
      await expect(increaseScore).toBeEnabled();
      await increaseScore.click();
      const update = page
        .getByRole("region", { name: "Library results" })
        .getByRole("button", { name: "Update results", exact: true });
      await expect(update).toBeVisible();
      const after = await expectToolbarRow(
        page,
        width < 768 ? 44 : 32,
        width === 1440
      );
      expect(after.search).toEqual(before.search);
      expect(after.headerHeight).toBe(before.headerHeight);
      if (width === 1440 || (width === 320 && !expanded))
        await page.screenshot({
          path: test
            .info()
            .outputPath(
              `toolbar-pending-${width}-${expanded ? "expanded" : "collapsed"}.png`
            )
        });
      await update.focus();
      await update.click();
      await expect(update).toBeHidden();
      await expect(
        page.getByRole("button", { name: /^View options/ })
      ).toBeFocused();
    }
  }
});

test("groups mobile Feed view options and navigation with media visibility", async ({
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
    const overlay = phone.locator(".feed-view-controls");
    const options = overlay.getByRole("button", { name: /^View options/ });
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
        phone.getByRole("searchbox", { name: "Filename or path" })
      ).toHaveCount(0);
      await expect(
        phone.getByRole("button", { name: "Search", exact: true })
      ).toBeVisible();
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
      const targets = await overlay.getByRole("button").evaluateAll((buttons) =>
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

    await options.tap();
    const panel = phone.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await expect(panel.getByRole("tab")).toHaveText(["Sort", "Layout"]);
    await panel.getByRole("button", { name: "Close view options" }).tap();
    const searchPanel = await openLibrarySearch(phone);
    await searchPanel
      .getByRole("radio", { name: "Videos", exact: true })
      .check();
    await searchPanel
      .getByRole("button", { name: "Search", exact: true })
      .tap();
    await expect(
      phone.getByText("No media matches this search or filter", { exact: true })
    ).toBeVisible();
    await openLibrarySearch(phone);
    await searchPanel
      .getByRole("radio", { name: "Images", exact: true })
      .check();
    await searchPanel
      .getByRole("button", { name: "Search", exact: true })
      .tap();
    await options.tap();
    await panel.getByRole("tab", { name: "Sort", exact: true }).tap();
    await panel.getByRole("combobox", { name: "Sort direction 1" }).tap();
    await phone.getByRole("option", { name: "Z to A", exact: true }).tap();
    await panel.getByRole("button", { name: "Close view options" }).tap();
    await expect(options).toHaveAccessibleName("View options");
    expect(new URL(phone.url()).searchParams.get("order")).toBe("desc");
    expect(new URL(phone.url()).searchParams.get("sortBy")).toBe(
      "filename:desc"
    );

    await feed
      .getByRole("button", {
        name: "Hide feed controls and details",
        exact: true
      })
      .tap();
    await expect(phone.locator(".feed-meta")).toBeHidden();
    await expect(overlay).toBeHidden();
    await expect(overlay).toHaveAttribute("inert", "");
    await expect(
      phone.getByRole("button", { name: /^View options/ })
    ).toHaveCount(0);
    await feed
      .getByRole("button", {
        name: "Show feed controls and details",
        exact: true
      })
      .tap();
    await expect(overlay).toBeVisible();
    await expect(options).toBeVisible();
    await switcher
      .getByRole("button", { name: "Compare and rank", exact: true })
      .tap();
    await expect(
      phone.getByRole("heading", { name: "Leaderboard", exact: true })
    ).toBeVisible();
    await expect(phone.getByRole("banner")).toBeVisible();
    await phone.goBack();
    await expect(feed).toBeVisible();
    await expect(overlay).toBeVisible();
    await switcher
      .getByRole("button", { name: "Gallery view", exact: true })
      .press("Enter");
    expect(new URL(phone.url()).searchParams.get("q")).toBe("beach-walk");
    expect(new URL(phone.url()).searchParams.get("type")).toBe("image");
    expect(new URL(phone.url()).searchParams.get("sort")).toBe("filename");

    await setLibrarySearch(phone, "no-matching-feed-item");
    await expect
      .poll(() => new URL(phone.url()).searchParams.get("q"))
      .toBe("no-matching-feed-item");
    await phone.getByRole("button", { name: "Feed view", exact: true }).tap();
    await expect(
      phone.getByText("No media matches this search or filter", { exact: true })
    ).toBeVisible();
    await switcher
      .getByRole("button", { name: "Gallery view", exact: true })
      .tap();
    expect(new URL(phone.url()).searchParams.get("q")).toBe(
      "no-matching-feed-item"
    );
  } finally {
    await context.close();
  }

  await page.getByRole("button", { name: "Feed view", exact: true }).click();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search", exact: true })
  ).toBeVisible();
  await expect(page.locator(".feed-view-controls")).toHaveCount(0);
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

async function expectToolbarRow(
  page: Page,
  minimumTarget: number,
  singleRow = false
) {
  const geometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".library-path-bar")!;
    const search = header
      .querySelector<HTMLButtonElement>('[aria-label="Search"]')!
      .getBoundingClientRect();
    const path = header
      .querySelector<HTMLElement>(".library-folder-breadcrumb")!
      .getBoundingClientRect();
    return {
      search: {
        x: search.x,
        y: search.y,
        width: search.width,
        height: search.height
      },
      path: { width: path.width, center: path.y + path.height / 2 },
      headerHeight: header.getBoundingClientRect().height,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      targets: [
        ...header.querySelectorAll<HTMLButtonElement>(
          ".library-path-actions button"
        )
      ]
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => {
          const bounds = button.getBoundingClientRect();
          return {
            name:
              button.getAttribute("aria-label") ?? button.textContent?.trim(),
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            height: bounds.height,
            center: bounds.y + bounds.height / 2,
            reachable: button.contains(
              document.elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2
              )
            )
          };
        })
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(
    geometry.viewportWidth + 1
  );
  expect(geometry.path.width).toBeGreaterThan(0);
  expect(geometry.targets.length).toBeGreaterThanOrEqual(5);
  expect(geometry.targets.map((target) => target.name)).toEqual(
    expect.arrayContaining([
      "Add media",
      "View options",
      "Select media",
      "Search"
    ])
  );
  expect(geometry.targets.at(-1)?.name).toBe("Search");
  for (let index = 0; index < geometry.targets.length; index++) {
    const target = geometry.targets[index]!;
    expect(
      Math.abs(target.center - geometry.search.y - geometry.search.height / 2)
    ).toBeLessThanOrEqual(1);
    expect(target.left).toBeGreaterThanOrEqual(0);
    expect(target.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(target.width).toBeGreaterThanOrEqual(minimumTarget);
    expect(target.height).toBeGreaterThanOrEqual(minimumTarget);
    expect(target.reachable).toBe(true);
    if (index)
      expect(target.left).toBeGreaterThanOrEqual(
        geometry.targets[index - 1]!.right
      );
  }
  if (singleRow) {
    expect(
      Math.abs(
        geometry.path.center - geometry.search.y - geometry.search.height / 2
      )
    ).toBeLessThanOrEqual(1);
    expect(geometry.headerHeight).toBeLessThan(geometry.search.height * 2);
  }
  return geometry;
}
