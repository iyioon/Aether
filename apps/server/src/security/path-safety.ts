import { realpath } from "node:fs/promises";
import path from "node:path";

export class UnsafePathError extends Error {
  constructor(message = "Requested path is outside the configured media root.") {
    super(message);
    this.name = "UnsafePathError";
  }
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export async function resolveMediaPath(
  rootRealPath: string,
  relativeMediaPath: string
): Promise<string> {
  if (path.isAbsolute(relativeMediaPath)) {
    throw new UnsafePathError("Absolute media paths are not accepted.");
  }

  const candidate = path.resolve(rootRealPath, relativeMediaPath);
  const candidateRealPath = await realpath(candidate);

  if (!isPathInside(rootRealPath, candidateRealPath)) {
    throw new UnsafePathError();
  }

  return candidateRealPath;
}
