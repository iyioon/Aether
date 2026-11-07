import { expect, test, type Page } from "@playwright/test";
import type { ScanJob } from "../../apps/web/src/api/client";

async function openGallery(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  const csrfToken = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(csrfToken).toBeTruthy();
  const response = await page.request.post("/api/admin/scan", {
    headers: { "x-csrf-token": csrfToken! }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/admin/jobs");
        const { jobs } = (await response.json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("completed");
  await page.goto("/?view=gallery&q=family-photo.png");
  return page.getByRole("button", {
    name: "Open family-photo.png",
    exact: true
  });
}

test("opens Gallery actions with pointer and keyboard and preserves normal card activation", async ({
  page
}) => {
  const card = await openGallery(page);
  const menu = page.getByRole("menu", { name: "Options for family-photo.png" });
  await card.click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Info",
    "Edit media",
    "Download",
    "Rename…",
    "Move to…",
    "Move to Trash"
  ]);
  await expect(page.locator(".viewer-dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(card).toBeFocused();

  await card.press("Shift+F10");
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Home");
  await expect(
    menu.getByRole("menuitem", { name: "Info", exact: true })
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "Edit media", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit media", exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await card.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Info", exact: true }).click();
  const info = page.locator(".media-info-sheet");
  await expect(info).toBeVisible();
  await expect(info).toContainText("family-photo.png");
  await info.getByRole("button", { name: "Close", exact: true }).click();
  if (await page.locator(".viewer-dialog").isVisible())
    await page
      .getByRole("button", { name: "Close viewer", exact: true })
      .click();

  await card.click({ button: "right" });
  const downloadPending = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "Download", exact: true }).click();
  expect((await downloadPending).suggestedFilename()).toBe("family-photo.png");
  await expect(page.locator(".viewer-dialog")).toHaveCount(0);

  await card.focus();
  await card.press("ContextMenu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await card.press("Enter");
  await expect(page.locator(".viewer-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close viewer", exact: true }).click();

  await page.getByRole("button", { name: "Select media", exact: true }).click();
  await page
    .getByRole("button", { name: "Select family-photo.png", exact: true })
    .click({ button: "right" });
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Select family-photo.png", exact: true })
  ).toHaveAttribute("aria-pressed", "false");
});

test("keeps viewer menus and panels reachable from browser fullscreen", async ({
  page
}) => {
  const card = await openGallery(page);
  await card.click();
  const viewer = page.getByRole("dialog", {
    name: "family-photo.png",
    exact: true
  });
  await expect(viewer).toBeVisible();
  try {
    await viewer.evaluate((element) => element.requestFullscreen());
    await expect
      .poll(() =>
        viewer.evaluate((element) => document.fullscreenElement === element)
      )
      .toBe(true);
    const more = viewer.getByRole("button", {
      name: "More options for family-photo.png",
      exact: true
    });
    await more.click();
    const menu = page.locator(".viewer-more-menu");
    await expect(menu).toBeVisible();
    expect(
      await menu.evaluate((element) =>
        document.fullscreenElement?.contains(element)
      )
    ).toBe(true);
    await menu.getByRole("menuitem", { name: "Rename…", exact: true }).click();
    const rename = page.getByRole("dialog", {
      name: "Rename media",
      exact: true
    });
    const name = rename.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toBeFocused();
    expect(
      await name.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        return hit !== null && element.contains(hit);
      })
    ).toBe(true);
    await rename.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(viewer).toBeVisible();
    await expect(more).toBeFocused();
    await viewer.evaluate((element) => element.requestFullscreen());
    await expect
      .poll(() =>
        viewer.evaluate((element) => document.fullscreenElement === element)
      )
      .toBe(true);
    await viewer
      .getByRole("button", {
        name: "Show info for family-photo.png",
        exact: true
      })
      .click();
    const info = page.locator(".media-info-sheet");
    const tagInput = info.getByRole("textbox", {
      name: "Add a tag",
      exact: true
    });
    await expect(tagInput).toBeEnabled();
    await expect(tagInput).toBeInViewport();
    expect(
      await tagInput.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        return hit !== null && element.contains(hit);
      })
    ).toBe(true);
    await info.getByRole("button", { name: "Close", exact: true }).click();
    await expect(info).toHaveCount(0);
    await expect(viewer).toBeVisible();
  } finally {
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
  }
});

