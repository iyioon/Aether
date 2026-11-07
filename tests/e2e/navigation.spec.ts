import { expect, test, type Page } from "@playwright/test";
import { chooseAccountAction, openAccountMenu } from "./account-menu";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
test.use({ baseURL: productionBaseURL });

async function signIn(page: Page) {
  await page.goto("/?page=library&view=gallery");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
}

test("keeps view switching at the end of search and limits creation to Gallery", async ({
  page
}) => {
  await signIn(page);
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  const switcher = page.getByRole("group", {
    name: "Library view",
    exact: true
  });
  const searchBounds = (await search.boundingBox())!;
  const switcherBounds = (await switcher.boundingBox())!;
  expect(
    Math.abs(
      searchBounds.y +
        searchBounds.height / 2 -
        switcherBounds.y -
        switcherBounds.height / 2
    )
  ).toBeLessThanOrEqual(1);
  expect(switcherBounds.x).toBeGreaterThan(searchBounds.x + searchBounds.width);
  await expect(
    page.locator(".library-path-actions .library-view-separator")
  ).toBeVisible();
  await expect(
    page
      .locator(".control-strip")
      .getByRole("button", { name: "Add media", exact: true })
  ).toBeVisible();
  await expect(
    page
      .locator(".asset-card")
      .getByRole("button", { name: /^More options for / })
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("gallery-toolbar.png")
  });
  for (const name of ["Feed view", "Compare and rank"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add media", exact: true })
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Gallery view", exact: true }).click();
  await expect(
    page
      .locator(".control-strip")
      .getByRole("button", { name: "Add media", exact: true })
  ).toBeVisible();
});

for (const phone of [false, true]) {
  test(`opens library utilities from one Account card on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 320, height: 640 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      await signIn(page);
      const menu = await openAccountMenu(page);
      const names = ["Trash", "Activity", "User guide", "Settings", "Sign out"];
      await expect(menu.getByRole("menuitem")).toHaveCount(names.length);
      for (const name of names) {
        const item = menu.getByRole("menuitem", { name, exact: true });
        await expect(item).toBeInViewport();
        if (phone)
          await expect
            .poll(async () => (await item.boundingBox())!.height)
            .toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: test.info().outputPath("account-menu.png")
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Account", exact: true })
      ).toBeFocused();
      if (phone) {
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("dialog", { name: "Sidebar", exact: true })
        ).toBeHidden();
      }
      await chooseAccountAction(page, "Activity");
      const activity = page.getByRole("dialog", {
        name: "Activity",
        exact: true
      });
      await expect(activity).toBeVisible();
      await activity
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(activity).toBeHidden();
      for (const name of ["Trash", "User guide", "Settings"]) {
        await chooseAccountAction(page, name);
        await expect(
          page.getByRole("heading", { name, exact: true })
        ).toBeVisible();
        if (phone)
          await expect(
            page.getByRole("dialog", { name: "Sidebar", exact: true })
          ).toBeHidden();
      }
      await chooseAccountAction(page, "Sign out");
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
