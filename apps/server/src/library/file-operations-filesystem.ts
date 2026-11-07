import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UnsafePathError } from "../security/path-safety.js";
import {
  assertPrivateDirectory,
  descriptorFilesystemAvailable,
  directoryNames as readDirectoryNames,
  lstatRelative,
  mkdirRelative,
  openRelative,
  removeRelative,
  type DescriptorHandle
} from "../security/descriptor-filesystem.js";

export interface FileOperationLocation {
  rootPath: string;
  relativePath: string;
  expectedRoot?: { dev: string; ino: string };
}

const Identity = z.object({
  dev: z.string().regex(/^\d+$/),
  ino: z.string().regex(/^\d+$/),
  size: z.string().regex(/^\d+$/),
  mtimeNs: z.string().regex(/^-?\d+$/),
  ctimeNs: z.string().regex(/^-?\d+$/),
  mode: z.number().int().min(0).max(0o7777),
  metadataSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  metadataBytes: z
    .number()
    .int()
    .min(0)
    .max(64 * 1024 ** 2)
    .optional(),
  kind: z.enum(["file", "directory"])
});

export type FileOperationIdentity = z.infer<typeof Identity>;

export interface FileOperationManifestEntry {
  relativePath: string;
  identity: FileOperationIdentity;
  sha256: string | null;
}

export interface FileOperationManifest {
  entries: FileOperationManifestEntry[];
  totalBytes: number;
}

export interface FileOperationLimits {
  maxEntries: number;
  maxDepth: number;
  maxBytes: number;
}

export const DEFAULT_FILE_OPERATION_LIMITS: FileOperationLimits = {
  maxEntries: 10_000,
  maxDepth: 64,
  maxBytes: 20 * 1024 ** 3
};

export type FileOperationFilesystemErrorCode =
  | "unsupported_filesystem"
  | "unsafe_entry"
  | "source_changed"
  | "destination_exists"
  | "cross_device"
  | "needs_review"
  | "filesystem_error"
  | "operation_limit";

export class FileOperationFilesystemError extends Error {
  constructor(public readonly code: FileOperationFilesystemErrorCode) {
    super(code);
    this.name = "FileOperationFilesystemError";
  }
}

interface PinnedParent {
  handles: DescriptorHandle[];
  parent: DescriptorHandle;
  leaf: string;
  rootDevice: bigint;
}

/** Managed mutations use pinned directory descriptors and atomic no-replace publication, never
 * exists-then-rename. Journal intent before calling mutating methods. */
export class FileOperationsFilesystem {
  private readonly rootIdentities = new Map<
    string,
    { dev: string; ino: string }
  >();

  constructor(
    private readonly nativeHelperPath = fileURLToPath(
      new URL("../../dist/native/file-operations", import.meta.url)
    )
  ) {}

  async inspectRoot(rootPath: string): Promise<{ dev: string; ino: string }> {
    return this.withParent({ rootPath, relativePath: "" }, async (pinned) => {
      const info = await pinned.parent.stat({ bigint: true });
      return { dev: String(info.dev), ino: String(info.ino) };
    });
  }

  /** Prove this volume honors exclusive file/directory publication before
   * exposing write capabilities. The caller owns this private probe directory. */
  async probe(ownedDirectory: FileOperationLocation): Promise<void> {
    assertOwnedLocation({
      ...ownedDirectory,
      relativePath: `${ownedDirectory.relativePath}/probe`
    });
    await this.withEntry(ownedDirectory, async (handle) => {
      await this.native(["probe"], [handle]);
    });
  }

  async inspect(
    location: FileOperationLocation
  ): Promise<FileOperationIdentity> {
    return this.withEntry(location, async (handle) => this.check(handle));
  }

  /** Any leaf, including an unindexed file or symlink, reserves its name.
   * The parent is pinned and revalidated; the leaf is never followed. */
  async entryExists(location: FileOperationLocation): Promise<boolean> {
    return this.withParent(location, async (pinned) => {
      if (!pinned.leaf) return true;
      let exists = true;
      try {
        await lstatRelative(pinned.parent, pinned.leaf);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        exists = false;
      }
      await this.verifyParent(location, pinned);
      return exists;
    });
  }

