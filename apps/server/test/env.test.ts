import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnv } from "../src/config/env.js";

const markerKey = "AETHER_ENV_TEST_ROOT_MARKER";
let previousMarker: string | undefined;

describe("loadLocalEnv", () => {
  afterEach(() => {
    if (previousMarker === undefined) {
      delete process.env[markerKey];
    } else {
      process.env[markerKey] = previousMarker;
    }
  });

  it("finds the workspace root without private planning docs", async () => {
    previousMarker = process.env[markerKey];
    delete process.env[markerKey];

    const root = await mkdtemp(path.join(tmpdir(), "aether-env-"));
    const serverDir = path.join(root, "apps", "server");
    const nestedDir = path.join(serverDir, "src", "config");

    await mkdir(nestedDir, { recursive: true });
    await mkdir(path.join(root, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "aether", workspaces: ["apps/server", "apps/web"] })
    );
    await writeFile(path.join(serverDir, "package.json"), "{}\n");
    await writeFile(path.join(root, "apps", "web", "package.json"), "{}\n");
    await writeFile(path.join(root, ".env"), `${markerKey}=from-root\n`);

    expect(loadLocalEnv(nestedDir)).toBe(root);
    expect(process.env[markerKey]).toBe("from-root");
  });
});
