import {
  expect,
  test,
  type Locator,
  type Page,
  type Route
} from "@playwright/test";
import { chooseAccountAction } from "./account-menu";
import type {
  AssetRecord,
  FileOperation,
  FileOperationInput,
  FileOperationPreview,
  TrashResponse,
  TreeResponse,
  UploadRecord
} from "../../apps/web/src/api/client";

const productionBaseURL = `http://127.0.0.1:${process.env.AETHER_E2E_API_PORT ?? 3130}`;
test.use({ baseURL: productionBaseURL });

const tree: TreeResponse = {
  revision: "1",
  roots: [
    {
      id: "photos",
      folderId: "photos-root",
      label: "Photos",
      assetCount: 0,
      writable: true,
      sourceVersion: "root-version"
    }
  ],
  folders: []
};

const uploadLimits = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxStagingBytes: 100 * 1024 * 1024,
  chunkBytes: 1024 * 1024,
  maxBatchItems: 100
};

async function mockApi(
  page: Page,
  {
    operations = [],
    uploads = [],
    assets = [],
    onTree
  }: {
    operations?: FileOperation[];
    uploads?: UploadRecord[];
    assets?: AssetRecord[];
    onTree?: (route: Route) => Promise<void>;
  } = {}
) {
  const writes: string[] = [];
  const unhandled: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET") {
        writes.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 405, json: { error: "test_read_only" } });
        return;
      }
      if (url.pathname === "/api/auth/me") {
        await route.fulfill({
          json: { authenticated: true, expiresAt: null }
        });
      } else if (url.pathname === "/api/tree") {
        if (onTree) await onTree(route);
        else
          await route.fulfill({
            json: {
              ...tree,
              roots: tree.roots.map((root) => ({
                ...root,
                assetCount: assets.length
              }))
            }
          });
      } else if (/^\/api\/folders\/[^/]+\/assets$/.test(url.pathname)) {
        await route.fulfill({
          json: {
            folderId: "photos-root",
            items: assets,
            page: { offset: 0, limit: 80, total: assets.length, revision: "1" },
            sort: url.searchParams.get("sort") ?? "date",
            order: url.searchParams.get("order") ?? "desc",
            type: "all",
            recursive: true,
            search: "",
            tags: [],
            score: "all",
            seed: 1
          }
        });
      } else if (
        /^\/api\/assets\/[^/]+\/(media|thumbnail)$/.test(url.pathname)
      ) {
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#507968"/></svg>'
        });
      } else if (/^\/api\/assets\/[^/]+$/.test(url.pathname)) {
        await route.fulfill({ json: assets[0] });
      } else if (url.pathname === "/api/file-operations") {
        await route.fulfill({ json: { items: operations } });
      } else if (url.pathname.startsWith("/api/file-operations/")) {
        const operation = operations.find(
          (item) => item.id === url.pathname.split("/").at(-1)
        );
        await route.fulfill({
          status: operation ? 200 : 404,
          json: operation ?? { error: "operation_not_found" }
        });
      } else if (url.pathname === "/api/uploads/status") {
        await route.fulfill({ json: { items: uploads, limits: uploadLimits } });
      } else if (url.pathname === "/api/admin/jobs") {
        await route.fulfill({ json: { jobs: [] } });
      } else if (url.pathname === "/api/admin/ai") {
        await route.fulfill({
          json: { enabled: false, provider: "disabled", model: null }
        });
      } else if (url.pathname === "/api/admin/watch") {
        await route.fulfill({
          json: {
            enabled: false,
            running: false,
            debounceMs: 0,
            watchedDirectories: 0,
            lastEventAt: null,
            lastScanJobId: null,
            lastError: null
          }
        });
      } else if (url.pathname === "/api/tags/suggest") {
        await route.fulfill({ json: { tags: [] } });
      } else {
        unhandled.push(url.pathname);
        await route.fulfill({
          status: 404,
          json: { error: "test_not_mocked" }
        });
      }
    }
  );
  return { writes, unhandled };
}