  /** Case-preserving filesystems may resolve two spellings to the same object.
   * Recovery needs the actual entry's case, not an alias lookup. Darwin may
   * return a canonically equivalent Unicode spelling for the same filename. */
  async hasExactEntryName(location: FileOperationLocation): Promise<boolean> {
    return this.withParent(location, async (pinned) => {
      const exists =
        !pinned.leaf ||
        (
          await directoryNames(
            pinned.parent,
            DEFAULT_FILE_OPERATION_LIMITS.maxEntries
          )
        ).some((name) =>
          process.platform === "darwin"
            ? name.normalize("NFC") === pinned.leaf.normalize("NFC")
            : name === pinned.leaf
        );
      await this.verifyParent(location, pinned);
      return exists;
    });
  }

  async createDirectory(
    location: FileOperationLocation
  ): Promise<FileOperationIdentity> {
    return this.withParent(location, async (pinned) => {
      if (!pinned.leaf) throw new UnsafePathError();
      await this.check(pinned.parent);
      await mkdirRelative(pinned.parent, pinned.leaf);
      const parts = segments(location.relativePath);
      if (
        parts.length <= 2 &&
        [".aether-staging", ".aether-trash"].includes(parts[0]!)
      ) {
        const created = await openRelative(
          pinned.parent,
          pinned.leaf,
          constants.O_RDONLY | constants.O_DIRECTORY
        );
        try {
          await assertPrivateDirectory(created, true);
        } finally {
          await created.close();
        }
      }
      await pinned.parent.sync();
      await this.verifyParent(location, pinned);
      return this.inspect(location);
    });
  }

  async rename(
    source: FileOperationLocation,
    destination: FileOperationLocation,
    expected: FileOperationIdentity
  ): Promise<FileOperationIdentity> {
    if (
      !segments(source.relativePath).length ||
      !segments(destination.relativePath).length
    )
      throw new UnsafePathError();
    if (
      expected.kind === "directory" &&
      path.resolve(source.rootPath) === path.resolve(destination.rootPath) &&
      (destination.relativePath === source.relativePath ||
        destination.relativePath.startsWith(`${source.relativePath}/`))
    )
      throw new UnsafePathError();
    return this.withParent(source, async (from) =>
      this.withParent(destination, async (to) => {
        const result = await this.native(
          ["rename", from.leaf, to.leaf, identityToken(expected)],
          [from.parent, to.parent]
        );
        // A successful rename can already have committed when a host writer
        // replaces a parent. Retain both journal reservations for recovery.
        try {
          await this.verifyParent(source, from);
          await this.verifyParent(destination, to);
        } catch {
          throw new FileOperationFilesystemError("needs_review");
        }
        return result;
      })
    );
  }

  /** Source retirement is a no-replace quarantine move. A wrong/racing entry
   * remains journaled for review instead of being deleted. */
  async retire(
    source: FileOperationLocation,
    ownedQuarantine: FileOperationLocation,
    expected: FileOperationIdentity
  ): Promise<FileOperationIdentity> {
    assertOwnedLocation(ownedQuarantine);
    return this.rename(source, ownedQuarantine, expected);
  }

  async inventory(
    source: FileOperationLocation,
    limits = DEFAULT_FILE_OPERATION_LIMITS
  ): Promise<FileOperationManifest> {
    validateLimits(limits);
    const manifest: FileOperationManifest = { entries: [], totalBytes: 0 };
    await this.withEntry(source, async (handle, device) => {
      await this.walk(handle, device, "", manifest, limits);
    });
    return manifest;
  }

