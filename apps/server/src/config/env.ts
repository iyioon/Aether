import { existsSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv(startDir = process.cwd()): string {
  const rootDir = findAetherRoot(startDir);
  const dirs = rootDir === startDir ? [rootDir] : [rootDir, startDir];

  for (const dir of dirs) {
    loadEnvFileIfPresent(path.join(dir, ".env"));
    loadEnvFileIfPresent(path.join(dir, ".env.local"));
  }

  return rootDir;
}

function findAetherRoot(startDir: string): string {
  let current = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(current, "docs", "IMPLEMENTATION_PLAN.md"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }

    current = parent;
  }
}

function loadEnvFileIfPresent(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  process.loadEnvFile(filePath);
}