test("opens Activity from a notification and returns to Feed", async ({
  browser
}) => {
  const context = await browser.newContext({
    baseURL: productionBaseURL,
    viewport: { width: 320, height: 760 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block"
  });
  try {
    const page = await context.newPage();
    const operations: FileOperation[] = [
      {
        id: "folder-creation",
        type: "create-folder",
        status: "running",
        revision: "1",
        canCancel: false,
        items: [{ name: "Travel", status: "running" }]
      }
    ];
    const requests = await mockApi(page, {
      operations,
      assets: [
        {
          id: "feed-photo",
          folderId: "photos-root",
          name: "holiday.jpg",
          extension: "jpg",
          mediaType: "image",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          mtimeMs: 1,
          width: 120,
          height: 180,
          durationMs: null,
          codec: null,
          status: "ready",
          error: null,
          score: 0,
          ranking: null,
          favorite: false,
          tags: []
        }
      ]
    });
    await page.goto("/?page=library&view=gallery");
    const activity = await openActivity(page);
    await expect(activity.getByText("Travel", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(activity).toBeHidden();
    await page
      .getByRole("button", { name: "Change view, Gallery selected" })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Feed", exact: true })
      .click();
    const feed = page.getByRole("region", { name: "Feed view", exact: true });
    await expect(feed).toHaveAttribute("aria-busy", "false");
    await feed
      .getByRole("button", {
        name: "Hide feed controls and details",
        exact: true
      })
      .click();
    await expect(page.locator(".feed-view-controls")).toHaveAttribute(
      "inert",
      ""
    );
    operations[0] = {
      ...operations[0]!,
      status: "completed",
      revision: "2",
      items: [{ name: "Travel", status: "completed" }],
      summary: { total: 1, completed: 1, failed: 0, cancelled: 0 }
    };
    await page
      .getByRole("button", { name: "View activity", exact: true })
      .click();
    await expect(activity).toBeVisible();
    await expect(page).toHaveURL(/\bpage=activity\b/);
    await expect(
      activity.getByRole("heading", { name: "Activity", exact: true })
    ).toBeFocused();
    await page.goBack();
    await expect(activity).toBeHidden();
    await expect(feed).toBeVisible();
    expect(requests.writes).toEqual([]);
    expect(requests.unhandled).toEqual([]);
  } finally {
    await context.close();
  }
});

async function openActivity(page: Page) {
  await chooseAccountAction(page, "Activity");
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  return activity;
}

async function expectReachable(control: Locator) {
  await expect(control).toBeInViewport();
  expect(
    await control.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
      );
      return hit === element || element.contains(hit);
    })
  ).toBe(true);
}

test("keeps an acknowledged result when an older Activity refresh finishes", async ({
  page
}) => {
  const pending: FileOperation = {
    id: "interrupted-move",
    type: "move-media",
    status: "needs_attention",
    revision: "1",
    canCancel: true,
    items: [
      {
        name: "holiday.jpg",
        status: "needs_attention",
        errorCode: "source_changed"
      }
    ]
  };
  const result: FileOperation = {
    ...pending,
    status: "completed",
    revision: "2",
    canCancel: false,
    items: [{ name: "holiday.jpg", status: "completed" }],
    summary: { total: 1, completed: 1, failed: 0, cancelled: 0 }
  };
  const requests = await mockApi(page, { operations: [pending] });
  await page.goto("/?page=activity");
  const activity = page.getByRole("region", {
    name: "Activity",
    exact: true
  });
  const operation = activity.getByRole("region", {
    name: "Move media",
    exact: true
  });
  await expect(operation).toContainText("Needs attention");
  const refresh = activity.getByRole("button", {
    name: "Refresh Activity",
    exact: true
  });
  await expect(refresh).toBeEnabled();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshStarted = false;
  let retries = 0;
  await page.route("**/api/file-operations", async (route) => {
    refreshStarted = true;
    await held;
    await route.fulfill({ json: { items: [pending] } });
  });
  await page.route(
    "**/api/file-operations/interrupted-move/retry",
    async (route) => {
      expect(route.request().method()).toBe("POST");
      retries += 1;
      await route.fulfill({ status: 202, json: result });
    }
  );
  try {
    await refresh.click();
    await expect.poll(() => refreshStarted).toBe(true);
    await operation
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    await expect(operation).toContainText("Completed");
    release();
    await expect(refresh).toBeEnabled();
    await expect(operation).toContainText("Completed");
    await expect(operation).not.toContainText("Needs attention");
    await expect(
      operation.getByRole("button", { name: "Check again", exact: true })
    ).toHaveCount(0);
    await expect(
      operation.getByRole("button", { name: "Cancel remaining", exact: true })
    ).toHaveCount(0);
    expect(retries).toBe(1);
    expect(requests.writes).toEqual([]);
    expect(requests.unhandled).toEqual([]);
  } finally {
    release();
  }
});

