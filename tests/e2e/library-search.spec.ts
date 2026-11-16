import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetListResponse,
  ScanJob,
  TreeResponse
} from "../../apps/web/src/api/client";
import { openLibrarySearch } from "./library-search";

const origin = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
const fixtureName = "library-search-fixture";
const directory = path.resolve(".e2e/media", fixtureName);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let tree: TreeResponse;
let folderId: string;

async function scan(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "aether_csrf"
  )!.value;
  const response = await page.request.post(`${origin}/api/admin/scan`, {
    headers: { "x-csrf-token": csrf }
  });
  expect(response.status()).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const { jobs } = (await (
          await page.request.get(`${origin}/api/admin/jobs`)
        ).json()) as { jobs: ScanJob[] };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    await page
      .getByLabel("Password", { exact: true })
      .fill("aether-e2e-password");
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Gallery view", exact: true })
    ).toBeVisible();
    for (const parent of ["North", "South"]) {
      await mkdir(path.join(directory, parent, "Album"), { recursive: true });
      await writeFile(
        path.join(
          directory,
          parent,
          "Album",
          `${parent.toLowerCase()}-photo.png`
        ),
        png
      );
    }
    await writeFile(path.join(directory, "top-photo.png"), png);
    await scan(page);
    tree = (await (
      await page.request.get(`${origin}/api/tree`)
    ).json()) as TreeResponse;
    folderId = tree.folders.find(
      (folder) => folder.relativePath === fixtureName
    )!.id;
    const { items } = (await (
      await page.request.get(
        `${origin}/api/folders/${folderId}/assets?sort=filename&limit=10`
      )
    ).json()) as AssetListResponse;
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "aether_csrf"
    )!.value;
    for (const asset of items) {
      const tags =
        asset.name === "north-photo.png"
          ? ["search-north", "search-shared"]
          : asset.name === "south-photo.png"
            ? ["search-south", "search-shared"]
            : [];
      expect(
        (
          await page.request.put(`${origin}/api/assets/${asset.id}/tags`, {
            headers: { "x-csrf-token": csrf },
            data: { tags }
          })
        ).ok()
      ).toBe(true);
    }
    storageState = await page.context().storageState();
  } finally {
    await page.close();
  }
});

test.afterAll(async ({ browser }) => {
  await rm(directory, { recursive: true, force: true });
  if (!storageState) return;
  const context = await browser.newContext({ storageState });
  try {
    await scan(await context.newPage());
  } finally {
    await context.close();
  }
});

