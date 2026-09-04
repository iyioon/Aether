import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  isPathInside,
  resolveMediaPath,
  UnsafePathError
} from "../src/security/path-safety.js";

describe("path safety", () => {
  it("recognizes paths inside a configured root", () => {
    expect(isPathInside("/library", "/library/photo.jpg")).toBe(true);
    expect(isPathInside("/library", "/library/nested/photo.jpg")).toBe(true);
    expect(isPathInside("/library", "/library-other/photo.jpg")).toBe(false);
  });

  it("rejects absolute requested media paths", async () => {
    await expect(resolveMediaPath("/library", "/etc/passwd")).rejects.toThrow(
      UnsafePathError
    );
  });

  it("rejects symlink escapes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-path-"));
    const root = path.join(cwd, "root");
    const outside = path.join(cwd, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));

    await expect(resolveMediaPath(root, "link.txt")).rejects.toThrow(
      UnsafePathError
    );
  });
});
