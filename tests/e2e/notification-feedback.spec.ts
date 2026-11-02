import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type {
  AssetListResponse,
  AssetRecord,
  ComparisonDecisionResponse,
  ComparisonPairResponse,
  ScanJob,
  TagRecord,
  TreeResponse
} from "../../apps/web/src/api/client";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const errorToasts = "[data-sonner-toast][data-type='error']";

async function signInAndScan(page: Page) {
  await page.goto(origin);
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )?.value;
  expect(token).toBeTruthy();
  const headers = { "x-csrf-token": token! };
  const scanned = await page.request.post(`${origin}/api/admin/scan`, {
    headers
  });
  expect(scanned.status()).toBe(202);
  const { jobId } = (await scanned.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${origin}/api/admin/jobs`);
        const { jobs } = (await response.json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("completed");
  const response = await page.request.get(`${origin}/api/tree`);
  expect(response.ok()).toBe(true);
  return { headers, tree: (await response.json()) as TreeResponse };
}

async function openInfo(page: Page, folderId: string, asset: AssetRecord) {
  const query = new URLSearchParams({
    folder: folderId,
    view: "gallery",
    q: asset.name
  });
  await page.goto(`${origin}/?${query}`);
  await page
    .locator(`[data-asset-id="${asset.id}"]`)
    .getByRole("button", { name: `Open ${asset.name}`, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Info", exact: true }).click();
  const info = page.locator(".media-info-sheet");
  await expect(info).toBeVisible();
  return info;
}

test("keeps a failed tag draft in Info and announces only the acknowledged retry", async ({
  page
}) => {
  const { headers, tree } = await signInAndScan(page);
  const folderId = tree.roots[0]!.folderId;
  const response = await page.request.get(
    `${origin}/api/folders/${folderId}/assets?recursive=true&search=family-photo.png&limit=100`
  );
  expect(response.ok()).toBe(true);
  const asset = ((await response.json()) as AssetListResponse).items.find(
    (item) => item.name === "family-photo.png"
  )!;
  expect(asset).toBeTruthy();
  const tagsUrl = `${origin}/api/assets/${asset.id}/tags`;
  const original = await page.request.get(tagsUrl);
  expect(original.ok()).toBe(true);
  const originalNames = (
    (await original.json()) as { tags: TagRecord[] }
  ).tags.map((tag) => tag.displayName);
  const tagName = `Feedback-${randomUUID().slice(0, 8)}`;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldResponse = false;
  let puts = 0;
  await page.route(tagsUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    puts += 1;
    if (puts === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "test_unavailable" })
      });
    const saved = await route.fetch();
    heldResponse = true;
    await held;
    await route.fulfill({ response: saved });
  });
  try {
    const info = await openInfo(page, folderId, asset);
    const input = info.getByPlaceholder("Add a tag", { exact: true });
    await expect(input).toBeEnabled();
    await input.fill(tagName);
    await info.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect(info.getByRole("alert")).toHaveText(
      "Tag changes could not be confirmed. Close and reopen Info to check tags before trying again."
    );
    await expect(input).toHaveValue(tagName);
    await expect(
      info.getByRole("button", { name: `Remove ${tagName}`, exact: true })
    ).toHaveCount(0);
    await expect(page.locator(errorToasts)).toHaveCount(0);
    const success = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Tags added to 1 item" });
    await expect(success).toHaveCount(0);

    await info.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect.poll(() => heldResponse).toBe(true);
    await expect(input).toBeDisabled();
    await expect(
      info.getByRole("button", { name: "Close", exact: true })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(info).toBeVisible();
    await expect(success).toHaveCount(0);
    release();
    await expect(input).toHaveValue("");
    await expect(
      info.getByRole("button", { name: `Remove ${tagName}`, exact: true })
    ).toBeVisible();
    await expect(success).toHaveCount(1);
    await expect(page.locator(errorToasts)).toHaveCount(0);
    expect(puts).toBe(2);
    await info.getByRole("button", { name: "Close", exact: true }).click();
    await expect(info).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    const restored = await page.request.put(tagsUrl, {
      headers,
      data: { tags: originalNames }
    });
    expect(restored.ok()).toBe(true);
  }
});

test("retains reset confirmations on failure and announces the successful item reset once", async ({
  page
}) => {
  const { headers, tree } = await signInAndScan(page);
  const folderId = tree.folders.find(
    (folder) => folder.relativePath === "Trips"
  )!.id;
  const pairResponse = await page.request.get(
    `${origin}/api/folders/${folderId}/comparisons/next?type=image&recursive=true`
  );
  expect(pairResponse.ok()).toBe(true);
  const pair = (await pairResponse.json()) as ComparisonPairResponse;
  const decision = await page.request.post(`${origin}/api/comparisons`, {
    headers,
    data: {
      leftAssetId: pair.left.id,
      rightAssetId: pair.right.id,
      winnerAssetId: pair.left.id,
      mutationId: randomUUID(),
      comparisonGeneration: pair.comparisonGeneration
    }
  });
  expect(decision.ok()).toBe(true);
  const asset = (
    (await decision.json()) as ComparisonDecisionResponse
  ).assets.find((item) => item.id === pair.left.id)!;
  expect(asset.ranking?.comparisonCount).toBeGreaterThan(0);
  const comparisonUrl = `${origin}/api/assets/${asset.id}/comparisons`;
  let resets = 0;
  await page.route(comparisonUrl, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    resets += 1;
    if (resets === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "test_unavailable" })
      });
    return route.continue();
  });
  try {
    const info = await openInfo(page, folderId, asset);
    await info
      .getByRole("button", {
        name: `Reset ${asset.ranking!.comparisonCount} comparisons for ${asset.name}`,
        exact: true
      })
      .click();
    const confirmation = page.getByRole("alertdialog", {
      name: `Reset comparisons for ${asset.name}?`,
      exact: true
    });
    await confirmation
      .getByRole("button", { name: "Reset comparisons", exact: true })
      .click();
    await expect(confirmation.getByRole("alert")).toHaveText(
      "The reset could not be confirmed. Reopen Info to check comparisons before trying again."
    );
    await expect(confirmation).toBeVisible();
    await expect(page.locator(errorToasts)).toHaveCount(0);
    const success = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Comparisons reset for 1 item" });
    await expect(success).toHaveCount(0);
    await confirmation
      .getByRole("button", { name: "Reset comparisons", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(success).toHaveCount(1);
    await expect(page.locator(errorToasts)).toHaveCount(0);
    expect(resets).toBe(2);
    await info.getByRole("button", { name: "Close", exact: true }).click();

    await page.goto(`${origin}/?page=settings&tab=data`);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true })
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /^Scores\b/ }).check();
    await page
      .getByRole("button", { name: "Reset selected data", exact: true })
      .click();
    const resetDialog = page.getByRole("alertdialog", {
      name: "Reset selected library data?",
      exact: true
    });
    const resetInput = resetDialog.getByLabel("Type RESET to continue", {
      exact: true
    });
    await resetInput.fill("RESET");
    let libraryAttempts = 0;
    await page.route(`${origin}/api/admin/database/reset`, async (route) => {
      libraryAttempts += 1;
      return route.fulfill({
        status: libraryAttempts === 1 ? 403 : 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "test_unavailable" })
      });
    });
    for (const message of [
      "The selected data could not be reset. Review the selection and try again.",
      "The reset could not be confirmed. Review the library before trying again."
    ]) {
      await resetDialog
        .getByRole("button", { name: "Reset permanently", exact: true })
        .click();
      await expect(resetDialog.getByRole("alert")).toHaveText(message);
      await expect(resetDialog).toBeVisible();
      await expect(resetInput).toHaveValue("RESET");
      await expect(page.locator(errorToasts)).toHaveCount(0);
      await expect(
        page
          .locator("[data-sonner-toast]")
          .filter({ hasText: "Library data reset" })
      ).toHaveCount(0);
    }
    expect(libraryAttempts).toBe(2);
    await resetDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(resetDialog).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    const cleaned = await page.request.delete(comparisonUrl, { headers });
    expect(cleaned.ok()).toBe(true);
  }
});