for (const phone of [false, true]) {
  const layout = phone ? "phone" : "desktop";
  test(`stages search criteria, cancels drafts and submits with Enter without interrupting composition (${layout})`, async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${origin}/?view=gallery&folder=${folderId}&sort=filename`
      );
      const gallery = page.getByRole("region", {
        name: "Gallery view",
        exact: true
      });
      await expect(gallery).toHaveAttribute("aria-busy", "false");
      await expect(
        page.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(3);
      const queries: URL[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (/\/api\/folders\/[^/]+\/assets$/.test(url.pathname))
          queries.push(url);
      });
      const trigger = page.getByRole("button", { name: "Search", exact: true });
      await page.keyboard.press("/");
      const dialog = page.getByRole("dialog", { name: "Search", exact: true });
      const input = dialog.getByRole("searchbox", {
        name: "Filename or path",
        exact: true
      });
      await expect(input).toBeFocused();
      const screenshotPath = testInfo.outputPath(`search-dialog-${layout}.png`);
      await page.screenshot({ path: screenshotPath, animations: "disabled" });
      await testInfo.attach(`search-dialog-${layout}`, {
        path: screenshotPath,
        contentType: "image/png"
      });
      await input.press("Tab");
      await expect(
        dialog.getByRole("button", { name: /^Folder, / })
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("combobox", { name: "Tag status", exact: true })
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("textbox", { name: "Tags", exact: true })
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("radio", { name: "All", exact: true })
      ).toBeFocused();
      await input.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true })
      ).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: "Search", exact: true })
      ).toBeFocused();
      await input.focus();
      await input.fill("north-photo");
      await dialog.getByRole("radio", { name: "Images", exact: true }).check();
      await input.dispatchEvent("compositionstart");
      await input.dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true
      });
      await expect(dialog).toBeVisible();
      expect(new URL(page.url()).searchParams.get("q")).toBeNull();
      expect(queries).toHaveLength(0);
      await expect(
        page.locator(
          '.virtual-gallery button[aria-label^="Open "][aria-label$="photo.png"]'
        )
      ).toHaveCount(3);
      await input.dispatchEvent("compositionend");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(trigger).toBeFocused();
      await openLibrarySearch(page);
      await expect(input).toHaveValue("");
      await expect(
        dialog.getByRole("radio", { name: "All", exact: true })
      ).toBeChecked();
      await input.fill("discard-on-escape");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await openLibrarySearch(page);
      await expect(input).toHaveValue("");
      await input.fill("north-photo");
      await input.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(
        gallery.getByRole("button", {
          name: "Open north-photo.png",
          exact: true
        })
      ).toBeVisible();
      await expect(
        gallery.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(1);
      expect(new URL(page.url()).searchParams.get("q")).toBe("north-photo");
      expect(
        queries.some((url) => url.searchParams.get("search") === "north-photo")
      ).toBe(true);
      await expect(trigger).toHaveAccessibleDescription(/active|north-photo/i);
      await page.reload();
      await openLibrarySearch(page);
      await expect(input).toHaveValue("north-photo");
      await dialog.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      expect(new URL(page.url()).searchParams.get("q")).toBe("north-photo");
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        gallery.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(3);
      expect(new URL(page.url()).searchParams.get("folder")).toBe(folderId);
      expect(new URL(page.url()).searchParams.get("q")).toBeNull();
    } finally {
      await context.close();
    }
  });

  test(`combines filename, tags and matching rules and restores them from the URL (${layout})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 393, height: 852 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${origin}/?view=gallery&folder=${folderId}&sort=filename`
      );
      const dialog = await openLibrarySearch(page);
      const input = dialog.getByRole("searchbox", {
        name: "Filename or path",
        exact: true
      });
      await input.fill("photo");
      const tags = dialog.getByRole("textbox", { name: "Tags", exact: true });
      await tags.fill("search-north");
      await tags.press("Enter");
      await tags.fill("search-shared");
      await expect(dialog).toBeVisible();
      expect(new URL(page.url()).searchParams.getAll("tag")).toEqual([]);
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Open north-photo.png", exact: true })
      ).toBeVisible();
      await page.reload();
      await openLibrarySearch(page);
      await expect(input).toHaveValue("photo");
      await expect(
        dialog.getByRole("button", { name: /^Remove search-.* tag filter$/ })
      ).toHaveCount(2);
      await dialog
        .getByRole("combobox", { name: "Tag matching", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Match any tag", exact: true })
        .click();
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(2);
      expect(new URL(page.url()).searchParams.get("tagMatch")).toBe("any");
      await openLibrarySearch(page);
      await input.fill("South/Album");
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Open south-photo.png", exact: true })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test(`distinguishes duplicate folder names and searches read-only folders (${layout})`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState,
      viewport: phone
        ? { width: 320, height: 760 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone
    });
    try {
      const page = await context.newPage();
      const selectedFolder = tree.folders.find(
        (folder) => folder.id === folderId
      )!;
      const selectedRoot = tree.roots.find(
        (root) => root.id === selectedFolder.rootId
      )!;
      const rootLabel = selectedRoot.label;
      const readOnlyTree = {
        ...tree,
        roots: tree.roots.map((root) => ({
          ...root,
          writable: false,
          allowedActions: []
        })),
        folders: [
          ...tree.folders.map((folder) => ({
            ...folder,
            writable: false,
            allowedActions: []
          })),
          ...Array.from({ length: 55 }, (_, index) => ({
            id: `scope-extra-folder-${index}`,
            rootId: selectedRoot.id,
            parentId: selectedRoot.folderId,
            relativePath: `000-scope-folder-${index}`,
            label: `000-scope-folder-${index}`,
            assetCount: 0,
            writable: false,
            allowedActions: []
          }))
        ]
      };
      await page.route("**/api/tree", (route) =>
        route.fulfill({ json: readOnlyTree })
      );
      await page.goto(`${origin}/?view=gallery&folder=${folderId}`);
      const dialog = await openLibrarySearch(page);
      const scope = dialog.getByRole("button", { name: /^Folder, / });
      await scope.click();
      const picker = page.getByRole("dialog", {
        name: "Choose folder",
        exact: true
      });
      const find = picker.getByRole("combobox", {
        name: "Find folder",
        exact: true
      });
      await expect(picker.getByRole("option")).toHaveCount(50);
      const currentScope = picker.getByRole("option", {
        name: `${rootLabel} / ${fixtureName}`,
        exact: true
      });
      await expect(currentScope).toBeVisible();
      await expect(currentScope).toBeInViewport();
      await expect(currentScope).toHaveAttribute("aria-selected", "true");
      await expect(currentScope).toHaveAttribute("data-active", "true");
      await expect(find).toHaveAttribute(
        "aria-activedescendant",
        (await currentScope.getAttribute("id"))!
      );
      const currentScopeName = await scope.getAttribute("aria-label");
      await find.press("Enter");
      await expect(picker).toHaveCount(0);
      await expect(scope).toHaveAccessibleName(currentScopeName!);
      await scope.click();
      await find.fill("Album");
      await expect(picker.getByRole("option").first()).toHaveAttribute(
        "data-active",
        "true"
      );
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(scope).toBeFocused();
      expect(new URL(page.url()).searchParams.get("folder")).toBe(folderId);
      await scope.click();
      await find.fill("Album");
      const originalScope = await scope.getAttribute("aria-label");
      await find.press("Tab");
      await expect(picker).toHaveCount(0);
      await expect(
        dialog.getByRole("combobox", { name: "Tag status", exact: true })
      ).toBeFocused();
      await expect(scope).toHaveAccessibleName(originalScope!);
      await scope.click();
      await find.fill("Album");
      await find.press("Shift+Tab");
      await expect(picker).toHaveCount(0);
      await expect(scope).toBeFocused();
      await expect(scope).toHaveAccessibleName(originalScope!);
      await scope.click();
      await find.fill("Album");
      const north = picker.getByRole("option", {
        name: `${rootLabel} / ${fixtureName} / North / Album`,
        exact: true
      });
      const south = picker.getByRole("option", {
        name: `${rootLabel} / ${fixtureName} / South / Album`,
        exact: true
      });
      await expect(north).toBeVisible();
      await expect(south).toBeVisible();
      await expect(south).toBeEnabled();
      await south.click();
      await expect(picker).toHaveCount(0);
      await expect(scope).toHaveAccessibleName(
        `Folder, ${rootLabel} / ${fixtureName} / South / Album`
      );
      expect(new URL(page.url()).searchParams.get("folder")).toBe(folderId);
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      const southId = tree.folders.find(
        (folder) => folder.relativePath === `${fixtureName}/South/Album`
      )!.id;
      await expect
        .poll(() => new URL(page.url()).searchParams.get("folder"))
        .toBe(southId);
      await expect(
        page.getByRole("button", { name: "Open south-photo.png", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open north-photo.png", exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

for (const launch of [
  "explicit link",
  "saved location",
  "initial Library"
] as const) {
  test(`retains a drafted search while folders load from ${launch}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: storageState.cookies, origins: [] },
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce"
    });
    let releaseTree!: () => void;
    const treeGate = new Promise<void>((resolve) => {
      releaseTree = resolve;
    });
    try {
      const page = await context.newPage();
      const explicitUrl = `${origin}/?view=gallery&folder=${folderId}&q=photo`;
      if (launch === "saved location") {
        await page.goto(explicitUrl);
        await expect(
          page.getByRole("region", { name: "Gallery view", exact: true })
        ).toHaveAttribute("aria-busy", "false");
        await expect(
          page.getByRole("button", { name: /^Open .*photo\.png$/ })
        ).toHaveCount(3);
      }
      let treeRequests = 0;
      await page.route("**/api/tree", async (route) => {
        treeRequests += 1;
        if (treeRequests === 1) {
          await treeGate;
          if (launch === "explicit link") {
            await route.fulfill({
              status: 503,
              json: { error: "temporarily_unavailable" }
            });
            return;
          }
        }
        await route.fulfill({ json: tree });
      });
      await page.goto(
        launch === "explicit link"
          ? explicitUrl
          : launch === "saved location"
            ? `${origin}/?launch=resume`
            : origin
      );
      await expect.poll(() => treeRequests).toBe(1);
      const dialog = await openLibrarySearch(page);
      const locationBeforeDraft = page.url();
      const input = dialog.getByRole("searchbox", {
        name: "Filename or path",
        exact: true
      });
      await expect(input).toHaveValue(
        launch === "initial Library" ? "" : "photo"
      );
      await input.fill("north-photo");
      const tagInput = dialog.getByRole("textbox", {
        name: "Tags",
        exact: true
      });
      await tagInput.fill("search-north");
      await tagInput.press("Enter");
      const submit = dialog.getByRole("button", {
        name: "Search",
        exact: true
      });
      await expect(submit).toBeDisabled();
      await expect(dialog).toBeVisible();
      expect(page.url()).toBe(locationBeforeDraft);
      releaseTree();
      if (launch === "explicit link") {
        const retry = dialog.getByRole("button", {
          name: "Retry loading folders",
          exact: true
        });
        await expect(retry).toBeVisible();
        await expect(submit).toBeDisabled();
        await expect(input).toHaveValue("north-photo");
        await expect(
          dialog.getByRole("button", {
            name: "Remove search-north tag filter",
            exact: true
          })
        ).toBeVisible();
        await retry.click();
      }
      const expectedFolderId =
        launch === "initial Library" ? tree.roots[0]!.folderId : folderId;
      const root = tree.roots.find(
        (entry) =>
          launch === "initial Library" ||
          entry.id ===
            tree.folders.find((folder) => folder.id === folderId)!.rootId
      )!;
      const expectedLabel =
        launch === "initial Library"
          ? root.label
          : `${root.label} / ${fixtureName}`;
      await expect(
        dialog.getByRole("button", {
          name: `Folder, ${expectedLabel}`,
          exact: true
        })
      ).toBeEnabled();
      await expect(submit).toBeEnabled();
      await expect(input).toHaveValue("north-photo");
      await expect(
        dialog.getByRole("button", {
          name: "Remove search-north tag filter",
          exact: true
        })
      ).toBeVisible();
      await submit.click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("folder"))
        .toBe(expectedFolderId);
      expect(new URL(page.url()).searchParams.get("q")).toBe("north-photo");
      expect(new URL(page.url()).searchParams.getAll("tag")).toEqual([
        "search-north"
      ]);
      await expect(
        page.getByRole("button", { name: "Open north-photo.png", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Open .*photo\.png$/ })
      ).toHaveCount(1);
      if (launch === "explicit link") expect(treeRequests).toBe(2);
    } finally {
      releaseTree();
      await context.close();
    }
  });
}

