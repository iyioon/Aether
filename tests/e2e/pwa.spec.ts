import { expect, test } from "@playwright/test";

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
