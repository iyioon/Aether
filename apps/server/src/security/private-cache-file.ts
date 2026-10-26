import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isPathInside, UnsafePathError } from "./path-safety.js";

export async function openPrivateCacheFile(filePath: string, cacheDir: string) {
  if (!isPathInside(cacheDir, filePath)) throw new UnsafePathError();
  const root = await realpath(cacheDir);
  const canonical = await realpath(filePath);
  if (!isPathInside(root, canonical)) throw new UnsafePathError();
  let directory = path.dirname(filePath);
  while (isPathInside(cacheDir, directory)) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new UnsafePathError();
    if (directory === cacheDir) break;
    directory = path.dirname(directory);
  }
  const handle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const info = await handle.stat();
    const current = await stat(canonical);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      (await realpath(filePath)) !== canonical
    )
      throw new UnsafePathError();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function ensurePrivateCacheDirectory(
  cacheDir: string,
  kind: string,
  assetId: string
): Promise<void> {
  if (
    ![kind, assetId].every((segment) => /^[a-zA-Z0-9_-]{1,256}$/.test(segment))
  )
    throw new UnsafePathError();
  let directory = cacheDir;
  for (const segment of [null, kind, assetId]) {
    if (segment) directory = path.join(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      }
    );
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new UnsafePathError();
    await chmod(directory, 0o700);
  }
}