test("keeps long search forms and actions reachable around phone safe areas and a short keyboard viewport", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const url = new URL(`/?view=gallery&folder=${folderId}`, origin);
    for (let index = 0; index < 20; index++)
      url.searchParams.append(
        "tag",
        `search-filter-${index}-${"x".repeat(24)}`
      );
    await page.goto(url.href);
    const dialog = await openLibrarySearch(page);
    const tags = dialog.getByRole("textbox", { name: "Tags", exact: true });
    await expect(tags).toBeDisabled();
    await dialog
      .getByRole("button", { name: /^Remove search-filter-0-/ })
      .click();
    await expect(tags).toBeEnabled();
    await tags.fill("replacement");
    await dialog
      .getByRole("button", { name: "Add tag filter", exact: true })
      .click();
    await expect(tags).toBeDisabled();
    const cdp = await context.newCDPSession(page);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 852 },
      { width: 932, height: 430 },
      { width: 393, height: 360 }
    ]) {
      await page.setViewportSize(viewport);
      const landscape = viewport.width > viewport.height;
      const insets = {
        top: landscape ? 0 : 59,
        bottom: 34,
        left: landscape ? 44 : 0,
        right: landscape ? 44 : 0
      };
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "Search", exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "Clear", exact: true })
      ).toBeInViewport({ ratio: 1 });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(insets.top);
      expect(bounds.x).toBeGreaterThanOrEqual(insets.left);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        viewport.width - insets.right
      );
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        viewport.height - insets.bottom
      );
      await expect
        .poll(() =>
          dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
        )
        .toBe(true);
    }
    await dialog.getByRole("button", { name: "Clear", exact: true }).click();
    const input = dialog.getByRole("searchbox", {
      name: "Filename or path",
      exact: true
    });
    await input.scrollIntoViewIfNeeded();
    await input.fill("north");
    await expect(input).toHaveValue("north");
    expect(
      await input.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).fontSize)
      )
    ).toBeGreaterThanOrEqual(16);
    for (const name of ["Clear", "Cancel", "Search"]) {
      const target = (await dialog
        .getByRole("button", { name, exact: true })
        .boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Search", exact: true })
    ).toBeFocused();
    expect(new URL(page.url()).searchParams.getAll("tag")).toHaveLength(20);
  } finally {
    await context.close();
  }
});

