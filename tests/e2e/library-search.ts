import { expect, type Page } from "@playwright/test";

export async function openLibrarySearch(page: Page) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function setLibrarySearch(page: Page, text: string) {
  const dialog = await openLibrarySearch(page);
  await dialog
    .getByRole("searchbox", { name: "Filename or path", exact: true })
    .fill(text);
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
