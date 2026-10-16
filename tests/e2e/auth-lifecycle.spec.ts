import { expect, test, type Request } from "@playwright/test";

const localCheckpointKeys = [
  "aether.resume.v1",
  "aether.library-state.v1",
  "aether.navigation.v1",
  "aether.ranking-resume.v1",
  "aether.random-order.v1",
  "aether.scroll.v3.library-content",
  "aether.scroll.v3.folder-tree",
  "aether.scroll.v3.leaderboard"
];
const sessionCheckpointKeys = [
  "aether.scroll.v2.library-content",
  "aether.scroll.v2.folder-tree",
  "aether.scroll.v2.leaderboard",
  "aether.scroll.v1.feed",
  "aether.scroll.v1.gallery",
  "aether.scroll.v1.folder-tree"
];

test("ignores a delayed successful foreground auth check after explicit logout and clears private checkpoints", async ({
  page
}) => {
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("aether-e2e-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.locator(".library-main")).toBeVisible();

  let releaseAuthCheck: (() => Promise<void>) | undefined;
  let hasSignedOut = false;
  const treeRequestsAfterLogout: string[] = [];
  page.on("request", (request) => {
    if (hasSignedOut && new URL(request.url()).pathname === "/api/tree")
      treeRequestsAfterLogout.push(request.url());
  });
  let completeAuthCheck: (() => void) | undefined;
  const authCheckSettled = new Promise<void>((resolve) => {
    completeAuthCheck = resolve;
  });
  const finishAuthCheck = (request: Request) => {
    if (new URL(request.url()).pathname === "/api/auth/me")
      completeAuthCheck?.();
  };
  page.on("requestfinished", finishAuthCheck);
  page.on("requestfailed", finishAuthCheck);

  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    releaseAuthCheck = () => route.fulfill({ response });
  });
  await expect
    .poll(async () => {
      if (!releaseAuthCheck) {
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent("pageshow", { persisted: true })
          )
        );
      }
      return Boolean(releaseAuthCheck);
    })
    .toBe(true);

  await page.evaluate(
    ({ localKeys, sessionKeys }) => {
      for (const key of localKeys) localStorage.setItem(key, "checkpoint");
      for (const key of sessionKeys) sessionStorage.setItem(key, "checkpoint");
    },
    { localKeys: localCheckpointKeys, sessionKeys: sessionCheckpointKeys }
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  hasSignedOut = true;

  // The browser may already have canceled this intercepted request on logout.
  await releaseAuthCheck!().catch(() => undefined);
  await authCheckSettled;
  page.off("requestfinished", finishAuthCheck);
  page.off("requestfailed", finishAuthCheck);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.locator(".library-main")).toHaveCount(0);
  // Even a brief unauthorized remount would issue a fresh tree request.
  expect(treeRequestsAfterLogout).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(
        ({ localKeys, sessionKeys }) => ({
          local: localKeys.filter((key) => localStorage.getItem(key) !== null),
          session: sessionKeys.filter(
            (key) => sessionStorage.getItem(key) !== null
          )
        }),
        { localKeys: localCheckpointKeys, sessionKeys: sessionCheckpointKeys }
      )
    )
    .toEqual({ local: [], session: [] });
});
