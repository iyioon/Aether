import { createReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  clearLoginAttempts,
  getLoginThrottleState,
  loginAttemptKey,
  pruneLoginAttempts,
  recordFailedLogin,
  type LoginThrottlePolicy,
  type LoginThrottleState
} from "../auth/login-attempts.js";
import { z } from "zod";
import { verifyPasswordHash } from "../auth/password.js";
import {
  createSession,
  deleteExpiredSessions,
  deleteSessions,
  ensureSessionCookieMode,
  findSession,
  CSRF_COOKIE_NAMES,
  SESSION_COOKIE_NAMES,
  verifyCsrfToken
} from "../auth/sessions.js";
import type { AppConfig } from "../config/config.js";
import { checkpointDatabase, type AetherDatabase } from "../db/database.js";
import { sweepDerivativeCache } from "../library/derivative-cache.js";
import { registerLibraryRoutes } from "../library/routes.js";
import { LibraryScanner } from "../library/scanner.js";
import { LibraryWatcher } from "../library/watcher.js";
import { isPathInside } from "../security/path-safety.js";

interface BuildAppOptions {
  config: AppConfig;
  db: AetherDatabase;
  logger?: boolean;
}

const LoginBody = z.object({
  password: z.string().min(1).max(1024)
});

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isBadUrlError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_BAD_URL"
  );
}

export async function buildApp({
  config,
  db,
  logger = true
}: BuildAppOptions): Promise<FastifyInstance> {
  const loginThrottlePolicy: LoginThrottlePolicy = {
    maxFailures: config.loginMaxAttempts,
    windowMs: config.loginWindowMs,
    lockoutMs: config.loginLockoutMs
  };
  const app = Fastify({
    bodyLimit: 1_048_576,
    frameworkErrors: (error, _request, reply) => {
      const frameworkReply = reply as FastifyReply;

      if (isBadUrlError(error)) {
        frameworkReply.code(400).send({ error: "invalid_request" });
        return;
      }

      frameworkReply.send(error);
    },
    logger: logger
      ? {
          serializers: {
            req(request) {
              return {
                method: request.method,
                url: requestPathOnly(request.url)
              };
            },
            err(error) {
              return errorLogSummary(error);
            }
          }
        }
      : false,
    trustProxy: config.trustProxy
  });

  try {
    await app.register(helmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "base-uri": ["'self'"],
          "connect-src": ["'self'"],
          "default-src": ["'self'"],
          "font-src": ["'self'", "data:"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "img-src": ["'self'", "data:", "blob:"],
          "media-src": ["'self'", "blob:"],
          "object-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"]
        }
      },
      frameguard: {
        action: "deny"
      }
    });
    await app.register(cookie, {
      secret: config.sessionSecret
    });
    await app.register(rateLimit, {
      global: false
    });
    ensureSessionCookieMode(db, config.cookieSecure);

    app.addHook("onSend", async (request, reply, payload) => {
      if (
        request.url.startsWith("/api/") &&
        !reply.getHeader("cache-control")
      ) {
        reply.header("cache-control", "no-store");
      }

      return payload;
    });

    app.addHook("onRequest", async (request, reply) => {
      if (isPublicRoute(request)) {
        return;
      }

      if (!config.passwordHash) {
        return reply.code(503).send({ error: "password_not_configured" });
      }

      const session = authenticatedSession(request, config, db);

      if (!session) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      request.authSession = session;

      if (unsafeMethods.has(request.method)) {
        const csrfHeader = request.headers["x-csrf-token"];
        const csrfToken = Array.isArray(csrfHeader)
          ? csrfHeader[0]
          : csrfHeader;

        if (!verifyCsrfToken(db, session.id, csrfToken)) {
          return reply.code(403).send({ error: "csrf_required" });
        }
      }
    });

    app.get("/api/health", async (_request, reply) => {
      if (!config.passwordHash) {
        return reply
          .code(503)
          .send({ status: "not_ready", reason: "password_not_configured" });
      }

      return { status: "ok" };
    });

    app.post(
      "/api/auth/login",
      {
        config: {
          rateLimit: {
            max: Math.max(config.loginMaxAttempts, 10),
            timeWindow: config.loginWindowMs
          }
        }
      },
      async (request, reply) => {
        const body = LoginBody.safeParse(request.body);

        if (!body.success) {
          return reply.code(400).send({ error: "invalid_request" });
        }

        if (!config.passwordHash) {
          return reply.code(503).send({ error: "password_not_configured" });
        }

        const throttleKey = loginAttemptKey(request.ip, config.sessionSecret);
        pruneLoginAttempts(db, loginThrottlePolicy);
        const throttleState = getLoginThrottleState(
          db,
          throttleKey,
          loginThrottlePolicy
        );

        if (throttleState.locked) {
          return sendLoginLockout(reply, throttleState);
        }

        const passwordMatches = await verifyPasswordHash(
          config.passwordHash,
          body.data.password
        );

        if (!passwordMatches) {
          const failureState = recordFailedLogin(
            db,
            throttleKey,
            loginThrottlePolicy
          );

          if (failureState.locked) {
            return sendLoginLockout(reply, failureState);
          }

          return reply.code(401).send({ error: "invalid_credentials" });
        }

        clearLoginAttempts(db, throttleKey);
        deleteExpiredSessions(db);
        deleteSessions(db, verifiedSessionTokens(request, config));
        const session = createSession(db, config.sessionTtlDays);
        setSessionCookies(
          reply,
          config,
          session.sessionToken,
          session.csrfToken
        );

        return {
          authenticated: true,
          expiresAt: session.expiresAt.toISOString()
        };
      }
    );

    app.get("/api/auth/me", async (request) => ({
      authenticated: true,
      expiresAt: request.authSession?.expiresAt ?? null
    }));

    app.post("/api/auth/logout", async (request, reply) => {
      deleteSessions(db, verifiedSessionTokens(request, config));
      clearSessionCookies(reply);
      return { authenticated: false };
    });

    const cacheCleanup = await sweepDerivativeCache(db, config.cacheDir, {
      pruneStaleFiles: true
    });
    if (cacheCleanup.removedEntries > 0) {
      app.log.info(
        { removedEntries: cacheCleanup.removedEntries },
        "obsolete derivative cache entries removed"
      );
    }

    const scanner = new LibraryScanner(db, config.mediaRoots, config.cacheDir);
    const watcher = config.watchEnabled
      ? new LibraryWatcher({
          roots: config.mediaRoots,
          scanner,
          debounceMs: config.watchDebounceMs,
          logger: app.log
        })
      : null;

    app.addHook("onClose", async () => {
      await watcher?.stop();
      await scanner.stop();
      checkpointDatabase(db);
    });

    if (watcher) {
      try {
        await watcher.start();
      } catch {
        app.log.warn("media watcher failed to start");
      }
    }

    await registerLibraryRoutes(app, config, db, scanner, watcher);
    await registerStaticWeb(app, config);

    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error instanceof Error
      ? error
      : new Error("Application setup failed", { cause: error });
  }
}