function activityFixtures() {
  const operations: FileOperation[] = [
    {
      id: "partial-move",
      type: "move-media",
      status: "partial",
      revision: "1",
      canCancel: false,
      items: [
        { name: "family.jpg", status: "completed" },
        {
          name: "picnic.jpg",
          status: "failed",
          errorCode: "destination_exists"
        },
        { name: "beach.jpg", status: "cancelled" }
      ],
      summary: { total: 3, completed: 1, failed: 1, cancelled: 1 }
    },
    {
      id: "finishing-move",
      type: "move-media",
      status: "running",
      revision: "1",
      canCancel: false,
      items: [{ name: "finishing.jpg", status: "running" }]
    },
    ...Array.from({ length: 38 }, (_, index): FileOperation => ({
      id: `rename-${index}`,
      type: "rename-media",
      status: "completed",
      revision: "1",
      canCancel: false,
      items: [{ name: `renamed-${index + 1}.jpg`, status: "completed" }]
    }))
  ];
  const uploads: UploadRecord[] = Array.from({ length: 8 }, (_, index) => ({
    id: `paused-upload-${index}`,
    requestId: `paused-request-${index}`,
    name: `paused-${index + 1}.jpg`,
    status: "receiving",
    folderId: "photos-root",
    offset: 1024,
    size: 4096,
    expiresAt: "2099-01-01T00:00:00.000Z"
  }));
  return { operations, uploads };
}

