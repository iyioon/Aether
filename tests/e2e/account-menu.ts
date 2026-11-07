import { expect, type Page } from "@playwright/test";

export async function openAccountMenu(page: Page) {
  await expect(page.locator(".library-main")).toBeVisible();
  const sidebar = page.getByRole("dialog", { name: "Sidebar", exact: true });
  if (
    (await sidebar.count()) &&
    (await sidebar.getAttribute("data-state")) === "closed"
  )
    await expect(sidebar).toBeHidden();
  const trigger = page.getByRole("button", { name: "Account", exact: true });
  const collapsedSidebar = page.locator(
    '[data-slot="sidebar"][data-state="collapsed"]'
  );
  if ((await collapsedSidebar.count()) || !(await trigger.isVisible())) {
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
  }
  await expect(trigger).toBeInViewport();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function chooseAccountAction(page: Page, name: string) {
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name, exact: true }).click();
}
