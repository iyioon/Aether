import { createHash } from "node:crypto";

export function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 24);

  return `${prefix}_${hash}`;
}
