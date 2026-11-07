import {
  expect,
  test,
  type Locator,
  type Page,
  type Route
} from "@playwright/test";
import type {
  AssetRecord,
  FileOperation,
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

test("returns Activity focus to Feed when compact controls are hidden", async ({
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
    await activity.getByRole("button", { name: "Close", exact: true }).click();
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
    await activity.getByRole("button", { name: "Close", exact: true }).click();
    await expect(activity).toBeHidden();
    await expect(feed).toBeFocused();
    await expect(page.locator(".feed-view-controls")).toHaveAttribute(
      "inert",
      ""
    );
    expect(requests.writes).toEqual([]);
    expect(requests.unhandled).toEqual([]);
  } finally {
    await context.close();
  }
});

async function openActivity(page: Page) {
  const trigger = page.getByRole("button", { name: "Activity", exact: true });
  if (!(await trigger.isVisible()))
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await trigger.click();
  const activity = page.getByRole("dialog", { name: "Activity", exact: true });
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
      const body = activity.locator(".activity-body");
      const title = activity.getByRole("heading", {
        name: "Activity",
        exact: true
      });
      const close = activity.getByRole("button", {
        name: "Close",
        exact: true
      });
      await close.click({ trial: true });
      const titleBefore = await title.boundingBox();
      const closeBefore = await close.boundingBox();
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expectReachable(title);
      await expectReachable(close);
      expect(await title.boundingBox()).toEqual(titleBefore);
      expect(await close.boundingBox()).toEqual(closeBefore);
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
      await expectReachable(title);
      await expectReachable(close);
      await close.click();
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
  const addMedia = page.getByRole("region", { name: "Add media", exact: true });
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
