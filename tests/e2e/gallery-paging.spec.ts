import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

test.use({
  baseURL: `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

for (const reorder of [false, true]) {
  test(
    reorder
      ? "retains the visible gallery after a paging revision changes its loaded order"
      : "continues gallery paging after a revision change with the same loaded order",
    async ({ page }) => {
      const fixtureName = `Paging-${randomUUID()}`;
      const directory = path.resolve(".e2e", "media", fixtureName);
      await mkdir(directory);
      for (let index = 0; index < 82; index++)
        await writeFile(
          path.join(directory, `${String(index).padStart(4, "0")}.png`),
          png
        );
      await page.goto("/");
      await page
        .getByLabel("Password", { exact: true })
        .fill("aether-e2e-password");
      await page.getByRole("button", { name: "Enter", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Gallery view" })
      ).toBeVisible();
      const headers = {
        "x-csrf-token": (await page.context().cookies()).find(
          (cookie) => cookie.name === "aether_csrf"
        )!.value
      };
      try {
        const { jobId } = (await (
          await page.request.post("/api/admin/scan", { headers })
        ).json()) as { jobId: string };
        await expect
          .poll(async () => {
            const { jobs } = (await (
              await page.request.get("/api/admin/jobs")
            ).json()) as { jobs: ScanJob[] };
            return jobs.find((job) => job.id === jobId)?.status;
          })
          .toBe("completed");
        const tree = (await (
          await page.request.get("/api/tree")
        ).json()) as TreeResponse;
        const folder = tree.folders.find(
          (entry) => entry.relativePath === fixtureName
        )!;
        const sortQuery = reorder ? "score&order=desc" : "filename&order=asc";
        const initial = (await (
          await page.request.get(
            `/api/folders/${folder.id}/assets?limit=100&sort=${sortQuery}`
          )
        ).json()) as AssetListResponse;
        const first = initial.items[0]!;
        const last = initial.items[81]!;
        let rejected = false;
        let appendRequests = 0;
        let appended = false;
        await page.route(
          `**/api/folders/${folder.id}/assets?*`,
          async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.get("offset") === "80") {
              appendRequests += 1;
              if (!rejected) {
                rejected = true;
                if (reorder) {
                  const changed = await page.request.patch(
                    `/api/assets/${last.id}/score`,
                    { headers, data: { score: 10 } }
                  );
                  expect(changed.ok()).toBe(true);
                }
                await route.fulfill({
                  status: 409,
                  json: { error: "library_changed" }
                });
                return;
              }
              appended = true;
            }
            await route.continue();
          }
        );
        await page.goto(
          `/?folder=${folder.id}&view=gallery&sort=${reorder ? "score" : "filename"}&order=${reorder ? "desc" : "asc"}`
        );
        const gallery = page.locator(".gallery-viewport");
        await expect(gallery).toHaveAttribute("aria-busy", "false");
        await expect(
          page.getByRole("button", { name: `Open ${first.name}`, exact: true })
        ).toBeVisible();
        await gallery.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect.poll(() => rejected).toBe(true);
        const controls = page.getByRole("region", { name: "Library results" });
        if (reorder) {
          const update = controls.getByRole("button", {
            name: "Update results",
            exact: true
          });
          await expect(update).toBeEnabled();
          expect(appendRequests).toBe(1);
          expect(appended).toBe(false);
          await expect(controls.getByRole("status")).toContainText("80 shown");
          await gallery.evaluate((element) => {
            element.scrollTop = 0;
          });
          await expect(
            page.getByRole("button", {
              name: `Open ${first.name}`,
              exact: true
            })
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: `Open ${last.name}`, exact: true })
          ).toHaveCount(0);
          await update.click();
          await expect(
            page.getByRole("button", { name: `Open ${last.name}`, exact: true })
          ).toBeVisible();
        } else {
          await expect.poll(() => appended).toBe(true);
          await expect(
            controls.getByRole("button", {
              name: "Update results",
              exact: true
            })
          ).toHaveCount(0);
          await page
            .getByRole("button", { name: "Select media", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Selection options", exact: true })
            .click();
          await page
            .getByRole("menuitem", { name: "Select loaded", exact: true })
            .click();
          await expect(page.locator(".batch-summary")).toHaveText(
            /82\s*items selected/
          );
          await page.getByRole("button", { name: "Done", exact: true }).click();
          await gallery.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          await expect(
            page.getByRole("button", { name: `Open ${last.name}`, exact: true })
          ).toBeVisible();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
        if (!page.isClosed())
          await page.request.post("/api/admin/scan", { headers });
      }
    }
  );
}