for (const phone of [false, true]) {
  test(`loads pending restores when opening Trash directly on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 320, height: 760 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    let releaseBaseline: () => void = () => undefined;
    try {
      const page = await context.newPage();
      const operations: FileOperation[] = [
        {
          id: "existing-restore",
          type: "restore",
          status: "running",
          revision: "1",
          canCancel: true,
          items: [
            {
              name: "retained.jpg",
              trashId: "retained-entry",
              status: "running"
            }
          ]
        }
      ];
      const requests = await mockApi(page, { operations });
      const item: TrashResponse["items"][number] = {
        id: "retained-entry",
        assetId: "retained-photo",
        name: "retained.jpg",
        originalRootId: "photos",
        originalFolderId: "photos-root",
        originalRelativePath: "retained.jpg",
        sizeBytes: 1024,
        deletedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sourceVersion: "source-version"
      };
      let finished = false;
      let baselineReads = 0;
      let failBaseline = !phone;
      const held = new Promise<void>((resolve) => {
        releaseBaseline = resolve;
      });
      await page.route("**/api/file-operations", async (route) => {
        expect(route.request().method()).toBe("GET");
        baselineReads += 1;
        if (failBaseline) {
          failBaseline = false;
          await route.fulfill({
            status: 503,
            json: { error: "server_unavailable" }
          });
          return;
        }
        await held;
        await route.fulfill({ json: { items: operations } });
      });
      await page.route(/\/api\/trash\?/, (route) =>
        route.fulfill({
          json: {
            items: finished ? [] : [item],
            retentionDays: 30,
            revision: finished ? "2" : "1",
            totalRetained: finished ? 0 : 1,
            page: { offset: 0, limit: 100, total: finished ? 0 : 1 }
          } satisfies TrashResponse
        })
      );
      await page.route("**/api/trash/retained-entry/thumbnail", (route) =>
        route.fulfill({ status: 404, json: { error: "thumbnail_not_found" } })
      );
      await page.goto("/?page=trash");
      const trash = page.getByRole("region", { name: "Trash", exact: true });
      const row = trash.getByRole("article").filter({ hasText: item.name });
      await expect.poll(() => baselineReads).toBeGreaterThan(0);
      await expect(row).toBeVisible();
      await expect(row.locator(".trash-item-restore")).toBeDisabled();
      await expect(
        trash.getByRole("button", { name: "Empty Trash", exact: true })
      ).toBeDisabled();
      if (!phone) {
        await expect(trash.getByRole("alert")).toContainText(
          "Activity could not be loaded. Try again before restoring or deleting items."
        );
        await expect(
          row.getByRole("checkbox", {
            name: `Select ${item.name}`,
            exact: true
          })
        ).toBeDisabled();
        const search = trash.getByRole("textbox", {
          name: "Search Trash",
          exact: true
        });
        await expect(search).toBeEnabled();
        await search.fill("retained");
        await expect(search).toHaveValue("retained");
        await expect(
          trash.getByRole("button", { name: "Refresh Trash", exact: true })
        ).toBeEnabled();
        await trash
          .getByRole("button", { name: "Retry loading Activity", exact: true })
          .click();
        await expect.poll(() => baselineReads).toBeGreaterThanOrEqual(2);
        await expect(row.locator(".trash-item-restore")).toBeDisabled();
      }
      releaseBaseline();
      await expect(row.locator(".trash-item-restore")).toHaveText("Restoring…");
      await page.reload();
      await expect(row.locator(".trash-item-restore")).toHaveText("Restoring…");
      await expect(row.locator(".trash-item-restore")).toBeDisabled();
      await expect(
        row.getByRole("checkbox", { name: `Select ${item.name}`, exact: true })
      ).toBeDisabled();
      await expect(page).toHaveURL(/\bpage=trash\b/);
      expect(baselineReads).toBeGreaterThanOrEqual(2);
      operations[0] = {
        ...operations[0]!,
        status: "completed",
        revision: "2",
        canCancel: false,
        items: [{ name: item.name, trashId: item.id, status: "completed" }],
        summary: { total: 1, completed: 1, failed: 0, cancelled: 0 }
      };
      finished = true;
      await expect(row).toHaveCount(0);
      await expect(trash).toContainText("Trash is empty.");
      expect(requests.writes).toEqual([]);
      expect(requests.unhandled).toEqual([]);
    } finally {
      releaseBaseline();
      await context.close();
    }
  });

  test(`keeps an accepted restore pending in Trash on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 320, height: 760 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const operations: FileOperation[] = [];
      const requests = await mockApi(page, { operations });
      const item: TrashResponse["items"][number] = {
        id: "retained-photo",
        assetId: "restored-photo",
        name: "restoring.jpg",
        originalRootId: "photos",
        originalFolderId: "photos-root",
        originalRelativePath: "restoring.jpg",
        sizeBytes: 1024,
        deletedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sourceVersion: "source-version"
      };
      let finished = false;
      let submissions = 0;
      let previews = 0;
      await page.route(/\/api\/trash\?/, async (route) => {
        await route.fulfill({
          json: {
            items: finished ? [] : [item],
            retentionDays: 30,
            revision: finished ? "2" : "1",
            totalRetained: finished ? 0 : 1,
            page: { offset: 0, limit: 100, total: finished ? 0 : 1 }
          } satisfies TrashResponse
        });
      });
      await page.route("**/api/trash/retained-photo/thumbnail", (route) =>
        route.fulfill({ status: 404, json: { error: "thumbnail_not_found" } })
      );
      await page.route("**/api/file-operations/preview", async (route) => {
        previews += 1;
        await route.fulfill({
          json: {
            revision: "1",
            items: [
              {
                key: item.id,
                index: 0,
                name: item.name,
                destinationFolderId: "photos-root",
                destinationLabel: "Photos",
                expectedParentVersion: "root-version",
                hasConflict: false,
                proposedName: null,
                choice: "skip",
                noOp: false
              }
            ]
          } satisfies FileOperationPreview
        });
      });
      await page.route("**/api/file-operations", async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        const input = route.request().postDataJSON() as FileOperationInput;
        expect(input.type).toBe("restore");
        expect(input.items).toMatchObject([
          { trashId: item.id, expectedVersion: item.sourceVersion }
        ]);
        submissions += 1;
        const operation: FileOperation = {
          id: input.requestId,
          type: "restore",
          status: "running",
          revision: "1",
          canCancel: true,
          items: [{ name: item.name, trashId: item.id, status: "running" }]
        };
        operations.push(operation);
        await route.fulfill({ status: 202, json: operation });
      });
      await page.goto("/?page=trash");
      const trash = page.getByRole("region", { name: "Trash", exact: true });
      const row = trash.getByRole("article").filter({ hasText: item.name });
      await row
        .getByRole("button", { name: `Restore ${item.name}`, exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Restore media", exact: true })
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Restore media", exact: true })
      ).toBeHidden();
      await expect(page).toHaveURL(/\bpage=trash\b/);
      await expect(
        page.getByRole("region", { name: "Activity", exact: true })
      ).toBeHidden();
      await expect(row.locator(".trash-item-restore")).toBeDisabled();
      await expect(row.locator(".trash-item-restore")).toHaveText("Restoring…");
      await expect(
        row.getByRole("checkbox", { name: `Select ${item.name}`, exact: true })
      ).toBeDisabled();
      await expect(
        trash.getByRole("button", { name: "Empty Trash", exact: true })
      ).toBeDisabled();
      operations[0] = {
        ...operations[0]!,
        status: "completed",
        revision: "2",
        canCancel: false,
        items: [{ name: item.name, trashId: item.id, status: "completed" }],
        summary: { total: 1, completed: 1, failed: 0, cancelled: 0 }
      };
      finished = true;
      await expect(row).toHaveCount(0);
      await expect(trash).toContainText("Trash is empty.");
      expect(previews).toBe(1);
      expect(submissions).toBe(1);
      expect(requests.writes).toEqual([]);
      expect(requests.unhandled).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test(`keeps Activity controls reachable and upload recovery local on ${phone ? "phone" : "desktop"}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport: phone
        ? { width: 320, height: 760 }
        : { width: 1440, height: 980 },
      isMobile: phone,
      hasTouch: phone,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const requests = await mockApi(page, activityFixtures());
      await page.goto("/?page=library");
      const activity = await openActivity(page);
      await expect(
        activity.getByText("family.jpg and 2 more", { exact: true })
      ).toBeVisible();
      await expect(
        activity.getByText("1 of 3 completed · 1 failed · 1 cancelled", {
          exact: true
        })
      ).toBeVisible();
      await expect(
        activity.getByText("renamed-1.jpg", { exact: true })
      ).toBeVisible();
      await expect(
        activity.getByRole("button", { name: "Cancel remaining", exact: true })
      ).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath("activity-populated.png"),
        animations: "disabled"
      });
      const filter = activity.getByRole("tablist", {
        name: "Activity filter",
        exact: true
      });
      await filter
        .getByRole("tab", { name: "Needs attention", exact: true })
        .click();
      await expect(
        activity.getByText("renamed-1.jpg", { exact: true })
      ).toHaveCount(0);
      await expect(
        activity.getByText("family.jpg and 2 more", { exact: true })
      ).toBeVisible();
      await expect(
        activity.getByText("finishing.jpg", { exact: true })
      ).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath("activity-attention.png"),
        animations: "disabled"
      });
      await filter.getByRole("tab", { name: "All", exact: true }).click();
      const body = activity.locator(".activity-body");
      const refresh = activity.getByRole("button", {
        name: "Refresh Activity",
        exact: true
      });
      await refresh.click({ trial: true });
      const refreshBefore = await refresh.boundingBox();
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expectReachable(refresh);
      await expectReachable(filter);
      expect(await refresh.boundingBox()).toEqual(refreshBefore);
      await expect(
        activity.getByText("renamed-38.jpg", { exact: true })
      ).toBeInViewport();

      const upload = activity.getByRole("region", {
        name: "Upload paused-1.jpg",
        exact: true
      });
      await upload.getByRole("button", { name: "Resume", exact: true }).click();
      const reselect = upload.getByLabel("Reselect paused-1.jpg", {
        exact: true
      });
      await expect(reselect).toBeFocused();
      await expectReachable(reselect);
      await expect(activity.locator('input[type="file"]')).toHaveCount(1);
      await expectReachable(refresh);
      await expectReachable(filter);
      await refresh.click();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(activity).toBeHidden();
      expect(requests.writes).toEqual([]);
      expect(requests.unhandled).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("loads Add media destinations after a failed initial folder request", async ({
  page
}) => {
  let releaseInitial: () => void = () => undefined;
  const initialResponse = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  let retry = false;
  const requests = await mockApi(page, {
    onTree: async (route) => {
      if (!retry) {
        await initialResponse;
        await route.fulfill({
          status: 503,
          json: { error: "server_unavailable" }
        });
      } else await route.fulfill({ json: tree });
    }
  });
  await page.goto("/?page=add-media&folder=photos-root");
  const addMedia = page.locator(".add-media-page");
  try {
    await expect(
      addMedia.getByText("Loading folders…", { exact: true })
    ).toBeVisible();
    await expect(addMedia.getByText(/No folders are available/)).toHaveCount(0);
  } finally {
    releaseInitial();
  }
  await expect(addMedia.getByRole("alert")).toHaveText(
    "Folders could not be loaded. Try again."
  );
  await expect(addMedia.getByText(/No folders are available/)).toHaveCount(0);
  retry = true;
  await addMedia
    .getByRole("button", { name: "Retry loading folders", exact: true })
    .click();
  await expect(addMedia.getByRole("alert")).toHaveCount(0);
  await expect(addMedia.locator(".add-media-destination")).toContainText(
    "Photos"
  );
  await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
    name: "holiday.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([1, 2, 3])
  });
  await expect(
    addMedia.getByRole("button", { name: "Add files", exact: true })
  ).toBeEnabled();
  expect(requests.writes).toEqual([]);
  expect(requests.unhandled).toEqual([]);
});

for (const layout of ["desktop", "phone", "landscape"] as const) {
  test(`keeps read-only Add media recoverable on ${layout}`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: productionBaseURL,
      viewport:
        layout === "phone"
          ? { width: 320, height: 760 }
          : layout === "landscape"
            ? { width: 812, height: 375 }
            : { width: 1440, height: 980 },
      isMobile: layout !== "desktop",
      hasTouch: layout !== "desktop",
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const requests = await mockApi(page, {
        onTree: async (route) => {
          await route.fulfill({
            json: {
              ...tree,
              roots: tree.roots.map((root) => ({ ...root, writable: false }))
            }
          });
        }
      });
      await page.goto("/?page=add-media&folder=photos-root");
      const addMedia = page.locator(".add-media-page");
      await expect(
        addMedia.getByText(/No folders are available for uploads/)
      ).toBeVisible();
      const addFiles = addMedia.getByRole("button", {
        name: "Add files",
        exact: true
      });
      await expect(addFiles).toBeDisabled();
      await addMedia.getByLabel("Choose media", { exact: true }).setInputFiles({
        name: "holiday.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from([1, 2, 3])
      });
      await expect(addFiles).toBeDisabled();
      const cancel = addMedia
        .locator(".add-media-footer")
        .getByRole("button", { name: "Cancel", exact: true });
      await expectReachable(cancel);
      await cancel.click();
      await expect(addMedia).toBeHidden();
      await expect(page).toHaveURL(/page=library/);
      await expect(
        page.getByRole("region", { name: "Gallery view", exact: true })
      ).toBeVisible();
      expect(requests.writes).toEqual([]);
      expect(requests.unhandled).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