function isPublicRoute(request: FastifyRequest): boolean {
  if (!request.url.startsWith("/api/")) {
    return true;
  }

  return (
    (request.method === "GET" && request.url === "/api/health") ||
    request.url === "/api/auth/login"
  );
}

function setSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  sessionToken: string,
  csrfToken: string
): void {
  clearSessionCookies(reply);
  const maxAge = config.sessionTtlDays * 24 * 60 * 60;
  const common = {
    path: "/",
    secure: config.cookieSecure,
    sameSite: "strict" as const,
    maxAge
  };

  reply.setCookie(config.sessionCookieName, sessionToken, {
    ...common,
    httpOnly: true,
    signed: true
  });
  reply.setCookie(config.csrfCookieName, csrfToken, {
    ...common,
    httpOnly: false
  });
}

function authenticatedSession(
  request: FastifyRequest,
  config: AppConfig,
  db: AetherDatabase
): ReturnType<typeof findSession> {
  for (const token of verifiedSessionTokens(request, config)) {
    const session = findSession(db, token);
    if (session) {
      return session;
    }
  }

  return null;
}

function verifiedSessionTokens(
  request: FastifyRequest,
  config: AppConfig
): string[] {
  const names = [
    config.sessionCookieName,
    ...SESSION_COOKIE_NAMES.filter((name) => name !== config.sessionCookieName)
  ];
  const tokens = new Set<string>();

  for (const name of names) {
    const signedToken = request.cookies[name];
    if (!signedToken) {
      continue;
    }

    try {
      const result = request.unsignCookie(signedToken);
      if (result.valid && typeof result.value === "string") {
        tokens.add(result.value);
      }
    } catch {
      // A malformed or tampered cookie must never block a second valid cookie
      // from being considered during an HTTP/HTTPS transition.
    }
  }

  return [...tokens];
}

