import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FileOperation,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
test.use({ baseURL: productionBaseURL });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
async function headers(page: Page) {
  return {
    "x-csrf-token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value
  };
}
async function scan(page: Page) {
  const response = await page.request.post("/api/admin/scan", {
    headers: await headers(page)
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const { jobs } = (await (
          await page.request.get("/api/admin/jobs")
        ).json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
}
async function signIn(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Gallery view" })
  ).toBeVisible();
}
async function closeActivity(page: Page) {
  const activity = page.getByRole("dialog", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  await activity.getByRole("button", { name: "Close", exact: true }).click();
  await expect(activity).toBeHidden();
}

test("reviews each move conflict, skips without a job and submits only the chosen items", async ({
  page
}, testInfo) => {
  const name = `Conflicts-${randomUUID()}`;
  const owned = path.resolve(".e2e", "media", name);
  await mkdir(path.join(owned, "Source"), { recursive: true });
  await mkdir(path.join(owned, "Destination"));
  for (const file of ["one.png", "two.png", "free.png"])
    await writeFile(path.join(owned, "Source", file), png);
  for (const file of ["one.png", "two.png"])
    await writeFile(path.join(owned, "Destination", file), png);
  try {
    await signIn(page);
    await scan(page);
    const tree = (await (
      await page.request.get("/api/tree")
    ).json()) as TreeResponse;
    const source = tree.folders.find(
      (folder) => folder.relativePath === `${name}/Source`
    )!;
    const destination = tree.folders.find(
      (folder) => folder.relativePath === `${name}/Destination`
    )!;
    await page.goto(`/?folder=${source.id}&view=gallery&sort=filename`);
    await page
      .getByRole("button", { name: "Select media", exact: true })
      .click();
    for (const file of ["one.png", "two.png"])
      await page
        .getByRole("button", { name: `Select ${file}`, exact: true })
        .click();
    const submitted: Array<{
      items: Array<{ assetId: string; conflict: string }>;
    }> = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/file-operations")
      )
        submitted.push(request.postDataJSON());
    });
    const openMove = async () => {
      await page
        .getByRole("region", { name: "Selected media actions" })
        .getByRole("button", { name: "Move to…", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Move media",
        exact: true
      });
      await dialog
        .getByRole("button", { name: "Back to parent folder", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Open Destination", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Move here", exact: true })
        .click();
      await expect(
        dialog.getByRole("region", { name: "Name conflicts", exact: true })
      ).toBeVisible();
      return dialog;
    };
    let dialog = await openMove();
    await expect(dialog.getByRole("status")).toContainText(
      "0 items to move · 2 skipped"
    );
    await expect(dialog).toContainText("Keep as one (2).png");
    await expect(dialog).toContainText("Keep as two (2).png");
    expect(submitted).toHaveLength(0);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(submitted).toHaveLength(0);
    expect(await readFile(path.join(owned, "Source", "one.png"))).toEqual(png);
    await page
      .getByRole("button", { name: "Select free.png", exact: true })
      .click();
    dialog = await openMove();
    await dialog
      .getByRole("checkbox", {
        name: "Apply to remaining conflicts",
        exact: true
      })
      .check();
    await dialog
      .getByRole("combobox", {
        name: "Conflict choice for one.png",
        exact: true
      })
      .click();
    await page.getByRole("option", { name: "Keep both", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(
      "3 items to move · 0 skipped"
    );
    await dialog
      .getByRole("checkbox", {
        name: "Apply to remaining conflicts",
        exact: true
      })
      .uncheck();
    await dialog
      .getByRole("combobox", {
        name: "Conflict choice for one.png",
        exact: true
      })
      .click();
    await page.getByRole("option", { name: "Skip", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(
      "2 items to move · 1 skipped"
    );
    await dialog.screenshot({
      path: testInfo.outputPath("name-conflicts-desktop.png"),
      animations: "disabled"
    });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/file-operations")
    );
    await dialog
      .getByRole("button", { name: "Move here", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const operation = (await response.json()) as FileOperation;
    await expect
      .poll(
        async () =>
          (
            (await (
              await page.request.get(`/api/file-operations/${operation.id}`)
            ).json()) as FileOperation
          ).status
      )
      .toBe("completed");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.items.map((item) => item.conflict).sort()).toEqual([
      "keep-both",
      "skip"
    ]);
    await closeActivity(page);
    expect(await readFile(path.join(owned, "Source", "one.png"))).toEqual(png);
    expect(await readFile(path.join(owned, "Destination", "one.png"))).toEqual(
      png
    );
    expect(await readFile(path.join(owned, "Destination", "two.png"))).toEqual(
      png
    );
    expect(
      await readFile(path.join(owned, "Destination", "two (2).png"))
    ).toEqual(png);
    expect(await readFile(path.join(owned, "Destination", "free.png"))).toEqual(
      png
    );
    await page.goto(`/?folder=${destination.id}&view=gallery`);
    await expect(
      page.getByRole("button", { name: "Open two (2).png", exact: true })
    ).toBeVisible();
  } finally {
    await rm(owned, { recursive: true, force: true });
    if (!page.isClosed()) await scan(page);
  }
});

test("reviews duplicate upload names on phone before admitting files and keeps both names distinct", async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: productionBaseURL,
    viewport: { width: 320, height: 760 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const name = `Upload-conflicts-${randomUUID()}`;
  const filename = "a-long-photo-name-for-a-narrow-phone-layout.png";
  const owned = path.resolve(".e2e", "media", name);
  await mkdir(owned);
  await writeFile(path.join(owned, filename), png);
  try {
    await signIn(page);
    await scan(page);
    const tree = (await (
      await page.request.get("/api/tree")
    ).json()) as TreeResponse;
    const folder = tree.folders.find((entry) => entry.relativePath === name)!;
    await page.goto(`/?folder=${folder.id}&view=gallery`);
    await page
      .getByRole("region", { name: "Library controls" })
      .getByRole("button", { name: "Add media", exact: true })
      .click();
    const addMedia = page.getByRole("region", {
      name: "Add media",
      exact: true
    });
    const admission: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/uploads"))
        admission.push(request.headers()["upload-metadata"]!);
    });
    const files = [0, 1].map(() => ({
      name: filename,
      mimeType: "image/png",
      buffer: png
    }));
    await addMedia
      .getByLabel("Choose media", { exact: true })
      .setInputFiles(files);
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect(
      addMedia.getByRole("region", { name: "Name conflicts", exact: true })
    ).toBeVisible();
    expect(admission).toHaveLength(0);
    await addMedia.getByRole("button", { name: "Done", exact: true }).click();
    await expect(addMedia.getByRole("status")).toContainText(
      "2 files skipped."
    );
    expect(admission).toHaveLength(0);
    await addMedia
      .getByLabel("Choose media", { exact: true })
      .setInputFiles(files);
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await addMedia
      .getByRole("checkbox", {
        name: "Apply to remaining conflicts",
        exact: true
      })
      .check();
    const choice = addMedia
      .getByRole("combobox", {
        name: `Conflict choice for ${filename}`,
        exact: true
      })
      .first();
    await choice.click();
    await page.getByRole("option", { name: "Keep both", exact: true }).click();
    await expect(addMedia.getByRole("status")).toContainText(
      "2 items to add · 0 skipped"
    );
    await expect(addMedia).toContainText(
      "Keep as a-long-photo-name-for-a-narrow-phone-layout (2).png"
    );
    await expect(addMedia).toContainText(
      "Keep as a-long-photo-name-for-a-narrow-phone-layout (3).png"
    );
    const bounds = await choice.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true);
    await addMedia.screenshot({
      path: testInfo.outputPath("name-conflicts-phone.png"),
      animations: "disabled"
    });
    await addMedia
      .getByRole("button", { name: "Add files", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          const { items } = (await (
            await page.request.get("/api/file-operations")
          ).json()) as { items: FileOperation[] };
          return items.filter(
            (operation) =>
              operation.type === "add-media" &&
              operation.status === "completed" &&
              operation.items.some((item) => item.asset?.folderId === folder.id)
          ).length;
        },
        { timeout: 30_000 }
      )
      .toBe(2);
    expect(admission).toHaveLength(2);
    expect(
      admission.every((metadata) =>
        metadata.includes(
          `conflict ${Buffer.from("keep-both").toString("base64")}`
        )
      )
    ).toBe(true);
    expect(await readFile(path.join(owned, filename))).toEqual(png);
    for (const suffix of [2, 3])
      expect(
        await readFile(
          path.join(owned, filename.replace(".png", ` (${suffix}).png`))
        )
      ).toEqual(png);
  } finally {
    await rm(owned, { recursive: true, force: true });
    if (!page.isClosed()) await scan(page);
    await context.close();
  }
});