  /** Copies into an exclusive operation-owned stage, verifies bytes and the
   * complete source manifest, and leaves all partial stages for journal recovery. */
  async copy(
    source: FileOperationLocation,
    ownedStage: FileOperationLocation,
    expected: FileOperationIdentity,
    limits = DEFAULT_FILE_OPERATION_LIMITS,
    onStageCreated?: (identity: FileOperationIdentity) => Promise<void>,
    onProgress?: (bytes: number, totalBytes: number) => void
  ): Promise<{
    identity: FileOperationIdentity;
    manifest: FileOperationManifest;
  }> {
    assertOwnedLocation(ownedStage);
    const manifest = await this.inventory(source, limits);
    const first = manifest.entries[0];
    if (!first || !identitiesEqual(first.identity, expected))
      throw new FileOperationFilesystemError("source_changed");
    let copiedBytes = 0;
    onProgress?.(0, manifest.totalBytes);
    const reportProgress = (bytes: number) => {
      copiedBytes += bytes;
      onProgress?.(copiedBytes, manifest.totalBytes);
    };
    await this.withEntry(source, async (sourceHandle, sourceDevice) => {
      const current = await this.check(sourceHandle);
      if (!identitiesEqual(current, expected))
        throw new FileOperationFilesystemError("source_changed");
      await this.withParent(ownedStage, async (destination) => {
        await this.copyEntry(
          sourceHandle,
          sourceDevice,
          destination.parent,
          destination.leaf,
          "",
          manifest,
          onStageCreated,
          reportProgress
        );
        await destination.parent.sync();
        await this.verifyParent(ownedStage, destination);
      });
    });
    const after = await this.inventory(source, limits);
    if (!manifestsEqual(manifest, after))
      throw new FileOperationFilesystemError("source_changed");
    const copied = await this.inventory(ownedStage, limits);
    if (!copiedContentsEqual(manifest, copied))
      throw new FileOperationFilesystemError("needs_review");
    return { identity: copied.entries[0]!.identity, manifest: copied };
  }

