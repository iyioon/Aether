import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { resolveDataPaths } from "./data-directory.js";

export function loadLocalEnv(startDir = process.cwd()): string {
  const rootDir = loadProjectEnv(startDir);
  const dataDir = resolveDataPaths(process.env, rootDir).dataDir;
  loadPrivateEnv(rootDir);
  if (resolveDataPaths(process.env, rootDir).dataDir !== dataDir) {
    throw new Error(
      "AETHER_DATA_DIR cannot be changed from inside private.env."
    );
  }
  return rootDir;
}

export function loadProjectEnv(startDir = process.cwd()): string {
  const rootDir = findAetherRoot(startDir);
  const dirs = rootDir === startDir ? [rootDir] : [rootDir, startDir];
  const inheritedKeys = new Set(Object.keys(process.env));

  for (const dir of dirs) {
    loadEnvFileIfPresent(path.join(dir, ".env"), true, inheritedKeys);
    loadEnvFileIfPresent(path.join(dir, ".env.local"), true, inheritedKeys);
  }

  return rootDir;
}

export function loadPrivateEnv(rootDir: string): void {
  const dataPaths = resolveDataPaths(process.env, rootDir);
  if (existsSync(dataPaths.dataDir)) {
    const dataStats = lstatSync(dataPaths.dataDir);
    if (!dataStats.isDirectory() || dataStats.isSymbolicLink()) {
      throw new Error(
        `AETHER_DATA_DIR must be a real directory, not a symbolic link: ${dataPaths.dataDir}`
      );
    }
  }
  loadEnvFileIfPresent(dataPaths.privateEnvPath, false);
}

function findAetherRoot(startDir: string): string {
  let current = path.resolve(startDir);

  while (true) {
    if (isWorkspaceRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }

    current = parent;
  }
}

function isWorkspaceRoot(directory: string): boolean {
  return (
    existsSync(path.join(directory, "package.json")) &&
    existsSync(path.join(directory, "apps", "server", "package.json")) &&
    existsSync(path.join(directory, "apps", "web", "package.json"))
  );
}

function loadEnvFileIfPresent(
  filePath: string,
  allowSymlink = true,
  protectedKeys?: ReadonlySet<string>
): void {
  if (!existsSync(filePath)) {
    return;
  }

  if (!allowSymlink) {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new Error(
        `Aether's private environment file must be a private real file: ${filePath}`
      );
    }
  }

  if (!protectedKeys) {
    process.loadEnvFile(filePath);
    return;
  }

  const values = parseEnv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (!protectedKeys.has(key)) {
      process.env[key] = value;
    }
  }
}
