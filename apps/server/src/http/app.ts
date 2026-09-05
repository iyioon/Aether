import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
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
  deleteSession,
  findSession,
  verifyCsrfToken
} from "../auth/sessions.js";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
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
    logger,
    trustProxy: config.trustProxy
  });

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

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/") && !reply.getHeader("cache-control")) {
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

    const sessionToken = request.cookies[config.sessionCookieName];
    const session = findSession(db, sessionToken);

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

  app.get("/api/health", async () => ({ status: "ok" }));

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
      const session = createSession(db, config.sessionTtlDays);
      setSessionCookies(reply, config, session.sessionToken, session.csrfToken);

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
    deleteSession(db, request.cookies[config.sessionCookieName]);
    clearSessionCookies(reply, config);
    return { authenticated: false };
  });

  const scanner = new LibraryScanner(db, config.mediaRoots);
  const watcher = config.watchEnabled
    ? new LibraryWatcher({
        roots: config.mediaRoots,
        scanner,
        debounceMs: config.watchDebounceMs,
        logger: app.log
      })
    : null;

  if (watcher) {
    app.addHook("onClose", async () => {
      await watcher.stop();
    });

    watcher.start().catch((error: unknown) => {
      app.log.warn({ err: error }, "media watcher failed to start");
    });
  }

  await registerLibraryRoutes(app, config, db, scanner, watcher);
  await registerStaticWeb(app, config);

  return app;
}

function isPublicRoute(request: FastifyRequest): boolean {
  if (!request.url.startsWith("/api/")) {
    return true;
  }

  return (
    request.method === "GET" && request.url === "/api/health"
  ) || request.url === "/api/auth/login";
}

function setSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  sessionToken: string,
  csrfToken: string
): void {
  const maxAge = config.sessionTtlDays * 24 * 60 * 60;
  const common = {
    path: "/",
    secure: config.cookieSecure,
    sameSite: "strict" as const,
    maxAge
  };

  reply.setCookie(config.sessionCookieName, sessionToken, {
    ...common,
    httpOnly: true
  });
  reply.setCookie(config.csrfCookieName, csrfToken, {
    ...common,
    httpOnly: false
  });
}

function clearSessionCookies(reply: FastifyReply, config: AppConfig): void {
  const common = {
    path: "/",
    secure: config.cookieSecure,
    sameSite: "strict" as const
  };

  reply.clearCookie(config.sessionCookieName, common);
  reply.clearCookie(config.csrfCookieName, common);
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

  if (!existsSync(indexPath)) {
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
        reply.header("cache-control", cacheControlFor(assetPath));
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

function cacheControlFor(filePath: string): string {
  return path.basename(filePath) === "index.html"
    ? "no-cache"
    : "public, max-age=31536000, immutable";
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