function clearSessionCookies(reply: FastifyReply): void {
  for (const name of SESSION_COOKIE_NAMES) {
    reply.clearCookie(name, {
      ...cookieAttributes(name),
      httpOnly: true
    });
  }
  for (const name of CSRF_COOKIE_NAMES) {
    reply.clearCookie(name, {
      ...cookieAttributes(name),
      httpOnly: false
    });
  }
}

function cookieAttributes(name: string): {
  path: "/";
  secure: boolean;
  sameSite: "strict";
} {
  return {
    path: "/",
    secure: name.startsWith("__Host-"),
    sameSite: "strict"
  };
}

function sendLoginLockout(
  reply: FastifyReply,
  state: LoginThrottleState
): FastifyReply {
  if (state.retryAfterSeconds !== null) {
    reply.header("retry-after", String(state.retryAfterSeconds));
  }

  return reply.code(429).send({
    error: "too_many_login_attempts",
    lockedUntil: state.lockedUntil?.toISOString() ?? null
  });
}

async function registerStaticWeb(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const indexPath = path.join(config.webDistDir, "index.html");
  const indexStats = await lstat(indexPath).catch(() => null);

  if (!indexStats?.isFile() || indexStats.isSymbolicLink()) {
    if (config.requireWebBuild) {
      throw new Error("The production web build is missing.");
    }
    return;
  }

  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not_found" });
    }

    const requestedPath = getStaticRequestPath(request.url);

    if (!requestedPath) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const assetPath = resolveStaticAssetPath(config.webDistDir, requestedPath);

    if (assetPath) {
      const assetStat = await stat(assetPath).catch(() => null);

      if (assetStat?.isFile()) {
        reply.header("cache-control", cacheControlFor(requestedPath));
        reply.type(contentTypeFor(assetPath));
        return reply.send(createReadStream(assetPath));
      }
    }

    if (path.extname(requestedPath)) {
      return reply.code(404).send({ error: "not_found" });
    }

    reply.header("cache-control", "no-cache");
    reply.type("text/html; charset=utf-8");
    return reply.send(createReadStream(indexPath));
  });
}

function getStaticRequestPath(url: string): string | null {
  try {
    const parsed = new URL(url, "http://aether.local");
    const decoded = decodeURIComponent(parsed.pathname);
    return decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function requestPathOnly(url: string | undefined): string {
  if (!url) {
    return "/";
  }

  const queryIndex = url.indexOf("?");
  const fragmentIndex = url.indexOf("#");
  const end = Math.min(
    queryIndex === -1 ? url.length : queryIndex,
    fragmentIndex === -1 ? url.length : fragmentIndex
  );
  return url.slice(0, end);
}

function errorLogSummary(error: unknown): {
  type: string;
  message: string;
  stack: string;
  code?: string;
} {
  if (typeof error !== "object" || error === null) {
    return { type: "Error", message: "Request failed.", stack: "" };
  }

  const rawType = "name" in error ? error.name : null;
  const type =
    typeof rawType === "string" && /^[A-Za-z0-9_.-]+$/.test(rawType)
      ? rawType
      : "Error";
  const rawCode = "code" in error ? error.code : null;
  const code =
    typeof rawCode === "string" && /^[A-Z0-9_]+$/.test(rawCode)
      ? rawCode
      : null;

  const summary = { type, message: "Request failed.", stack: "" };
  return code ? { ...summary, code } : summary;
}

function resolveStaticAssetPath(
  webDistDir: string,
  requestedPath: string
): string | null {
  if (requestedPath.includes("\0")) {
    return null;
  }

  const resolvedPath = path.resolve(webDistDir, requestedPath);
  return isPathInside(webDistDir, resolvedPath) ? resolvedPath : null;
}

function cacheControlFor(requestedPath: string): string {
  return requestedPath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".woff2":
      return "font/woff2";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