  /** Purge only app-owned quarantine/staging, after its identity is verified.
   * Each known leaf is removed separately; newly added files stop cleanup. */
  async purgeOwned(
    ownedLocation: FileOperationLocation,
    expected: FileOperationManifest,
    limits = DEFAULT_FILE_OPERATION_LIMITS
  ): Promise<void> {
    assertOwnedLocation(ownedLocation, true);
    await this.inspectRoot(ownedLocation.rootPath);
    let actual: FileOperationManifest;
    try {
      actual = await this.inventory(ownedLocation, limits);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const expectedByPath = new Map(
      expected.entries.map((entry) => [entry.relativePath, entry])
    );
    if (
      actual.entries.some((entry) => {
        const previous = expectedByPath.get(entry.relativePath);
        return (
          !previous ||
          !purgeIdentityMatches(entry.identity, previous.identity) ||
          entry.sha256 !== previous.sha256
        );
      })
    )
      throw new FileOperationFilesystemError("source_changed");
    for (const entry of [...actual.entries].reverse()) {
      const location = {
        ...ownedLocation,
        relativePath: path.posix.join(
          ownedLocation.relativePath,
          entry.relativePath
        )
      };
      await this.withParent(location, async (pinned) => {
        const current = await this.inspect(location);
        if (!purgeIdentityMatches(current, entry.identity))
          throw new FileOperationFilesystemError("source_changed");
        await removeRelative(
          pinned.parent,
          pinned.leaf,
          entry.identity.kind === "directory",
          entry.identity
        );
        await pinned.parent.sync();
      });
    }
  }

  private async check(
    handle: DescriptorHandle
  ): Promise<FileOperationIdentity> {
    return this.native(["check"], [handle]);
  }

  private async walk(
    handle: DescriptorHandle,
    device: bigint,
    relativePath: string,
    manifest: FileOperationManifest,
    limits: FileOperationLimits
  ): Promise<void> {
    if (
      manifest.entries.length >= limits.maxEntries ||
      segments(relativePath).length > limits.maxDepth
    )
      throw new FileOperationFilesystemError("operation_limit");
    const identity = await this.check(handle);
    if (BigInt(identity.dev) !== device)
      throw new FileOperationFilesystemError("unsafe_entry");
    {
      const bytes =
        (identity.kind === "file" ? Number(identity.size) : 0) +
        (identity.metadataBytes ?? 0);
      if (
        !Number.isSafeInteger(bytes) ||
        manifest.totalBytes + bytes > limits.maxBytes
      )
        throw new FileOperationFilesystemError("operation_limit");
      manifest.totalBytes += bytes;
    }
    const sha256 =
      identity.kind === "file"
        ? await digest(handle, Number(identity.size))
        : null;
    manifest.entries.push({ relativePath, identity, sha256 });
    if (identity.kind === "directory") {
      const names = await directoryNames(
        handle,
        limits.maxEntries - manifest.entries.length
      );
      for (const name of names) {
        const child = await openChild(handle, name);
        try {
          await this.walk(
            child,
            device,
            path.posix.join(relativePath, name),
            manifest,
            limits
          );
        } finally {
          await child.close();
        }
      }
      if (
        JSON.stringify(names) !==
        JSON.stringify(await directoryNames(handle, limits.maxEntries))
      )
        throw new FileOperationFilesystemError("source_changed");
    }
    if (!identitiesEqual(identity, await this.check(handle)))
      throw new FileOperationFilesystemError("source_changed");
  }

  private async copyEntry(
    source: DescriptorHandle,
    sourceDevice: bigint,
    parent: DescriptorHandle,
    name: string,
    relativePath: string,
    manifest: FileOperationManifest,
    onStageCreated?: (identity: FileOperationIdentity) => Promise<void>,
    onBytesCopied?: (bytes: number) => void
  ): Promise<void> {
    const expected = manifest.entries.find(
      (entry) => entry.relativePath === relativePath
    );
    const current = await this.check(source);
    if (
      !expected ||
      !identitiesEqual(current, expected.identity) ||
      BigInt(current.dev) !== sourceDevice
    )
      throw new FileOperationFilesystemError("source_changed");
    if (current.kind === "directory") await mkdirRelative(parent, name);
    const destination = await openRelative(
      parent,
      name,
      current.kind === "directory"
        ? constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
        : constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
      0o600
    );
    try {
      if (!relativePath && onStageCreated)
        await onStageCreated(await this.check(destination));
      if (current.kind === "file") {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let offset = 0;
        const hash = createHash("sha256");
        while (offset < Number(current.size)) {
          const { bytesRead } = await source.read(
            buffer,
            0,
            Math.min(buffer.length, Number(current.size) - offset),
            offset
          );
          if (!bytesRead)
            throw new FileOperationFilesystemError("source_changed");
          hash.update(buffer.subarray(0, bytesRead));
          let written = 0;
          while (written < bytesRead) {
            const result = await destination.write(
              buffer,
              written,
              bytesRead - written,
              offset + written
            );
            if (!result.bytesWritten)
              throw new FileOperationFilesystemError("filesystem_error");
            written += result.bytesWritten;
            onBytesCopied?.(result.bytesWritten);
          }
          offset += bytesRead;
        }
        if (hash.digest("hex") !== expected.sha256)
          throw new FileOperationFilesystemError("source_changed");
      } else {
        const expectedNames = manifest.entries
          .filter(
            (entry) =>
              entry.relativePath &&
              path.posix.dirname(entry.relativePath) === (relativePath || ".")
          )
          .map((entry) => path.posix.basename(entry.relativePath))
          .sort();
        const names = await directoryNames(source, expectedNames.length);
        if (JSON.stringify(names) !== JSON.stringify(expectedNames))
          throw new FileOperationFilesystemError("source_changed");
        for (const childName of names) {
          const child = await openChild(source, childName);
          try {
            await this.copyEntry(
              child,
              sourceDevice,
              destination,
              childName,
              path.posix.join(relativePath, childName),
              manifest,
              undefined,
              onBytesCopied
            );
          } finally {
            await child.close();
          }
        }
      }
      if (!identitiesEqual(current, await this.check(source)))
        throw new FileOperationFilesystemError("source_changed");
      await this.native(["metadata"], [source, destination]);
      onBytesCopied?.(current.metadataBytes ?? 0);
    } finally {
      await destination.close();
    }
  }

  private async withEntry<T>(
    location: FileOperationLocation,
    use: (handle: DescriptorHandle, device: bigint) => Promise<T>
  ): Promise<T> {
    return this.withParent(location, async (pinned) => {
      const handle = pinned.leaf
        ? await openChild(pinned.parent, pinned.leaf)
        : pinned.parent;
      try {
        if ((await handle.stat({ bigint: true })).dev !== pinned.rootDevice)
          throw new FileOperationFilesystemError("unsafe_entry");
        const parts = segments(location.relativePath);
        if (
          parts.length &&
          parts.length <= 2 &&
          [".aether-staging", ".aether-trash"].includes(parts[0]!)
        )
          await assertPrivateDirectory(handle);
        return await use(handle, pinned.rootDevice);
      } finally {
        if (handle !== pinned.parent) await handle.close();
      }
    });
  }

  private async withParent<T>(
    location: FileOperationLocation,
    use: (pinned: PinnedParent) => Promise<T>
  ): Promise<T> {
    if (!descriptorFilesystemAvailable())
      throw new FileOperationFilesystemError("unsupported_filesystem");
    const parts = segments(location.relativePath);
    if (
      !path.isAbsolute(location.rootPath) ||
      (await realpath(location.rootPath)) !== path.resolve(location.rootPath)
    )
      throw new UnsafePathError();
    const handles: DescriptorHandle[] = [];
    try {
      const root = await open(
        location.rootPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      handles.push(root);
      const rootDevice = (await root.stat({ bigint: true })).dev;
      const rootInfo = await root.stat({ bigint: true });
      const rootIdentity = {
        dev: String(rootInfo.dev),
        ino: String(rootInfo.ino)
      };
      const expectedRoot =
        location.expectedRoot ?? this.rootIdentities.get(location.rootPath);
      if (
        expectedRoot &&
        (expectedRoot.dev !== rootIdentity.dev ||
          expectedRoot.ino !== rootIdentity.ino)
      )
        throw new FileOperationFilesystemError("source_changed");
      this.rootIdentities.set(location.rootPath, rootIdentity);
      let parent: DescriptorHandle = root;
      for (const [index, part] of parts.slice(0, -1).entries()) {
        const next = await openRelative(
          parent,
          part,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
        );
        handles.push(next);
        const nextInfo = await next.stat({ bigint: true });
        if (nextInfo.dev !== rootDevice)
          throw new FileOperationFilesystemError("unsafe_entry");
        if (
          [".aether-staging", ".aether-trash"].includes(parts[0]!) &&
          index < 2 &&
          (nextInfo.uid !== BigInt(process.getuid!()) ||
            (nextInfo.mode & 0o777n) !== 0o700n)
        )
          throw new FileOperationFilesystemError("unsafe_entry");
        if (
          [".aether-staging", ".aether-trash"].includes(parts[0]!) &&
          index < 2
        )
          await assertPrivateDirectory(next);
        parent = next;
      }
      return await use({
        handles,
        parent,
        leaf: parts.at(-1) ?? "",
        rootDevice
      });
    } finally {
      await Promise.all(handles.reverse().map((handle) => handle.close()));
    }
  }

  private async verifyParent(
    location: FileOperationLocation,
    expected: PinnedParent
  ): Promise<void> {
    await this.withParent(location, async (actual) => {
      const before = await expected.parent.stat({ bigint: true });
      const after = await actual.parent.stat({ bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino)
        throw new FileOperationFilesystemError("needs_review");
    });
  }

  private async native(
    args: string[],
    handles: DescriptorHandle[]
  ): Promise<FileOperationIdentity> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.nativeHelperPath, args, {
        stdio: [
          "ignore",
          "pipe",
          "ignore",
          ...handles.map((handle) => handle.fd)
        ]
      });
      let output = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 4096) child.kill();
      });
      child.once("error", () =>
        reject(new FileOperationFilesystemError("unsupported_filesystem"))
      );
      child.once("close", (code) => {
        if (code !== 0) {
          const codes: Record<number, FileOperationFilesystemErrorCode> = {
            20: "unsupported_filesystem",
            21: "unsafe_entry",
            22: "source_changed",
            23: "destination_exists",
            24: "cross_device",
            25: "needs_review"
          };
          reject(
            new FileOperationFilesystemError(
              codes[code ?? 26] ?? "filesystem_error"
            )
          );
          return;
        }
        try {
          resolve(Identity.parse(JSON.parse(output)));
        } catch {
          reject(new FileOperationFilesystemError("filesystem_error"));
        }
      });
    });
  }
}

