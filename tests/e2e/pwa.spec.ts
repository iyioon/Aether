import { expect, test } from "@playwright/test";

test("keeps standalone status-bar shading within the top safe area on app and offline pages", async ({
  browser,
  browserName
}) => {
  test.skip(browserName !== "chromium", "Requires CDP safe-area emulation");
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 }
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
    for (const pathname of ["/", "/offline.html"]) {
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 59 }
      });
      await page.goto(`${origin}${pathname}`);
      await expect(
        page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')
      ).toHaveAttribute("content", "black-translucent");
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        "content",
        /viewport-fit=cover/
      );
      const statusBar = () =>
        page.evaluate(() => {
          const style = getComputedStyle(document.body, "::after");
          return {
            content: style.content,
            height: style.height,
            pointerEvents: style.pointerEvents,
            background: style.backgroundImage
          };
        });
      expect((await statusBar()).content).toBe("none");

      // Chrome does not emulate standalone CSS. Activate the shipped rule only;
      // this verifies its geometry, not iOS installation or system-bar behavior.
      const activated = await page.evaluate(() => {
        let count = 0;
        const activate = (rules: CSSRuleList) => {
          for (const rule of rules) {
            if (
              rule instanceof CSSMediaRule &&
              rule.conditionText === "(display-mode: standalone)"
            ) {
              rule.media.mediaText = "all";
              count++;
            }
            if (rule instanceof CSSGroupingRule) activate(rule.cssRules);
          }
        };
        for (const sheet of document.styleSheets) activate(sheet.cssRules);
        return count;
      });
      expect(activated).toBeGreaterThan(0);
      expect(await statusBar()).toMatchObject({
        height: "59px",
        pointerEvents: "none"
      });
      expect((await statusBar()).background).toContain("linear-gradient");
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 0 }
      });
      expect((await statusBar()).height).toBe("0px");
    }
  } finally {
    await context.close();
  }
});

test("reopens the production shell offline without caching private API data", async ({
  browser
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
  try {
    await page.goto(`${origin}/offline.html`);
    await page.evaluate(async () => {
      const unrelated = await caches.open("unrelated-shell");
      await unrelated.put(
        "/index.html",
        new Response("<h1>Wrong application shell</h1>", {
          headers: { "content-type": "text/html" }
        })
      );
    });
    await page.goto(`${origin}/?launch=resume`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("aether-e2e-password");
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Server", exact: true }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true }
          )
        );
    });
    const cachedUrls = await page.evaluate(async () => {
      const names = await caches.keys();
      const requests = await Promise.all(
        names
          .filter((name) => name.startsWith("aether-shell-"))
          .map(async (name) => (await caches.open(name)).keys())
      );
      return requests.flat().map((request) => request.url);
    });
    expect(
      cachedUrls.some((url) => new URL(url).pathname === "/index.html")
    ).toBe(true);
    expect(
      cachedUrls.some((url) => new URL(url).pathname.startsWith("/api/"))
    ).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Aether is unavailable" })
    ).toBeVisible();
    await context.setOffline(false);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Server", exact: true })
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    await context.close();
  }
});
