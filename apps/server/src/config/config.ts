import { constants } from "node:fs";
import { access, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { stableId } from "../library/ids.js";

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
  configDir: string;
  cacheDir: string;
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
  AETHER_CONFIG_DIR: z.string().trim().min(1).default("./config"),
  AETHER_CACHE_DIR: z.string().trim().min(1).default("./cache"),
  AETHER_PASSWORD_HASH: z.string().trim().optional(),
  AETHER_SESSION_SECRET: z.string().trim().optional(),
  AETHER_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  AETHER_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(100).default(10),
  AETHER_LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AETHER_LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
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
  AETHER_OLLAMA_BASE_URL: z.string().trim().url().default("http://127.0.0.1:11434"),
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
  const configDir = path.resolve(cwd, parsed.AETHER_CONFIG_DIR);
  const cacheDir = path.resolve(cwd, parsed.AETHER_CACHE_DIR);

  await mkdir(configDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const mediaRoots = await resolveMediaRoots(parsed.AETHER_MEDIA_ROOTS, cwd);
  const cookieSecure =
    parseOptionalBoolean(parsed.AETHER_COOKIE_SECURE) ??
    (nodeEnv === "production");

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

  return {
    host: parsed.AETHER_HOST,
    port: parsed.AETHER_PORT,
    mediaRoots,
    configDir,
    cacheDir,
    passwordHash: parsed.AETHER_PASSWORD_HASH || null,
    sessionSecret,
    sessionTtlDays: parsed.AETHER_SESSION_TTL_DAYS,
    loginMaxAttempts: parsed.AETHER_LOGIN_MAX_ATTEMPTS,
    loginWindowMs: parsed.AETHER_LOGIN_WINDOW_MINUTES * 60 * 1000,
    loginLockoutMs: parsed.AETHER_LOGIN_LOCKOUT_MINUTES * 60 * 1000,
    cookieSecure,
    sessionCookieName: cookieSecure ? "__Host-aether_session" : "aether_session",
    csrfCookieName: cookieSecure ? "__Host-aether_csrf" : "aether_csrf",
    trustProxy: parseOptionalBoolean(parsed.AETHER_TRUST_PROXY) ?? false,
    webDistDir: path.resolve(
      cwd,
      parsed.AETHER_WEB_DIST ?? "apps/web/dist"
    ),
    watchEnabled:
      parseOptionalBoolean(parsed.AETHER_WATCH_ENABLED) ?? nodeEnv !== "test",
    watchDebounceMs: parsed.AETHER_WATCH_DEBOUNCE_MS,
    aiProvider: parsed.AETHER_AI_PROVIDER,
    ollamaBaseUrl: parsed.AETHER_OLLAMA_BASE_URL.replace(/\/+$/, ""),
    ollamaVisionModel: parsed.AETHER_OLLAMA_VISION_MODEL,
    aiTimeoutMs: parsed.AETHER_AI_TIMEOUT_MS
  };
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
  const inputRoots = splitEscapedCommaList(rootList)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const roots: MediaRootConfig[] = [];
  const seen = new Set<string>();

  for (const inputPath of inputRoots) {
    const absolutePath = path.resolve(cwd, inputPath);
    const rootRealPath = await realpath(absolutePath);
    await access(rootRealPath, constants.R_OK);

    if (seen.has(rootRealPath)) {
      continue;
    }

    seen.add(rootRealPath);
    roots.push({
      id: stableId("root", rootRealPath),
      label: path.basename(rootRealPath) || rootRealPath,
      inputPath,
      realPath: rootRealPath
    });
  }

  return roots;
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