function segments(relativePath: string): string[] {
  if (relativePath === "") return [];
  const parts = relativePath.split("/");
  if (
    path.isAbsolute(relativePath) ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        [...part].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ) ||
        Buffer.byteLength(part, "utf8") > 255
    )
  )
    throw new UnsafePathError();
  return parts;
}

function assertOwnedLocation(
  location: FileOperationLocation,
  allowOperationRoot = false
): void {
  const parts = segments(location.relativePath);
  if (
    parts.length < (allowOperationRoot ? 2 : 3) ||
    ![".aether-staging", ".aether-trash"].includes(parts[0]!) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(parts[1]!)
  )
    throw new UnsafePathError();
}

function validateLimits(limits: FileOperationLimits): void {
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0
    )
  )
    throw new FileOperationFilesystemError("operation_limit");
}

async function openChild(
  parent: DescriptorHandle,
  name: string
): Promise<DescriptorHandle> {
  segments(name);
  return openRelative(parent, name, constants.O_RDONLY | constants.O_NONBLOCK);
}

function identityToken(identity: FileOperationIdentity): string {
  return [
    identity.dev,
    identity.ino,
    identity.size,
    identity.mtimeNs,
    identity.ctimeNs
  ].join(":");
}

function identitiesEqual(
  left: FileOperationIdentity,
  right: FileOperationIdentity
): boolean {
  return (
    identityToken(left) === identityToken(right) &&
    left.kind === right.kind &&
    left.mode === right.mode &&
    left.metadataSha256 === right.metadataSha256
  );
}

