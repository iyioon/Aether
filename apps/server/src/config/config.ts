import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertSupportedPasswordHash } from "../auth/password.js";
import { stableId } from "../library/ids.js";
import {
  assertDataDirectoryOutsideMediaRoots,
  initializeDataDirectory,
  resolveDataPaths
} from "./data-directory.js";

export interface MediaRootConfig {
  id: string;
  label: string;
  inputPath: string;
  realPath: string;
}

export interface AppConfig {
  host: string;
  port: number;
  mediaRoots: MediaRootConfig[];
  dataDir: string;
  configDir: string;
  cacheDir: string;
  backupDir: string;
  passwordHash: string | null;
  sessionSecret: string;
  sessionTtlDays: number;
  loginMaxAttempts: number;
  loginWindowMs: number;
  loginLockoutMs: number;
  cookieSecure: boolean;
  sessionCookieName: string;
  csrfCookieName: string;
  trustProxy: boolean;
  webDistDir: string;
  requireWebBuild: boolean;
  watchEnabled: boolean;
  watchDebounceMs: number;
  aiProvider: "disabled" | "ollama";
  ollamaBaseUrl: string;
  ollamaVisionModel: string;
  aiTimeoutMs: number;
}

const EnvSchema = z.object({
  AETHER_HOST: z.string().trim().min(1).default("127.0.0.1"),
  AETHER_PORT: z.coerce.number().int().min(1).max(65_535).default(3030),
  AETHER_MEDIA_ROOTS: z.string().default(""),
  AETHER_DATA_DIR: z.string().trim().min(1).default("./aether-data"),
  AETHER_PASSWORD_HASH: z.string().trim().optional(),
  AETHER_SESSION_SECRET: z.string().trim().optional(),
  AETHER_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  AETHER_LOGIN_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(3)
    .max(100)
    .default(10),
  AETHER_LOGIN_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(15),
  AETHER_LOGIN_LOCKOUT_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(15),
  AETHER_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  AETHER_TRUST_PROXY: z.enum(["true", "false"]).optional(),
  AETHER_WEB_DIST: z.string().trim().optional(),
  AETHER_WATCH_ENABLED: z.enum(["true", "false"]).optional(),
  AETHER_WATCH_DEBOUNCE_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(600_000)
    .default(2000),
  AETHER_AI_PROVIDER: z.enum(["disabled", "ollama"]).default("disabled"),
  AETHER_OLLAMA_BASE_URL: z
    .string()
    .trim()
    .url()
    .default("http://127.0.0.1:11434"),
  AETHER_OLLAMA_VISION_MODEL: z.string().trim().min(1).default("llava:latest"),
  AETHER_AI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .default(45_000),
  NODE_ENV: z.string().optional()
});

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): Promise<AppConfig> {
  const parsed = EnvSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV ?? process.env.NODE_ENV ?? "";
  const passwordHash = parsed.AETHER_PASSWORD_HASH || null;
  const webDistDir = path.resolve(
    cwd,
    parsed.AETHER_WEB_DIST ?? "apps/web/dist"
  );

  if (passwordHash) {
    assertSupportedPasswordHash(passwordHash);
  }

  const sessionSecret =
    parsed.AETHER_SESSION_SECRET ??
    (nodeEnv === "production"
      ? ""
      : "development-only-change-this-session-secret");

  if (nodeEnv === "production" && sessionSecret.length < 32) {
    throw new Error(
      "AETHER_SESSION_SECRET must be set to at least 32 characters in production."
    );
  }

  if (nodeEnv === "production") {
    await assertProductionWebBuild(webDistDir);
  }

  const dataPaths = resolveDataPaths(
    { ...env, AETHER_DATA_DIR: parsed.AETHER_DATA_DIR },
    cwd
  );
  const mediaRoots = await resolveMediaRoots(parsed.AETHER_MEDIA_ROOTS, cwd);
  assertDataDirectoryOutsideMediaRoots(
    dataPaths.dataDir,
    mediaRoots.map((root) => root.realPath)
  );
  await initializeDataDirectory(dataPaths);
  assertDataDirectoryOutsideMediaRoots(
    await realpath(dataPaths.dataDir),
    mediaRoots.map((root) => root.realPath)
  );
  const cookieSecure =
    parseOptionalBoolean(parsed.AETHER_COOKIE_SECURE) ??
    nodeEnv === "production";

  return {
    host: parsed.AETHER_HOST,
    port: parsed.AETHER_PORT,
    mediaRoots,
    dataDir: dataPaths.dataDir,
    configDir: dataPaths.configDir,
    cacheDir: dataPaths.cacheDir,
    backupDir: dataPaths.backupDir,
    passwordHash,
    sessionSecret,
    sessionTtlDays: parsed.AETHER_SESSION_TTL_DAYS,
    loginMaxAttempts: parsed.AETHER_LOGIN_MAX_ATTEMPTS,
    loginWindowMs: parsed.AETHER_LOGIN_WINDOW_MINUTES * 60 * 1000,
    loginLockoutMs: parsed.AETHER_LOGIN_LOCKOUT_MINUTES * 60 * 1000,
    cookieSecure,
    sessionCookieName: cookieSecure
      ? "__Host-aether_session"
      : "aether_session",
    csrfCookieName: cookieSecure ? "__Host-aether_csrf" : "aether_csrf",
    trustProxy: parseOptionalBoolean(parsed.AETHER_TRUST_PROXY) ?? false,
    webDistDir,
    requireWebBuild: nodeEnv === "production",
    watchEnabled:
      parseOptionalBoolean(parsed.AETHER_WATCH_ENABLED) ?? nodeEnv !== "test",
    watchDebounceMs: parsed.AETHER_WATCH_DEBOUNCE_MS,
    aiProvider: parsed.AETHER_AI_PROVIDER,
    ollamaBaseUrl: parsed.AETHER_OLLAMA_BASE_URL.replace(/\/+$/, ""),
    ollamaVisionModel: parsed.AETHER_OLLAMA_VISION_MODEL,
    aiTimeoutMs: parsed.AETHER_AI_TIMEOUT_MS
  };
}