test("keeps Search actions within the visual viewport while the phone keyboard opens and pans", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce"
  });
  try {
    await context.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        width: 393,
        height: 852,
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
        scale: 1
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        get: () => viewport
      });
    });
    const page = await context.newPage();
    const url = new URL(`/?view=gallery&folder=${folderId}`, origin);
    for (let index = 0; index < 20; index++)
      url.searchParams.append("tag", `keyboard-filter-${index}`);
    await page.goto(url.href);
    const dialog = await openLibrarySearch(page);
    const body = dialog.locator(".library-search-body");
    const footer = dialog.locator(".library-search-footer");
    const before = (await dialog.boundingBox())!;
    for (const viewport of [
      { height: 420, offsetTop: 0 },
      { height: 320, offsetTop: 90 }
    ]) {
      await page.evaluate((next) => {
        Object.assign(window.visualViewport!, next);
        window.visualViewport!.dispatchEvent(new Event("resize"));
        window.visualViewport!.dispatchEvent(new Event("scroll"));
      }, viewport);
      await expect
        .poll(async () => {
          const bounds = (await footer.boundingBox())!;
          return {
            top: bounds.y >= viewport.offsetTop,
            bottom:
              bounds.y + bounds.height <= viewport.offsetTop + viewport.height
          };
        })
        .toEqual({ top: true, bottom: true });
      await expect
        .poll(() =>
          body.evaluate((node) => node.scrollHeight > node.clientHeight)
        )
        .toBe(true);
      await expect
        .poll(() => body.evaluate((node) => node.clientHeight))
        .toBeGreaterThan(40);
      expect(await page.evaluate(() => window.innerHeight)).toBe(852);
      for (const name of ["Cancel", "Search"])
        await expect(
          dialog.getByRole("button", { name, exact: true })
        ).toBeInViewport();
      await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
      await expect(
        dialog.getByRole("button", { name: "Search", exact: true })
      ).toBeVisible();
    }
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, { height: 852, offsetTop: 0 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
      window.visualViewport!.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(async () => {
        const restored = (await dialog.boundingBox())!;
        return (
          Math.abs(restored.height - before.height) < 1 &&
          Math.abs(restored.y - before.y) < 1
        );
      })
      .toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Search", exact: true })
    ).toBeFocused();
    await openLibrarySearch(page);
    await expect
      .poll(async () =>
        Math.abs((await dialog.boundingBox())!.height - before.height)
      )
      .toBeLessThan(1);
  } finally {
    await context.close();
  }
});

test("opens search with its shortcut while respecting the sidebar, menus, inputs and viewer", async ({
  browser
}) => {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/?view=gallery&folder=${folderId}`);
    const dialog = page.getByRole("dialog", { name: "Search", exact: true });
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Sidebar", exact: true })
    ).toBeVisible();
    await page.keyboard.press("/");
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", {
        name: "Change view, Gallery selected",
        exact: true
      })
      .click();
    await page.keyboard.press("/");
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openLibrarySearch(page);
    const input = dialog.getByRole("searchbox", {
      name: "Filename or path",
      exact: true
    });
    await input.fill("literal");
    await input.press("/");
    await expect(input).toHaveValue("literal/");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Open top-photo.png", exact: true })
      .click();
    await expect(page.locator(".viewer-dialog")).toBeVisible();
    await page.keyboard.press("/");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".viewer-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".viewer-dialog")).toHaveCount(0);
    await page.keyboard.press("/");
    await expect(dialog).toBeVisible();
  } finally {
    await context.close();
  }
});