function purgeIdentityMatches(
  left: FileOperationIdentity,
  right: FileOperationIdentity
): boolean {
  // Earlier verified removals change parent-directory times and size.
  return right.kind === "directory"
    ? left.kind === "directory" &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.mode === right.mode &&
        left.metadataSha256 === right.metadataSha256
    : identitiesEqual(left, right);
}

async function digest(
  handle: DescriptorHandle,
  expectedBytes: number
): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < expectedBytes) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, expectedBytes - offset),
      offset
    );
    if (!bytesRead) throw new FileOperationFilesystemError("source_changed");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  if ((await handle.read(buffer, 0, 1, offset)).bytesRead)
    throw new FileOperationFilesystemError("source_changed");
  return hash.digest("hex");
}

async function directoryNames(
  handle: DescriptorHandle,
  limit: number
): Promise<string[]> {
  try {
    return await readDirectoryNames(handle, limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "E2BIG")
      throw new FileOperationFilesystemError("operation_limit");
    throw error;
  }
}

function manifestsEqual(
  left: FileOperationManifest,
  right: FileOperationManifest
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function copiedContentsEqual(
  left: FileOperationManifest,
  right: FileOperationManifest
): boolean {
  return (
    left.totalBytes === right.totalBytes &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const copied = right.entries[index];
      return (
        copied &&
        entry.relativePath === copied.relativePath &&
        entry.sha256 === copied.sha256 &&
        entry.identity.kind === copied.identity.kind &&
        entry.identity.mode === copied.identity.mode &&
        entry.identity.metadataSha256 === copied.identity.metadataSha256 &&
        (entry.identity.metadataBytes ?? 0) ===
          (copied.identity.metadataBytes ?? 0) &&
        entry.identity.mtimeNs === copied.identity.mtimeNs &&
        (entry.identity.kind === "directory" ||
          entry.identity.size === copied.identity.size)
      );
    })
  );
}
