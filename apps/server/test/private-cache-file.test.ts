import { execFileSync } from "node:child_process";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPrivateCacheFile } from "../src/security/private-cache-file.js";

describe("private cached file access", () => {
  let directory: string;
  let cache: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aether-cache-access-"));
    cache = path.join(directory, "data", "cache");
    await mkdir(path.join(cache, "images"), { recursive: true });
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it("opens regular cache files through an aliased data parent", async () => {
    await writeFile(path.join(cache, "images", "safe.png"), "cached");
    const alias = path.join(directory, "alias");
    await symlink(path.join(directory, "data"), alias);
    const handle = await openPrivateCacheFile(
      path.join(alias, "cache", "images", "safe.png"),
      path.join(alias, "cache")
    );
    try {
      expect(await handle.readFile("utf8")).toBe("cached");
    } finally {
      await handle.close();
    }
  });

  it("rejects escaping symlinks, linked files, and nested directory aliases", async () => {
    const outside = path.join(directory, "private.txt");
    await writeFile(outside, "secret");
    const linked = path.join(cache, "images", "linked");
    await symlink(outside, linked);
    await expect(openPrivateCacheFile(linked, cache)).rejects.toThrow();
    await rm(linked);
    await link(outside, linked);
    await expect(openPrivateCacheFile(linked, cache)).rejects.toThrow();
    await symlink(path.join(cache, "images"), path.join(cache, "alias"));
    await expect(
      openPrivateCacheFile(path.join(cache, "alias", "linked"), cache)
    ).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")(
    "rejects a FIFO without blocking the server",
    async () => {
      const fifo = path.join(cache, "pipe");
      execFileSync("mkfifo", [fifo]);
      await expect(openPrivateCacheFile(fifo, cache)).rejects.toThrow();
    }
  );
});
