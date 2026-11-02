import { createHash } from "node:crypto";

export function sourceVersion(id: string, revision: number): string {
  return createHash("sha256").update(`${id}:${revision}`).digest("base64url");
}
