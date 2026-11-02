import { expect, test } from "@playwright/test";
import type { ScanJob } from "../../apps/web/src/api/client";

test("announces new scan problems once per job and keeps routine scans quiet", async ({
  browser
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`
  });
  const page = await context.newPage();
  let latest = scan("historical-scan", "failed");
  let reads = 0;
  try {
    await page.route("**/api/admin/jobs", (route) => {
      reads += 1;
      return route.fulfill({ json: { jobs: [latest] } });
    });
    await page.route("**/api/admin/watch", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          running: false,
          debounceMs: 2_000,
          watchedDirectories: 1,
          lastEventAt: null,
          lastScanJobId: null,
          lastError: null
        }
      })
    );
    await page.goto("/");
    await page
      .getByLabel("Password", { exact: true })
      .fill("aether-e2e-password");
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Gallery view" })
    ).toBeVisible();
    await expect.poll(() => reads).toBe(1);
    const notifications = page.locator("[data-sonner-toast]");
    await expect(notifications).toHaveCount(0);

    latest = scan("routine-scan", "completed");
    await expect.poll(() => reads, { timeout: 20_000 }).toBeGreaterThan(1);
    await expect(notifications).toHaveCount(0);

    latest = scan("first-new-problem", "failed");
    await expect(notifications).toContainText(["Scan failed"], {
      timeout: 20_000
    });
    await notifications.getByRole("button", { name: "Close toast" }).click();
    await expect(notifications).toHaveCount(0);
    const previousReads = reads;
    await expect
      .poll(() => reads, { timeout: 20_000 })
      .toBeGreaterThan(previousReads);
    await expect(notifications).toHaveCount(0);

    latest = scan("second-new-problem", "failed");
    await expect(notifications).toContainText(["Scan failed"], {
      timeout: 20_000
    });
    await expect(notifications).toHaveCount(1);
  } finally {
    await context.close();
  }
});

function scan(id: string, status: "completed" | "failed"): ScanJob {
  return {
    id,
    type: "scan",
    status,
    attempts: 1,
    error: null,
    result: null,
    progress: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:01.000Z"
  };
}
