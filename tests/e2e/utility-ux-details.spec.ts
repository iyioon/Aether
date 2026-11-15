import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator
} from "@playwright/test";
import type {
  SettingsSummary,
  TrashRecord
} from "../../apps/web/src/api/client";
import { chooseAccountAction } from "./account-menu";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let settings: SettingsSummary;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByLabel("Password", { exact: true })
      .fill("aether-e2e-password");
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(page.locator(".library-main")).toBeVisible();
    const response = await context.request.get(`${origin}/api/admin/settings`);
    expect(response.ok()).toBe(true);
    settings = (await response.json()) as SettingsSummary;
    storageState = await context.storageState();
  } finally {
    await context.close();
  }
});

for (const phone of [false, true]) {
  const layout = phone ? "phone" : "desktop";

  test(`uses one keyboard stop per appearance choice and focuses utility page entries (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/?page=settings&tab=appearance`);
      const heading = page.getByRole("heading", {
        name: "Settings",
        exact: true
      });
      await expect(heading).toBeFocused();
      const mode = page.getByRole("radiogroup", { name: "Mode", exact: true });
      const accent = page.getByRole("radiogroup", {
        name: "Accent",
        exact: true
      });
      const dark = mode.getByRole("radio", { name: "Dark", exact: true });
      await dark.focus();
      const system = mode.getByRole("radio", { name: "System", exact: true });
      // Radix defers roving focus; keep the key down until its focus handler selects.
      await page.keyboard.down("ArrowRight");
      try {
        await expect(system).toBeFocused();
        await expect(system).toBeChecked();
      } finally {
        await page.keyboard.up("ArrowRight");
      }
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "system"
      );
      await expect(mode.locator('[tabindex="0"]')).toHaveCount(1);
      await page.keyboard.press("Tab");
      const graphite = accent.getByRole("radio", {
        name: "Graphite",
        exact: true
      });
      await expect(graphite).toBeFocused();
      const mist = accent.getByRole("radio", { name: "Mist", exact: true });
      await page.keyboard.down("ArrowRight");
      try {
        await expect(mist).toBeFocused();
        await expect(mist).toBeChecked();
      } finally {
        await page.keyboard.up("ArrowRight");
      }
      await expect(page.locator("html")).toHaveAttribute("data-accent", "mist");
      await expect(accent.locator('[tabindex="0"]')).toHaveCount(1);
      await page.keyboard.press("Shift+Tab");
      await expect(system).toBeFocused();

      const playbackTab = page.getByRole("tab", {
        name: "Playback",
        exact: true
      });
      await playbackTab.click();
      await expect(playbackTab).toBeFocused();
      await chooseAccountAction(page, "User guide");
      await expect(
        page.getByRole("heading", { name: "User guide", exact: true })
      ).toBeFocused();
      const browse = page.getByRole("tab", { name: "Browse", exact: true });
      await browse.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("tab", { name: "Edit media", exact: true })
      ).toBeFocused();
      await chooseAccountAction(page, "Settings");
      await expect(heading).toBeFocused();
      if (phone) await expectTouchTargets(page.locator(".settings-page"));
    } finally {
      await context.close();
    }
  });

  test(`keeps unavailable server settings unknown and retains confirmed security warnings (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const page = await context.newPage();
      let failing = true;
      await page.route("**/api/admin/settings", async (route) => {
        if (failing) {
          await gate;
          await route.fulfill({ status: 503, json: { error: "unavailable" } });
        } else {
          await route.fulfill({
            json: {
              ...settings,
              security: { ...settings.security, passwordConfigured: false }
            }
          });
        }
      });
      await page.goto(`${origin}/?page=settings&tab=server`);
      const serverPage = page.locator(".settings-page");
      await expect(
        serverPage.getByRole("button", { name: "Refreshing", exact: true })
      ).toBeDisabled();
      await expect(
        serverPage.getByText("Password missing", { exact: true })
      ).toHaveCount(0);
      await expect(
        serverPage.getByText("Missing", { exact: true })
      ).toHaveCount(0);
      await expect(
        serverPage.getByText("Disabled", { exact: true })
      ).toHaveCount(0);
      await expect(
        serverPage
          .locator(".settings-summary-list > div")
          .filter({ has: page.locator("dt", { hasText: /^Password$/ }) })
          .locator("dd")
      ).toHaveText("—");
      release();
      await expect(serverPage.getByRole("alert")).toContainText(
        "Settings could not be loaded."
      );
      await expect(
        serverPage.getByText("Password missing", { exact: true })
      ).toHaveCount(0);
      failing = false;
      await serverPage
        .getByRole("button", { name: "Refresh", exact: true })
        .click();
      await expect(
        serverPage.getByText("Password missing", { exact: true })
      ).toBeVisible();
      await expect(
        serverPage.getByText("Missing", { exact: true })
      ).toBeVisible();
    } finally {
      release();
      await context.close();
    }
  });

  test(`clears Trash search from matching results and with Escape without losing input focus (${layout})`, async ({
    browser
  }) => {
    const context = await newContext(browser, phone);
    try {
      const page = await context.newPage();
      const record: TrashRecord = {
        id: "utility-trash-photo",
        assetId: "utility-photo",
        name: "holiday.jpg",
        originalRootId: "photos",
        originalFolderId: null,
        originalRelativePath: "holiday.jpg",
        sizeBytes: 1024,
        deletedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        sourceVersion: "1"
      };
      await page.route("**/api/trash?*", async (route) => {
        const search =
          new URL(route.request().url()).searchParams.get("search") ?? "";
        const items = record.name.includes(search) ? [record] : [];
        await route.fulfill({
          json: {
            items,
            retentionDays: 30,
            revision: "1",
            totalRetained: 1,
            page: { total: items.length, offset: 0, limit: 100 }
          }
        });
      });
      await page.goto(`${origin}/?page=trash`);
      const trash = page.locator(".trash-page");
      const input = trash.getByRole("textbox", {
        name: "Search Trash",
        exact: true
      });
      const clear = trash.getByRole("button", {
        name: "Clear search",
        exact: true
      });
      await expect(
        trash.getByRole("heading", { name: record.name, exact: true })
      ).toBeVisible();
      await input.fill("holiday");
      await expect(clear).toBeVisible();
      await input.dispatchEvent("keydown", {
        key: "Escape",
        isComposing: true
      });
      await expect(input).toHaveValue("holiday");
      await input.evaluate((node) => {
        const event = new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true
        });
        event.preventDefault();
        node.dispatchEvent(event);
      });
      await expect(input).toHaveValue("holiday");
      await expect(
        trash.getByRole("heading", { name: record.name, exact: true })
      ).toBeVisible();
      if (phone) await expectTouchTargets(trash.locator(".trash-search"));
      await clear.click();
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(clear).toHaveCount(0);
      await input.fill("no-match");
      await expect(
        trash.getByText("No items match this search.", { exact: true })
      ).toBeVisible();
      await expect(clear).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(
        trash.getByRole("heading", { name: record.name, exact: true })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("uses touch-sized sign-in controls and compact Settings on coarse-pointer landscape screens", async ({
  browser
}, testInfo) => {
  for (const width of [320, 932]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 320 ? 640 : 430 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      const password = page.getByLabel("Password", { exact: true });
      await expectTouchTargets(page.locator(".login-page"));
      const passwordBounds = await password.boundingBox();
      expect(passwordBounds!.height).toBeGreaterThanOrEqual(44);
      await password.fill("aether-e2e-password");
      const show = page.getByRole("button", {
        name: "Show password",
        exact: true
      });
      await show.click();
      await expect(password).toHaveAttribute("type", "text");
      await page.getByRole("button", { name: "Enter", exact: true }).click();
      await expect(page.locator(".library-main")).toBeVisible();
      await page.goto(`${origin}/?page=settings&tab=appearance`);
      const appearance = page.locator(".settings-page");
      await expect(
        appearance.getByRole("radiogroup", { name: "Mode", exact: true })
      ).toBeVisible();
      await expectTouchTargets(appearance);
      await expect
        .poll(() =>
          appearance
            .locator(".settings-tabs-list")
            .evaluate((node) => node.getBoundingClientRect().height)
        )
        .toBeGreaterThanOrEqual(44);
      expect(
        await appearance.evaluate((node) => ({
          overflow: node.scrollWidth > node.clientWidth + 1
        }))
      ).toEqual({ overflow: false });
      await page.screenshot({
        path: testInfo.outputPath(`settings-touch-${width}.png`)
      });
    } finally {
      await context.close();
    }
  }
});

function newContext(browser: Browser, phone: boolean) {
  return browser.newContext({
    storageState,
    viewport: phone
      ? { width: 393, height: 852 }
      : { width: 1440, height: 980 },
    isMobile: phone,
    hasTouch: phone,
    serviceWorkers: "block"
  });
}

async function expectTouchTargets(surface: Locator) {
  const bounds = await surface
    .locator(
      '[data-slot="button"], [data-slot="tabs-trigger"], [data-slot="select-trigger"]'
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getClientRects().length)
        .map((node) => {
          const bounds = node.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        })
    );
  expect(bounds.length).toBeGreaterThan(0);
  for (const target of bounds) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
}