async function assertProductionWebBuild(webDistDir: string): Promise<void> {
  const indexPath = path.join(webDistDir, "index.html");
  const indexStats = await lstat(indexPath).catch(() => null);

  if (!indexStats?.isFile() || indexStats.isSymbolicLink()) {
    throw new Error(
      "The production web build is missing. Build apps/web before starting Aether."
    );
  }
}

function parseOptionalBoolean(
  value: "true" | "false" | undefined
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === "true";
}

async function resolveMediaRoots(
  rootList: string,
  cwd: string
): Promise<MediaRootConfig[]> {
  const configuredRoots = parseConfiguredMediaRoots(rootList);

  const roots: MediaRootConfig[] = [];
  const seenPaths = new Map<string, string | null>();
  const seenKeys = new Set<string>();

  for (const { key, inputPath } of configuredRoots) {
    if (key && seenKeys.has(key)) {
      throw new Error(`Duplicate media root key: ${key}`);
    }

    const absolutePath = path.resolve(cwd, inputPath);
    const rootRealPath = await realpath(absolutePath);
    await access(rootRealPath, constants.R_OK);

    const existingKey = seenPaths.get(rootRealPath);
    if (seenPaths.has(rootRealPath)) {
      if (key || existingKey) {
        throw new Error(
          `Media root path is configured more than once: ${rootRealPath}`
        );
      }

      continue;
    }

    if (key) {
      seenKeys.add(key);
    }
    seenPaths.set(rootRealPath, key);
    roots.push({
      id: key ? stableId("root", "named", key) : stableId("root", rootRealPath),
      label: key ?? (path.basename(rootRealPath) || rootRealPath),
      inputPath,
      realPath: rootRealPath
    });
  }

  return roots;
}

export function resolveConfiguredMediaRootPaths(
  rootList: string,
  cwd: string
): string[] {
  return parseConfiguredMediaRoots(rootList).map(({ inputPath }) =>
    path.resolve(cwd, inputPath)
  );
}

interface ParsedMediaRootEntry {
  key: string | null;
  inputPath: string;
}

const MEDIA_ROOT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseConfiguredMediaRoots(rootList: string): ParsedMediaRootEntry[] {
  return splitEscapedCommaList(rootList)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseMediaRootEntry);
}

function parseMediaRootEntry(entry: string): ParsedMediaRootEntry {
  const separatorIndex = entry.indexOf("=");
  if (separatorIndex < 0) {
    return { key: null, inputPath: entry };
  }

  const possibleKey = entry.slice(0, separatorIndex).trim();
  if (!MEDIA_ROOT_KEY_PATTERN.test(possibleKey)) {
    return { key: null, inputPath: entry };
  }

  const inputPath = entry.slice(separatorIndex + 1).trim();
  if (!inputPath) {
    throw new Error(`Media root key "${possibleKey}" must include a path.`);
  }

  return { key: possibleKey, inputPath };
}

function splitEscapedCommaList(value: string): string[] {
  const entries: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];

    if (character === "\\" && nextCharacter === ",") {
      current += ",";
      index += 1;
      continue;
    }

    if (character === ",") {
      entries.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  entries.push(current);
  return entries;
}
