import {
  link,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLocalEnv, loadPrivateEnv } from "../src/config/env.js";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "../src/config/data-directory.js";

const testKeys = [
  "AETHER_ENV_TEST_EXTERNAL",
  "AETHER_ENV_TEST_LOCAL",
  "AETHER_ENV_TEST_ROOT_MARKER",
  "AETHER_ENV_TEST_PRIVATE",
  "AETHER_DATA_DIR"
] as const;
const previousValues = new Map<string, string | undefined>();

describe("loadLocalEnv", () => {
  beforeEach(() => {
    previousValues.clear();
    for (const key of testKeys) {
      previousValues.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of testKeys) {
      const previousValue = previousValues.get(key);
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  });

  it("finds the workspace root without private planning docs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aether-env-"));
    const serverDir = path.join(root, "apps", "server");
    const nestedDir = path.join(serverDir, "src", "config");

    await mkdir(nestedDir, { recursive: true });
    await mkdir(path.join(root, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "aether",
        workspaces: ["apps/server", "apps/web"]
      })
    );
    await writeFile(path.join(serverDir, "package.json"), "{}\n");
    await writeFile(path.join(root, "apps", "web", "package.json"), "{}\n");
    await writeFile(
      path.join(root, ".env"),
      "AETHER_ENV_TEST_ROOT_MARKER=from-root\n"
    );

    expect(loadLocalEnv(nestedDir)).toBe(root);
    expect(process.env.AETHER_ENV_TEST_ROOT_MARKER).toBe("from-root");
  });

  it("lets .env.local override .env but not the process environment", async () => {
    const root = await makeWorkspace();
    await writeFile(
      path.join(root, ".env"),
      [
        "AETHER_ENV_TEST_EXTERNAL=from-env",
        "AETHER_ENV_TEST_LOCAL=from-env"
      ].join("\n") + "\n"
    );
    await writeFile(
      path.join(root, ".env.local"),
      [
        "AETHER_ENV_TEST_EXTERNAL=from-local",
        "AETHER_ENV_TEST_LOCAL=from-local"
      ].join("\n") + "\n"
    );
    process.env.AETHER_ENV_TEST_EXTERNAL = "from-process";

    loadLocalEnv(path.join(root, "apps", "server"));

    expect(process.env.AETHER_ENV_TEST_LOCAL).toBe("from-local");
    expect(process.env.AETHER_ENV_TEST_EXTERNAL).toBe("from-process");
  });

  it("reads private settings securely without overriding inherited values", async () => {
    const root = await makeWorkspace();
    const paths = resolveDataPaths({}, root);
    await initializeDataDirectory(paths);
    await writeFile(
      paths.privateEnvPath,
      "AETHER_ENV_TEST_PRIVATE=private-value\nAETHER_ENV_TEST_EXTERNAL=private-value\n",
      { mode: 0o644 }
    );
    process.env.AETHER_ENV_TEST_EXTERNAL = "inherited";
    try {
      loadPrivateEnv(root);
      expect(process.env.AETHER_ENV_TEST_PRIVATE).toBe("private-value");
      expect(process.env.AETHER_ENV_TEST_EXTERNAL).toBe("inherited");
      expect((await stat(paths.privateEnvPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects private setting symlinks and hard links", async () => {
    const root = await makeWorkspace();
    const paths = resolveDataPaths({}, root);
    await initializeDataDirectory(paths);
    const outside = path.join(root, "outside.env");
    await writeFile(outside, "AETHER_ENV_TEST_PRIVATE=outside\n");
    try {
      await symlink(outside, paths.privateEnvPath);
      expect(() => loadPrivateEnv(root)).toThrow(
        "Unsafe private environment file"
      );
      await rm(paths.privateEnvPath);
      await link(outside, paths.privateEnvPath);
      expect(() => loadPrivateEnv(root)).toThrow(
        "Unsafe private environment file"
      );
      expect(process.env.AETHER_ENV_TEST_PRIVATE).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aether-env-"));
  await mkdir(path.join(root, "apps", "server"), { recursive: true });
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ workspaces: ["apps/server", "apps/web"] })
  );
  await writeFile(path.join(root, "apps", "server", "package.json"), "{}\n");
  await writeFile(path.join(root, "apps", "web", "package.json"), "{}\n");
  return root;
}