test("commits an IME tag draft only after composition has finished", async ({
  page
}) => {
  const card = await openGallery(page);
  const assetId = await page
    .locator(".media-tile")
    .filter({ has: card })
    .getAttribute("data-asset-id");
  expect(assetId).toBeTruthy();
  const tagsUrl = `/api/assets/${assetId}/tags`;
  const originalResponse = await page.request.get(tagsUrl);
  expect(originalResponse.ok()).toBe(true);
  const originalNames = (
    (await originalResponse.json()) as { tags: Array<{ displayName: string }> }
  ).tags.map((tag) => tag.displayName);
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(token).toBeTruthy();
  let saves = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname === tagsUrl
    )
      saves += 1;
  });
  try {
    await card.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Info", exact: true }).click();
    const input = page
      .locator(".media-info-sheet")
      .getByRole("textbox", { name: "Add a tag", exact: true });
    await expect(input).toBeEnabled();
    const tagName = `구성 확인 ${Date.now()}`;
    await input.fill(tagName);
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true
    });
    expect(
      await input.evaluate((element: HTMLInputElement) => ({
        value: element.value,
        disabled: element.disabled
      }))
    ).toEqual({ value: tagName, disabled: false });
    expect(saves).toBe(0);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === tagsUrl &&
        response.ok()
    );
    await input.press("Enter");
    const response = await saved;
    expect(response.request().postDataJSON().tags).toContain(tagName);
    await expect(input).toHaveValue("");
    expect(saves).toBe(1);
  } finally {
    const restored = await page.request.put(tagsUrl, {
      headers: { "x-csrf-token": token! },
      data: { tags: originalNames }
    });
    expect(restored.ok()).toBe(true);
  }
});

test("offers touch long-press actions without opening the viewer and cancels while scrolling", async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true
  });
  try {
    const page = await context.newPage();
    const card = await openGallery(page);
    await card.scrollIntoViewIfNeeded();
    const bounds = (await card.boundingBox())!;
    const touch = { x: bounds.x + bounds.width / 2, y: bounds.y + 40 };
    const session = await context.newCDPSession(page);
    const menu = page.getByRole("menu", {
      name: "Options for family-photo.png"
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch]
    });
    await expect(menu).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    await expect(page.locator(".viewer-dialog")).toHaveCount(0);
    const edit = menu.getByRole("menuitem", {
      name: "Edit media",
      exact: true
    });
    await expect
      .poll(async () => (await edit.boundingBox())!.height)
      .toBeGreaterThanOrEqual(44);
    await edit.tap();
    const editor = page.getByRole("dialog", {
      name: "Edit media",
      exact: true
    });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Cancel", exact: true }).tap();
    await expect(editor).toHaveCount(0);

    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch]
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...touch, y: touch.y - 65 }]
    });
    await page.waitForTimeout(800);
    await expect(menu).toHaveCount(0);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    await expect(page.locator(".viewer-dialog")).toHaveCount(0);

    await card.scrollIntoViewIfNeeded();
    await card.tap();
    await expect(page.locator(".viewer-dialog")).toBeVisible();
    await session.detach();
  } finally {
    await context.close();
  }
});

test("keeps score holds and heart taps separate from touch context actions", async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true
  });
  try {
    const page = await context.newPage();
    const card = await openGallery(page);
    await page.getByRole("button", { name: /^View options/ }).tap();
    const options = page.getByRole("dialog", {
      name: "View options",
      exact: true
    });
    await options.getByRole("tab", { name: "Layout", exact: true }).tap();
    await options.getByRole("checkbox", { name: "Score", exact: true }).check();
    await options.getByRole("checkbox", { name: "Heart", exact: true }).check();
    await options
      .getByRole("button", { name: "Close view options", exact: true })
      .tap();

    const tile = page.locator(".media-tile").filter({ has: card });
    const increase = tile.getByRole("button", {
      name: /^Increase score for family-photo\.png/
    });
    await increase.scrollIntoViewIfNeeded();
    const bounds = (await increase.boundingBox())!;
    const session = await context.newCDPSession(page);
    const menu = page.getByRole("menu", {
      name: "Options for family-photo.png"
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      ]
    });
    await page.waitForTimeout(850);
    await expect(menu).toHaveCount(0);
    const scoreSaved = page.waitForResponse(
      (response) =>
        /\/api\/assets\/[^/]+\/score$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "PATCH" &&
        response.ok()
    );
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    expect((await scoreSaved).request().postDataJSON().score).toBeGreaterThan(
      0
    );

    const heart = tile.locator(".favorite-button");
    await heart.scrollIntoViewIfNeeded();
    const heartBounds = (await heart.boundingBox())!;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          x: heartBounds.x + heartBounds.width / 2,
          y: heartBounds.y + heartBounds.height / 2
        }
      ]
    });
    await page.waitForTimeout(850);
    await expect(menu).toHaveCount(0);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    await expect(heart).toBeEnabled();
    const wasFavorite = await heart.getAttribute("aria-pressed");
    await heart.tap();
    await expect(heart).toHaveAttribute(
      "aria-pressed",
      wasFavorite === "true" ? "false" : "true"
    );
    await expect(page.locator(".viewer-dialog")).toHaveCount(0);

    await card.click({ button: "right" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await card.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await session.detach();
  } finally {
    await context.close();
  }
});
