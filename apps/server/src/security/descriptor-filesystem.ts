import {
  close,
  constants,
  fstat,
  ftruncate,
  read,
  write,
  type BigIntStats,
  type Stats
} from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { UnsafePathError } from "./path-safety.js";

/** The deliberately small shared subset of a Node FileHandle used by managed
 * writes. Native openat descriptors stay owned by this wrapper until close. */
export interface DescriptorHandle {
  readonly fd: number;
  stat(): Promise<Stats>;
  stat(options: { bigint: true }): Promise<BigIntStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number; buffer: Buffer }>;
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesWritten: number; buffer: Buffer }>;
  truncate(length: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
interface DescriptorParent {
  readonly fd: number;
}
interface EntryInfo {
  dev: bigint;
  ino: bigint;
  size: bigint;
  nlink: bigint;
  uid: bigint;
  mode: bigint;
}
interface NativeFilesystem {
  open(
    parent: number,
    name: string,
    flags: number,
    mode: number
  ): Promise<number>;
  mkdir(parent: number, name: string, mode: number): Promise<void>;
  remove(
    parent: number,
    name: string,
    directory: boolean,
    dev?: bigint,
    ino?: bigint
  ): Promise<void>;
  list(parent: number, limit: number): Promise<Buffer[]>;
  lstat(parent: number, name: string): Promise<EntryInfo>;
  sync(fd: number): Promise<void>;
  rewind(fd: number): Promise<void>;
  privateDirectory(fd: number, created: boolean): Promise<void>;
}
let native: NativeFilesystem | undefined;
function filesystem(): NativeFilesystem {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw Object.assign(
      new Error("Managed writes are unavailable on this platform."),
      { code: "ENOTSUP" }
    );
  if (!native) {
    try {
      const require = createRequire(import.meta.url);
      native = require(
        fileURLToPath(
          new URL(
            "../../dist/native/descriptor-filesystem.node",
            import.meta.url
          )
        )
      ) as NativeFilesystem;
    } catch {
      throw Object.assign(
        new Error("Build the native filesystem helper before enabling writes."),
        { code: "ENOTSUP" }
      );
    }
  }
  return native;
}
function nameOnly(name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    [...name].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    Buffer.byteLength(name) > 255
  )
    throw new UnsafePathError();
  return name;
}
class OwnedDescriptor implements DescriptorHandle {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly active = new Set<Promise<unknown>>();
  constructor(readonly fd: number) {}
  private use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.closing)
      return Promise.reject(
        Object.assign(new Error("Descriptor is closed."), { code: "EBADF" })
      );
    const running = operation();
    this.active.add(running);
    void running
      .finally(() => this.active.delete(running))
      .catch(() => undefined);
    return running;
  }
  stat(): Promise<Stats>;
  stat(options: { bigint: true }): Promise<BigIntStats>;
  stat(options?: { bigint: true }): Promise<Stats | BigIntStats> {
    return this.use(
      () =>
        new Promise<Stats | BigIntStats>((resolve, reject) => {
          if (options?.bigint)
            fstat(this.fd, { bigint: true }, (error, value) =>
              error ? reject(error) : resolve(value)
            );
          else
            fstat(this.fd, (error, value) =>
              error ? reject(error) : resolve(value)
            );
        })
    );
  }
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number; buffer: Buffer }> {
    return this.use(
      () =>
        new Promise((resolve, reject) =>
          read(this.fd, buffer, offset, length, position, (error, bytesRead) =>
            error ? reject(error) : resolve({ bytesRead, buffer })
          )
        )
    );
  }
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesWritten: number; buffer: Buffer }> {
    return this.use(
      () =>
        new Promise((resolve, reject) =>
          write(
            this.fd,
            buffer,
            offset,
            length,
            position,
            (error, bytesWritten) =>
              error ? reject(error) : resolve({ bytesWritten, buffer })
          )
        )
    );
  }
  truncate(length: number): Promise<void> {
    return this.use(
      () =>
        new Promise((resolve, reject) =>
          ftruncate(this.fd, length, (error) =>
            error ? reject(error) : resolve()
          )
        )
    );
  }
  sync(): Promise<void> {
    return this.use(() => filesystem().sync(this.fd));
  }
  close(): Promise<void> {
    if (!this.closing)
      this.closing = (async () => {
        await Promise.allSettled([...this.active]);
        await new Promise<void>((resolve, reject) =>
          close(this.fd, (error) => (error ? reject(error) : resolve()))
        );
        this.closed = true;
      })();
    return this.closing;
  }
}
export async function openRelative(
  parent: DescriptorParent,
  name: string,
  flags: number,
  mode = 0o600
): Promise<DescriptorHandle> {
  return new OwnedDescriptor(
    await filesystem().open(parent.fd, nameOnly(name), flags, mode)
  );
}
export async function mkdirRelative(
  parent: DescriptorParent,
  name: string,
  mode = 0o700
): Promise<void> {
  await filesystem().mkdir(parent.fd, nameOnly(name), mode);
}
export async function removeRelative(
  parent: DescriptorParent,
  name: string,
  directory = false,
  expected?: { dev: string; ino: string }
): Promise<void> {
  const leaf = nameOnly(name);
  if (expected)
    await filesystem().remove(
      parent.fd,
      leaf,
      directory,
      BigInt(expected.dev),
      BigInt(expected.ino)
    );
  else await filesystem().remove(parent.fd, leaf, directory);
}
export async function directoryNames(
  parent: DescriptorParent,
  limit = 10000
): Promise<string[]> {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100000)
    throw new RangeError("Invalid directory entry limit.");
  const names = await filesystem().list(parent.fd, limit);
  return names
    .map((bytes) => {
      const name = bytes.toString("utf8");
      if (!Buffer.from(name, "utf8").equals(bytes)) throw new UnsafePathError();
      return nameOnly(name);
    })
    .sort();
}
export async function lstatRelative(
  parent: DescriptorParent,
  name: string
): Promise<
  EntryInfo & {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
> {
  const value = await filesystem().lstat(parent.fd, nameOnly(name));
  const kind = Number(value.mode) & constants.S_IFMT;
  return {
    ...value,
    isFile: () => kind === constants.S_IFREG,
    isDirectory: () => kind === constants.S_IFDIR,
    isSymbolicLink: () => kind === constants.S_IFLNK
  };
}
/** Exact descriptor aliases are only used to hand a pinned file to a decoder.
 * Child names must always use the descriptor-relative operations above. */
export function descriptorPath(handle: DescriptorParent): string {
  if (!Number.isSafeInteger(handle.fd) || handle.fd < 0)
    throw new UnsafePathError();
  if (process.platform === "linux") return `/proc/self/fd/${handle.fd}`;
  if (process.platform === "darwin") return `/dev/fd/${handle.fd}`;
  throw Object.assign(new Error("Descriptor aliases are unavailable."), {
    code: "ENOTSUP"
  });
}

export async function rewindDescriptor(
  handle: DescriptorParent
): Promise<void> {
  await filesystem().rewind(handle.fd);
}

export function descriptorFilesystemAvailable(): boolean {
  try {
    filesystem();
    return true;
  } catch {
    return false;
  }
}

/** Existing private directories are inspected only. ACL inheritance may be
 * cleared solely on an exclusively created application-owned directory. */
export async function assertPrivateDirectory(
  handle: DescriptorParent,
  created = false
): Promise<void> {
  await filesystem().privateDirectory(handle.fd, created);
}
