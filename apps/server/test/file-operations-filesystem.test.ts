import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileOperationsFilesystem,
  type FileOperationLocation
} from "../src/library/file-operations-filesystem.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const helper = path.join(
  repositoryRoot,
  "apps/server/dist/native/file-operations"
);
const crossDeviceAvailable =
  statSync(repositoryRoot).dev !== statSync(tmpdir()).dev;

describe.skipIf(process.platform !== "linux")(
  "verified file-operation filesystem",
  () => {
    let directory: string;
    let root: string;
    let destinationRoot: string;
    let filesystem: FileOperationsFilesystem;
    const locations = (relativePath: string): FileOperationLocation => ({
      rootPath: root,
      relativePath
    });
    const destinations = (relativePath: string): FileOperationLocation => ({
      rootPath: destinationRoot,
      relativePath
    });

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "aether-file-operations-"));
      root = path.join(directory, "source");
      destinationRoot = path.join(directory, "destination");
      await mkdir(root);
      await mkdir(destinationRoot);
      await mkdir(path.join(destinationRoot, ".aether-staging", "operation"), {
        recursive: true,
        mode: 0o700
      });
      filesystem = new FileOperationsFilesystem();
    });
    afterEach(async () => rm(directory, { recursive: true, force: true }));

    it("reports measured bytes across a folder copy", async () => {
      await mkdir(path.join(root, "folder"));
      await writeFile(
        path.join(root, "folder/a.jpg"),
        Buffer.alloc(2 * 1024 ** 2 + 19, 7)
      );
      await writeFile(path.join(root, "folder/b.jpg"), "second");
      const identity = await filesystem.inspect(locations("folder"));
      const progress: Array<[number, number]> = [];
      const result = await filesystem.copy(
        locations("folder"),
        destinations(".aether-staging/operation/folder"),
        identity,
        undefined,
        undefined,
        (bytes, total) => progress.push([bytes, total])
      );
      expect(progress[0]).toEqual([0, result.manifest.totalBytes]);
      expect(progress.at(-1)).toEqual([
        result.manifest.totalBytes,
        result.manifest.totalBytes
      ]);
      expect(
        progress.every(
          ([bytes, total], index) =>
            total === result.manifest.totalBytes &&
            bytes <= total &&
            (index === 0 || bytes >= progress[index - 1]![0])
        )
      ).toBe(true);
      expect(await readFile(path.join(root, "folder/b.jpg"), "utf8")).toBe(
        "second"
      );
    });

    it("publishes a same-filesystem move without changing bytes, identity, mode or mtime", async () => {
      await writeFile(path.join(root, "photo.jpg"), "original bytes", {
        mode: 0o640
      });
      await utimes(
        path.join(root, "photo.jpg"),
        1_700_000_000,
        1_700_000_001.123
      );
      const before = await filesystem.inspect(locations("photo.jpg"));
      const moved = await filesystem.rename(
        locations("photo.jpg"),
        destinations("photo.jpg"),
        before
      );
      expect(moved).toMatchObject({ ...before, ctimeNs: moved.ctimeNs });
      expect(
        await readFile(path.join(destinationRoot, "photo.jpg"), "utf8")
      ).toBe("original bytes");
      await expect(stat(path.join(root, "photo.jpg"))).rejects.toMatchObject({
        code: "ENOENT"
      });
    });

    it("never replaces a destination even when multiple publications race", async () => {
      const files = await Promise.all(
        Array.from({ length: 8 }, async (_, index) => {
          const name = `photo-${index}.jpg`;
          await writeFile(path.join(root, name), String(index));
          return { name, identity: await filesystem.inspect(locations(name)) };
        })
      );
      const attempts = await Promise.allSettled(
        files.map(({ name, identity }) =>
          filesystem.rename(
            locations(name),
            destinations("winner.jpg"),
            identity
          )
        )
      );
      expect(
        attempts.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const winner = Number(
        await readFile(path.join(destinationRoot, "winner.jpg"), "utf8")
      );
      for (const [index, result] of attempts.entries()) {
        if (index === winner) expect(result.status).toBe("fulfilled");
        else {
          expect(result).toMatchObject({
            status: "rejected",
            reason: { code: "destination_exists" }
          });
          expect(
            await readFile(path.join(root, files[index]!.name), "utf8")
          ).toBe(String(index));
        }
      }
    });

    it("rejects stale source identities before moving a replacement", async () => {
      await writeFile(path.join(root, "photo.jpg"), "original");
      const before = await filesystem.inspect(locations("photo.jpg"));
      await rename(
        path.join(root, "photo.jpg"),
        path.join(root, "original.jpg")
      );
      await writeFile(path.join(root, "photo.jpg"), "replacement");
      await expect(
        filesystem.rename(
          locations("photo.jpg"),
          destinations("photo.jpg"),
          before
        )
      ).rejects.toMatchObject({ code: "source_changed" });
      expect(await readFile(path.join(root, "photo.jpg"), "utf8")).toBe(
        "replacement"
      );
      expect(await readFile(path.join(root, "original.jpg"), "utf8")).toBe(
        "original"
      );
    });

    it("rejects symlinks, hardlinks, special files and traversal", async () => {
      await writeFile(path.join(root, "photo.jpg"), "original");
      await symlink("photo.jpg", path.join(root, "alias.jpg"));
      await expect(
        filesystem.inspect(locations("alias.jpg"))
      ).rejects.toThrow();
      await link(path.join(root, "photo.jpg"), path.join(root, "hardlink.jpg"));
      await expect(
        filesystem.inspect(locations("hardlink.jpg"))
      ).rejects.toMatchObject({ code: "unsafe_entry" });
      execFileSync("mkfifo", [path.join(root, "pipe")]);
      await expect(filesystem.inspect(locations("pipe"))).rejects.toMatchObject(
        { code: "unsafe_entry" }
      );
      for (const name of [
        "../outside",
        "folder/../photo.jpg",
        "/etc/passwd",
        "photo\\name",
        "folder//photo.jpg"
      ])
        await expect(filesystem.inspect(locations(name))).rejects.toThrow();
      await symlink(directory, path.join(root, "parent"));
      await expect(
        filesystem.createDirectory(locations("parent/new"))
      ).rejects.toThrow();
    });

    it("detects configured-root replacement across calls and expected-root mismatch", async () => {
      const expectedRoot = await filesystem.inspectRoot(root);
      await rename(root, `${root}-old`);
      await mkdir(root);
      await expect(
        filesystem.createDirectory({ ...locations("new"), expectedRoot })
      ).rejects.toMatchObject({ code: "source_changed" });
      await expect(filesystem.inspectRoot(root)).rejects.toMatchObject({
        code: "source_changed"
      });
      await expect(stat(path.join(root, "new"))).rejects.toMatchObject({
        code: "ENOENT"
      });
    });

    it("pins destination parents through a symlink swap and retains the moved entry for review", async () => {
      await mkdir(path.join(destinationRoot, "parent"));
      const outside = path.join(directory, "outside");
      await mkdir(outside);
      await writeFile(path.join(root, "photo.jpg"), "original");
      const expected = await filesystem.inspect(locations("photo.jpg"));
      const wrapped = await wrapper([
        `if [ "$1" = rename ]; then`,
        `mv ${quote(path.join(destinationRoot, "parent"))} ${quote(path.join(destinationRoot, "parent-old"))}`,
        `ln -s ${quote(outside)} ${quote(path.join(destinationRoot, "parent"))}`,
        "fi"
      ]);
      await expect(
        wrapped.rename(
          locations("photo.jpg"),
          destinations("parent/photo.jpg"),
          expected
        )
      ).rejects.toMatchObject({ code: "needs_review" });
      expect(
        await readFile(
          path.join(destinationRoot, "parent-old/photo.jpg"),
          "utf8"
        )
      ).toBe("original");
      await expect(stat(path.join(outside, "photo.jpg"))).rejects.toMatchObject(
        { code: "ENOENT" }
      );
    });

    it("copies a complete bounded tree, including hidden files, sidecars and empty folders", async () => {
      await mkdir(path.join(root, "album/empty"), { recursive: true });
      await writeFile(path.join(root, "album/photo.jpg"), "original image", {
        mode: 0o640
      });
      await writeFile(path.join(root, "album/.sidecar"), "sidecar", {
        mode: 0o600
      });
      await chmod(path.join(root, "album"), 0o750);
      await utimes(
        path.join(root, "album/photo.jpg"),
        1_700_000_000,
        1_700_000_001.123
      );
      const source = locations("album");
      const expected = await filesystem.inspect(source);
      const stage = destinations(".aether-staging/operation/album");
      const copied = await filesystem.copy(source, stage, expected);
      expect(
        copied.manifest.entries.map((entry) => entry.relativePath)
      ).toEqual(["", ".sidecar", "empty", "photo.jpg"]);
      expect(copied.manifest.totalBytes).toBe(21);
      const original = await filesystem.inventory(source);
      for (const [index, entry] of original.entries.entries()) {
        expect(copied.manifest.entries[index]).toMatchObject({
          relativePath: entry.relativePath,
          sha256: entry.sha256,
          identity: {
            kind: entry.identity.kind,
            mode: entry.identity.mode,
            mtimeNs: entry.identity.mtimeNs
          }
        });
      }
      expect(await readFile(path.join(root, "album/photo.jpg"), "utf8")).toBe(
        "original image"
      );
      await filesystem.rename(stage, destinations("album"), copied.identity);
      expect(
        await readFile(path.join(destinationRoot, "album/.sidecar"), "utf8")
      ).toBe("sidecar");
    });

    it.skipIf(!crossDeviceAvailable)(
      "copies and publishes across actual filesystems without retiring the original early",
      async () => {
        const artifactRoot = path.join(repositoryRoot, ".local-test-artifacts");
        await mkdir(artifactRoot, { recursive: true });
        const otherFilesystem = await mkdtemp(
          path.join(artifactRoot, "aether-file-operation-")
        );
        try {
          await mkdir(path.join(otherFilesystem, ".aether-staging/operation"), {
            recursive: true,
            mode: 0o700
          });
          await writeFile(
            path.join(root, "photo.jpg"),
            "cross filesystem bytes",
            { mode: 0o640 }
          );
          const original = locations("photo.jpg");
          const expected = await filesystem.inspect(original);
          const final = {
            rootPath: otherFilesystem,
            relativePath: "photo.jpg"
          };
          const stage = {
            rootPath: otherFilesystem,
            relativePath: ".aether-staging/operation/photo.jpg"
          };
          await expect(
            filesystem.rename(original, final, expected)
          ).rejects.toMatchObject({ code: "cross_device" });
          const copied = await filesystem.copy(original, stage, expected);
          expect(copied.identity.dev).not.toBe(expected.dev);
          await filesystem.rename(stage, final, copied.identity);
          expect(
            await readFile(path.join(otherFilesystem, "photo.jpg"), "utf8")
          ).toBe("cross filesystem bytes");
          expect(await readFile(path.join(root, "photo.jpg"), "utf8")).toBe(
            "cross filesystem bytes"
          );
        } finally {
          await rm(otherFilesystem, { recursive: true, force: true });
        }
      }
    );

    it("refuses a conflicting stage and never merges a folder destination", async () => {
      await mkdir(path.join(root, "album"));
      await writeFile(path.join(root, "album/photo.jpg"), "original");
      const expected = await filesystem.inspect(locations("album"));
      const stage = destinations(".aether-staging/operation/album");
      await mkdir(path.join(destinationRoot, stage.relativePath));
      await writeFile(
        path.join(destinationRoot, stage.relativePath, "existing"),
        "keep"
      );
      await expect(
        filesystem.copy(locations("album"), stage, expected)
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(
        await readFile(
          path.join(destinationRoot, stage.relativePath, "existing"),
          "utf8"
        )
      ).toBe("keep");
      await mkdir(path.join(destinationRoot, "album"));
      await expect(
        filesystem.rename(locations("album"), destinations("album"), expected)
      ).rejects.toMatchObject({ code: "destination_exists" });
    });

    it("enforces manifest size, depth and byte limits before staging", async () => {
      await mkdir(path.join(root, "album/nested"), { recursive: true });
      await writeFile(path.join(root, "album/nested/photo.jpg"), "original");
      for (const limits of [
        { maxEntries: 2, maxDepth: 10, maxBytes: 100 },
        { maxEntries: 10, maxDepth: 1, maxBytes: 100 },
        { maxEntries: 10, maxDepth: 10, maxBytes: 1 }
      ])
        await expect(
          filesystem.inventory(locations("album"), limits)
        ).rejects.toMatchObject({ code: "operation_limit" });
    });

    it("rejects extended attributes rather than silently dropping them", async () => {
      const filePath = path.join(root, "photo.jpg");
      await writeFile(filePath, "original");
      execFileSync("python3", [
        "-c",
        "import os,sys; os.setxattr(sys.argv[1], 'user.aether-proof', b'keep')",
        filePath
      ]);
      await expect(
        filesystem.inspect(locations("photo.jpg"))
      ).rejects.toMatchObject({ code: "unsupported_filesystem" });
      expect(await readFile(filePath, "utf8")).toBe("original");
    });

    it("retains partial stages and originals when copied bytes fail verification", async () => {
      await writeFile(path.join(root, "photo.jpg"), "original");
      const expected = await filesystem.inspect(locations("photo.jpg"));
      const wrapped = await wrapper([
        'if [ "$1" = metadata ]; then printf damaged > /proc/self/fd/4; fi'
      ]);
      await expect(
        wrapped.copy(
          locations("photo.jpg"),
          destinations(".aether-staging/operation/photo.jpg"),
          expected
        )
      ).rejects.toMatchObject({ code: "needs_review" });
      expect(await readFile(path.join(root, "photo.jpg"), "utf8")).toBe(
        "original"
      );
      expect(
        await readFile(
          path.join(destinationRoot, ".aether-staging/operation/photo.jpg"),
          "utf8"
        )
      ).toBe("damaged");
      await expect(
        stat(path.join(destinationRoot, "photo.jpg"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("quarantines and purges only a verified owned manifest and rejects new contents", async () => {
      await mkdir(path.join(root, "album/empty"), { recursive: true });
      await writeFile(path.join(root, "album/photo.jpg"), "original");
      await mkdir(path.join(root, ".aether-trash/operation"), {
        recursive: true,
        mode: 0o700
      });
      const source = locations("album");
      const quarantine = locations(".aether-trash/operation/album");
      const expected = await filesystem.inspect(source);
      await filesystem.retire(source, quarantine, expected);
      const manifest = await filesystem.inventory(quarantine);
      await writeFile(
        path.join(root, quarantine.relativePath, "new-file"),
        "external addition"
      );
      await expect(
        filesystem.purgeOwned(quarantine, manifest)
      ).rejects.toMatchObject({ code: "source_changed" });
      expect(
        await readFile(
          path.join(root, quarantine.relativePath, "new-file"),
          "utf8"
        )
      ).toBe("external addition");
      await rm(path.join(root, quarantine.relativePath, "new-file"));
      const refreshed = await filesystem.inventory(quarantine);
      await filesystem.purgeOwned(quarantine, refreshed);
      await expect(
        stat(path.join(root, quarantine.relativePath))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        filesystem.purgeOwned(locations("ordinary"), refreshed)
      ).rejects.toThrow();
    });

    it("keeps unsupported hosts read-only when the native helper is unavailable", async () => {
      const unsupported = new FileOperationsFilesystem(
        path.join(directory, "missing-helper")
      );
      await expect(
        unsupported.createDirectory(locations("new"))
      ).rejects.toMatchObject({ code: "unsupported_filesystem" });
      await expect(stat(path.join(root, "new"))).rejects.toMatchObject({
        code: "ENOENT"
      });
    });

    it("proves exclusive publication for files and directories on an owned volume", async () => {
      const owned = destinations(".aether-staging/operation");
      await filesystem.probe(owned);
      expect((await filesystem.inventory(owned)).entries).toHaveLength(1);
    });

    it("resumes verified quarantine cleanup after some known entries were already removed", async () => {
      const owned = destinations(".aether-staging/operation/album");
      await mkdir(path.join(destinationRoot, owned.relativePath, "empty"), {
        recursive: true
      });
      await writeFile(
        path.join(destinationRoot, owned.relativePath, "first"),
        "first"
      );
      await writeFile(
        path.join(destinationRoot, owned.relativePath, "second"),
        "second"
      );
      const manifest = await filesystem.inventory(owned);
      await rm(path.join(destinationRoot, owned.relativePath, "first"));
      await filesystem.purgeOwned(owned, manifest);
      await filesystem.purgeOwned(owned, manifest);
      await expect(
        stat(path.join(destinationRoot, owned.relativePath))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    async function wrapper(lines: string[]): Promise<FileOperationsFilesystem> {
      const script = path.join(directory, "helper-wrapper");
      await writeFile(
        script,
        [
          "#!/bin/sh",
          "set -eu",
          ...lines,
          `exec ${quote(helper)} "$@"`,
          ""
        ].join("\n"),
        { mode: 0o700 }
      );
      return new FileOperationsFilesystem(script);
    }
  }
);

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
