import { closeSync, constants, openSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPrivateDirectory,
  directoryNames,
  lstatRelative,
  mkdirRelative,
  openRelative,
  removeRelative,
  type DescriptorHandle
} from "../src/security/descriptor-filesystem.js";

describe.skipIf(!["linux", "darwin"].includes(process.platform))(
  "descriptor-relative filesystem",
  () => {
    let directory: string;
    const handles: DescriptorHandle[] = [];
    beforeEach(async () => {
      directory = await realpath(
        await mkdtemp(path.join(tmpdir(), "aether-descriptors-"))
      );
    });
    afterEach(async () => {
      await Promise.allSettled(
        handles.splice(0).map((handle) => handle.close())
      );
      await rm(directory, { recursive: true, force: true });
    });
    async function parent() {
      const handle = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      handles.push(handle);
      return handle;
    }
    it("keeps writes in the pinned directory after its pathname is replaced with a symlink", async () => {
      const pinned = await parent();
      const old = `${directory}-old`;
      const outside = `${directory}-outside`;
      await mkdir(outside);
      try {
        await rename(directory, old);
        await symlink(outside, directory);
        await mkdirRelative(pinned, "folder");
        const file = await openRelative(
          pinned,
          "file",
          constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
        );
        handles.push(file);
        await file.write(Buffer.from("safe"), 0, 4, 0);
        await file.sync();
        expect(await readFile(path.join(old, "file"), "utf8")).toBe("safe");
        expect(await directoryNames(pinned)).toEqual(["file", "folder"]);
        expect(
          await directoryNames(
            await open(
              outside,
              constants.O_RDONLY | constants.O_DIRECTORY
            ).then((handle) => {
              handles.push(handle);
              return handle;
            })
          )
        ).toEqual([]);
      } finally {
        await rm(directory, { force: true });
        await rename(old, directory);
        await rm(outside, { recursive: true, force: true });
      }
    });
    it("pins a queued operation before the caller closes and reuses the descriptor", async () => {
      const outside = `${directory}-outside`;
      await mkdir(outside);
      const original = openSync(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY
      );
      const pending = mkdirRelative({ fd: original }, "retained");
      closeSync(original);
      const replacement = openSync(
        outside,
        constants.O_RDONLY | constants.O_DIRECTORY
      );
      try {
        expect(replacement).toBe(original);
        await pending;
        expect(
          (await stat(path.join(directory, "retained"))).isDirectory()
        ).toBe(true);
        expect(await directoryNames({ fd: replacement })).toEqual([]);
      } finally {
        closeSync(replacement);
        await rm(outside, { recursive: true, force: true });
      }
    });
    it("does not follow symlinks or replace an existing leaf", async () => {
      const pinned = await parent();
      await writeFile(path.join(directory, "original"), "keep");
      await symlink("original", path.join(directory, "link"));
      expect((await lstatRelative(pinned, "link")).isSymbolicLink()).toBe(true);
      await expect(
        openRelative(pinned, "link", constants.O_RDWR)
      ).rejects.toMatchObject({ code: "ELOOP" });
      await expect(
        openRelative(
          pinned,
          "original",
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        )
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(path.join(directory, "original"), "utf8")).toBe(
        "keep"
      );
    });
    it("preserves Unicode filenames through descriptor-relative operations", async () => {
      const pinned = await parent();
      const name = "写真🙂.jpg";
      const file = await openRelative(
        pinned,
        name,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
      );
      handles.push(file);
      await file.write(Buffer.from("photo"), 0, 5, 0);
      expect(await directoryNames(pinned)).toEqual([name]);
      expect(await readFile(path.join(directory, name), "utf8")).toBe("photo");
    });
    it("bounds directory reads and gives each read an independent cursor", async () => {
      const pinned = await parent();
      for (const name of ["a", "b", "c"])
        await writeFile(path.join(directory, name), name);
      await expect(directoryNames(pinned, 2)).rejects.toMatchObject({
        code: "E2BIG"
      });
      expect(await directoryNames(pinned, 3)).toEqual(["a", "b", "c"]);
      expect(await directoryNames(pinned, 3)).toEqual(["a", "b", "c"]);
    });
    it("refuses removal when a leaf no longer has its recorded identity", async () => {
      const pinned = await parent();
      await writeFile(path.join(directory, "entry"), "owned");
      const before = await lstatRelative(pinned, "entry");
      await rename(path.join(directory, "entry"), path.join(directory, "old"));
      await writeFile(path.join(directory, "entry"), "replacement");
      await expect(
        removeRelative(pinned, "entry", false, {
          dev: String(before.dev),
          ino: String(before.ino)
        })
      ).rejects.toMatchObject({ code: "ESTALE" });
      expect(await readFile(path.join(directory, "entry"), "utf8")).toBe(
        "replacement"
      );
    });
    it("waits for active I/O before close and rejects further use", async () => {
      const pinned = await parent();
      const file = await openRelative(
        pinned,
        "file",
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
      );
      handles.push(file);
      const bytes = Buffer.alloc(64 * 1024, 71);
      const pending = file.write(bytes, 0, bytes.length, 0);
      const closing = file.close();
      expect((await pending).bytesWritten).toBe(bytes.length);
      await closing;
      await expect(file.stat()).rejects.toMatchObject({ code: "EBADF" });
      expect(await readFile(path.join(directory, "file"))).toEqual(bytes);
    });

    it.skipIf(process.platform !== "linux")(
      "rejects filenames that cannot round-trip through UTF-8",
      async () => {
        const pinned = await parent();
        await writeFile(
          Buffer.concat([Buffer.from(`${directory}/`), Buffer.from([255])]),
          "keep"
        );
        await expect(directoryNames(pinned)).rejects.toThrow();
      }
    );
    it.skipIf(process.platform !== "darwin")(
      "rejects ACLs on existing private directories and clears inheritance only on new private directories",
      async () => {
        const user = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
        const acl = `user:${user} allow list,search,add_file,add_subdirectory,file_inherit,directory_inherit`;
        execFileSync("chmod", ["+a", acl, directory]);
        await mkdir(path.join(directory, "private"), { mode: 0o700 });
        const child = await open(
          path.join(directory, "private"),
          constants.O_RDONLY | constants.O_DIRECTORY
        );
        handles.push(child);
        await expect(assertPrivateDirectory(child)).rejects.toMatchObject({
          code: "EACCES"
        });
        const before = execFileSync(
          "ls",
          ["-lde", path.join(directory, "private")],
          { encoding: "utf8" }
        );
        expect(before).toContain("inherited");
        await assertPrivateDirectory(child, true);
        await expect(assertPrivateDirectory(child)).resolves.toBeUndefined();
        expect(
          execFileSync("ls", ["-lde", directory], { encoding: "utf8" })
        ).toContain("file_inherit");
      }
    );
    it("rejects traversal and invalid single names before touching the filesystem", async () => {
      const pinned = await parent();
      for (const name of [
        "",
        ".",
        "..",
        "a/b",
        "a\\b",
        "null\0byte",
        "x".repeat(256)
      ]) {
        await expect(
          openRelative(pinned, name, constants.O_CREAT | constants.O_WRONLY)
        ).rejects.toThrow();
        await expect(mkdirRelative(pinned, name)).rejects.toThrow();
        await expect(removeRelative(pinned, name)).rejects.toThrow();
      }
      expect(await directoryNames(pinned)).toEqual([]);
    });
  }
);
