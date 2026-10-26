import { link, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { createSession } from "../src/auth/sessions.js";
import { recordFailedLogin } from "../src/auth/login-attempts.js";

describe("app security foundation", () => {
  let app: FastifyInstance;
  let db: AetherDatabase;
  let configuredRootId: string;
  let configuredCwd: string;
  let configuredConfig: Awaited<ReturnType<typeof loadConfig>>;

  beforeEach(async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-app-"));
    configuredCwd = cwd;
    await mkdir(path.join(cwd, "media"));
    const passwordHash = await hashPassword("correct horse battery staple");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: passwordHash,
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );
    configuredConfig = config;

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
    configuredRootId = config.mediaRoots[0]?.id ?? "";
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.useRealTimers();
    await rm(configuredCwd, { recursive: true, force: true });
  });

  it("keeps health public and protects library routes", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);

    const tree = await app.inject({ method: "GET", url: "/api/tree" });
    expect(tree.statusCode).toBe(401);
  });

  it("sets baseline browser security headers and avoids API caching", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });

    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.headers["content-security-policy"]).toContain(
      "default-src 'self'"
    );
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["x-frame-options"]).toBe("DENY");
  });

  it("prunes expired authentication history on startup and while idle", async () => {
    await app.close();
    const expired = createSession(db, 1);
    const active = createSession(db, 1);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      "2000-01-01T00:00:00.000Z",
      expired.id
    );
    recordFailedLogin(
      db,
      "stale-address-hash",
      { maxFailures: 5, windowMs: 60_000, lockoutMs: 60_000 },
      new Date("2000-01-01")
    );
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    app = await buildApp({ config: configuredConfig, db, logger: false });
    expect(
      db.prepare("SELECT id FROM sessions WHERE id = ?").get(expired.id)
    ).toBeUndefined();
    expect(db.prepare("SELECT key FROM login_attempts").all()).toHaveLength(0);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      new Date(Date.now() + 1000).toISOString(),
      active.id
    );
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(db.prepare("SELECT id FROM sessions").all()).toHaveLength(0);
    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never exposes private files through public web symlinks", async () => {
    await app.close();
    const webDistDir = path.join(configuredCwd, "web-dist");
    await mkdir(path.join(webDistDir, "assets"), { recursive: true });
    await writeFile(path.join(webDistDir, "index.html"), "<main>Aether</main>");
    await writeFile(
      path.join(configuredConfig.configDir, "secret.txt"),
      "private-value"
    );
    await symlink(
      path.join(configuredConfig.configDir, "secret.txt"),
      path.join(webDistDir, "assets", "leak.txt")
    );
    await symlink(configuredConfig.configDir, path.join(webDistDir, "private"));
    app = await buildApp({
      config: { ...configuredConfig, webDistDir },
      db,
      logger: false
    });
    await link(
      path.join(configuredConfig.configDir, "secret.txt"),
      path.join(webDistDir, "assets", "linked.txt")
    );
    for (const url of [
      "/assets/leak.txt",
      "/assets/linked.txt",
      "/private/secret.txt",
      "/%61pi/tree",
      "/api%2Ftree"
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.body).not.toContain("private-value");
      expect(response.body).not.toContain(configuredCwd);
      if (
        url.includes("secret.txt") ||
        url.includes("leak.txt") ||
        url.includes("linked.txt")
      )
        expect(response.statusCode).toBe(404);
    }
    await rm(path.join(webDistDir, "index.html"));
    await symlink(
      path.join(configuredConfig.configDir, "secret.txt"),
      path.join(webDistDir, "index.html")
    );
    const replacedIndex = await app.inject({ method: "GET", url: "/" });
    expect(replacedIndex.statusCode).toBe(404);
    expect(replacedIndex.body).not.toContain("private-value");
  });

  it("keeps the login endpoint rate-limited", async () => {
    let response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {}
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {}
      });
    }

    expect(response.statusCode).toBe(429);
  });

  it("does not rate-limit authenticated media browsing", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    if (!sessionCookie) {
      throw new Error("Expected a session cookie.");
    }

    const cookies = {
      aether_session: sessionCookie.value
    };

    for (let requestIndex = 0; requestIndex < 225; requestIndex += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies
      });

      expect(response.statusCode).toBe(200);
    }
  });

  it("throttles session activity writes across frequent requests", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    if (!sessionCookie) {
      throw new Error("Expected a session cookie.");
    }

    const session = db.prepare("SELECT id FROM sessions LIMIT 1").get() as {
      id: string;
    };
    const recent = new Date().toISOString();
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
      recent,
      session.id
    );

    const recentRequest = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { aether_session: sessionCookie.value }
    });
    expect(recentRequest.statusCode).toBe(200);
    expect(sessionLastSeenAt(session.id)).toBe(recent);

    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
      stale,
      session.id
    );

    const staleRequest = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { aether_session: sessionCookie.value }
    });
    expect(staleRequest.statusCode).toBe(200);
    expect(Date.parse(sessionLastSeenAt(session.id))).toBeGreaterThan(
      Date.parse(stale)
    );
  });

  it("normalizes asset sort fields and direction query parameters", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    if (!sessionCookie) {
      throw new Error("Expected a session cookie.");
    }

    const cookies = {
      aether_session: sessionCookie.value
    };
    const tree = await app.inject({
      method: "GET",
      url: "/api/tree",
      cookies
    });
    const rootFolderId = (tree.json() as { roots: Array<{ folderId: string }> })
      .roots[0]?.folderId;

    if (!rootFolderId) {
      throw new Error("Expected a root folder id.");
    }

    const defaultFilename = await app.inject({
      method: "GET",
      url: `/api/folders/${rootFolderId}/assets?sort=filename`,
      cookies
    });
    const ascendingDate = await app.inject({
      method: "GET",
      url: `/api/folders/${rootFolderId}/assets?sort=date&order=asc`,
      cookies
    });
    const legacyOldest = await app.inject({
      method: "GET",
      url: `/api/folders/${rootFolderId}/assets?sort=oldest`,
      cookies
    });

    expect(defaultFilename.statusCode).toBe(200);
    expect(defaultFilename.json()).toMatchObject({
      sort: "filename",
      order: "asc"
    });
    expect(ascendingDate.statusCode).toBe(200);
    expect(ascendingDate.json()).toMatchObject({
      sort: "date",
      order: "asc"
    });
    expect(legacyOldest.statusCode).toBe(200);
    expect(legacyOldest.json()).toMatchObject({
      sort: "date",
      order: "asc"
    });
  });

  it("publishes sanitized settings for authenticated sessions", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/admin/settings"
    });
    expect(anonymous.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    const settings = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
      cookies: {
        aether_session: sessionCookie?.value ?? ""
      }
    });

    expect(settings.statusCode).toBe(200);
    const body = settings.json();

    expect(body).toMatchObject({
      library: {
        mediaRootCount: 1,
        mediaRoots: [{ id: configuredRootId, label: "media" }],
        watchEnabled: false,
        watchDebounceMs: 2000
      },
      security: {
        passwordConfigured: true,
        cookieSecure: false,
        trustProxy: false,
        sessionTtlDays: 14,
        loginMaxAttempts: 10,
        loginWindowMinutes: 15,
        loginLockoutMinutes: 15
      },
      ai: {
        enabled: false,
        provider: "disabled",
        model: null,
        timeoutMs: 45000
      }
    });
    expect(Object.keys(body.library.mediaRoots[0])).toEqual(["id", "label"]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("test-session-secret");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("sessionSecret");
    expect(serialized).not.toContain("realPath");
    expect(serialized).not.toContain(configuredCwd);
  });

  it("logs in, sets secure session boundaries, and serves protected placeholders", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });

    expect(login.statusCode).toBe(200);
    const cookies = login.cookies;
    const sessionCookie = cookies.find(
      (entry) => entry.name === "aether_session"
    );
    const csrfCookie = cookies.find((entry) => entry.name === "aether_csrf");

    expect(sessionCookie?.httpOnly).toBe(true);
    expect(csrfCookie?.httpOnly).not.toBe(true);

    const tree = await app.inject({
      method: "GET",
      url: "/api/tree",
      cookies: {
        aether_session: sessionCookie?.value ?? ""
      }
    });

    expect(tree.statusCode).toBe(200);
    expect(tree.json()).toMatchObject({
      roots: [{ id: configuredRootId, label: "media" }],
      folders: []
    });

    const watch = await app.inject({
      method: "GET",
      url: "/api/admin/watch",
      cookies: {
        aether_session: sessionCookie?.value ?? ""
      }
    });

    expect(watch.statusCode).toBe(200);
    expect(watch.json()).toMatchObject({
      enabled: false,
      watchedDirectories: 0
    });
  });

  it("rejects a tampered signed session cookie", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    if (!sessionCookie) {
      throw new Error("Expected a session cookie.");
    }

    const finalCharacter = sessionCookie.value.at(-1);
    const tamperedValue = `${sessionCookie.value.slice(0, -1)}${
      finalCharacter === "a" ? "b" : "a"
    }`;
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { aether_session: tamperedValue }
    });

    expect(response.statusCode).toBe(401);
  });

  it("falls back to the other cookie variant when one signed cookie is tampered", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct horse battery staple" }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );
    if (!sessionCookie) {
      throw new Error("Expected a session cookie.");
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: {
        aether_session: `${sessionCookie.value}tampered`,
        "__Host-aether_session": sessionCookie.value
      }
    });

    expect(response.statusCode).toBe(200);
  });

  it("revokes every received valid session when logging in again", async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "correct horse battery staple" }
      }),
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "correct horse battery staple" }
      })
    ]);
    const firstSession = first.cookies.find(
      (entry) => entry.name === "aether_session"
    );
    const secondSession = second.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    const replacement = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      cookies: {
        aether_session: firstSession?.value ?? "",
        "__Host-aether_session": secondSession?.value ?? ""
      },
      payload: { password: "correct horse battery staple" }
    });

    expect(replacement.statusCode).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
      count: 1
    });
  });

  it("revokes both cookie variants on logout and clears all auth cookies", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct horse battery staple" }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct horse battery staple" }
    });
    const firstSession = first.cookies.find(
      (entry) => entry.name === "aether_session"
    );
    const firstCsrf = first.cookies.find(
      (entry) => entry.name === "aether_csrf"
    );
    const secondSession = second.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: {
        aether_session: firstSession?.value ?? "",
        "__Host-aether_session": secondSession?.value ?? ""
      },
      headers: { "x-csrf-token": firstCsrf?.value ?? "" }
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.headers["clear-site-data"]).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
      count: 0
    });
    for (const cookieName of [
      "aether_session",
      "__Host-aether_session",
      "aether_csrf",
      "__Host-aether_csrf"
    ]) {
      const cleared = logout.cookies.find((entry) => entry.name === cookieName);
      expect(cleared).toMatchObject({ value: "", maxAge: 0, path: "/" });
      expect(Boolean(cleared?.secure)).toBe(cookieName.startsWith("__Host-"));
    }
  });

  it("asks secure browsers to clear cached media on logout without clearing preferences", async () => {
    await app.close();
    app = await buildApp({
      config: {
        ...configuredConfig,
        cookieSecure: true,
        sessionCookieName: "__Host-aether_session",
        csrfCookieName: "__Host-aether_csrf"
      },
      db,
      logger: false
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct horse battery staple" }
    });
    const session = login.cookies.find(
      (entry) => entry.name === "__Host-aether_session"
    )!;
    const csrf = login.cookies.find(
      (entry) => entry.name === "__Host-aether_csrf"
    )!;
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { [session.name]: session.value },
      headers: { "x-csrf-token": csrf.value }
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["clear-site-data"]).toBe('"cache"');
    expect(logout.headers["cache-control"]).toBe("no-store");
  });

  it("invalidates all sessions whenever secure cookie mode changes", async () => {
    const insecureLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct horse battery staple" }
    });
    const insecureSession = insecureLogin.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    await app.close();
    app = await buildApp({
      config: {
        ...configuredConfig,
        cookieSecure: true,
        sessionCookieName: "__Host-aether_session",
        csrfCookieName: "__Host-aether_csrf"
      },
      db,
      logger: false
    });

    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
      count: 0
    });
    const staleInsecure = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { aether_session: insecureSession?.value ?? "" }
    });
    expect(staleInsecure.statusCode).toBe(401);

    const secureLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct horse battery staple" }
    });
    const secureSession = secureLogin.cookies.find(
      (entry) => entry.name === "__Host-aether_session"
    );
    expect(secureSession?.secure).toBe(true);

    await app.close();
    app = await buildApp({ config: configuredConfig, db, logger: false });

    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
      count: 0
    });
    const staleSecure = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "__Host-aether_session": secureSession?.value ?? "" }
    });
    expect(staleSecure.statusCode).toBe(401);
  });

  it("invalidates existing session cookies when the signing secret rotates", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    if (!sessionCookie) {
      throw new Error("Expected a session cookie.");
    }

    await app.close();
    app = await buildApp({
      config: {
        ...configuredConfig,
        sessionSecret: "rotated-test-session-secret-that-is-long-enough"
      },
      db,
      logger: false
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { aether_session: sessionCookie.value }
    });

    expect(response.statusCode).toBe(401);
  });

  it("requires CSRF tokens for authenticated mutation routes", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );

    const scan = await app.inject({
      method: "POST",
      url: "/api/admin/scan",
      cookies: {
        aether_session: sessionCookie?.value ?? ""
      }
    });

    expect(scan.statusCode).toBe(403);
  });

  it("starts a scan with a valid CSRF token", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });
    const sessionCookie = login.cookies.find(
      (entry) => entry.name === "aether_session"
    );
    const csrfCookie = login.cookies.find(
      (entry) => entry.name === "aether_csrf"
    );

    const scan = await app.inject({
      method: "POST",
      url: "/api/admin/scan",
      cookies: {
        aether_session: sessionCookie?.value ?? ""
      },
      headers: {
        "x-csrf-token": csrfCookie?.value ?? ""
      }
    });

    expect(scan.statusCode).toBe(202);
    expect(scan.json()).toMatchObject({ status: "running" });
    expect(scan.json().jobId).toMatch(/^job_/);
  });

  it("persists login lockouts across app restarts", async () => {
    await app.close();
    db.close();

    const cwd = await mkdtemp(path.join(tmpdir(), "aether-login-lockout-"));
    await mkdir(path.join(cwd, "media"));
    const passwordHash = await hashPassword("correct horse battery staple");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: passwordHash,
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough",
        AETHER_LOGIN_MAX_ATTEMPTS: "3",
        AETHER_LOGIN_WINDOW_MINUTES: "15",
        AETHER_LOGIN_LOCKOUT_MINUTES: "15"
      },
      cwd
    );

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          password: "wrong password"
        }
      });

      expect(failed.statusCode).toBe(401);
      expect(failed.json()).toEqual({ error: "invalid_credentials" });
    }

    const locked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "wrong password"
      }
    });

    expect(locked.statusCode).toBe(429);
    expect(locked.headers["retry-after"]).toBeDefined();
    expect(locked.json()).toMatchObject({
      error: "too_many_login_attempts"
    });

    await app.close();
    app = await buildApp({ config, db, logger: false });

    const stillLocked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "correct horse battery staple"
      }
    });

    expect(stillLocked.statusCode).toBe(429);
    expect(stillLocked.json()).toMatchObject({
      error: "too_many_login_attempts"
    });
  });

  it("locks protected routes when no password hash is configured", async () => {
    await app.close();
    db.close();

    const cwd = await mkdtemp(path.join(tmpdir(), "aether-app-"));
    await mkdir(path.join(cwd, "media"));
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(503);
    expect(health.json()).toEqual({
      status: "not_ready",
      reason: "password_not_configured"
    });

    const tree = await app.inject({
      method: "GET",
      url: "/api/tree",
      cookies: {
        aether_session: "stale-session"
      }
    });

    expect(tree.statusCode).toBe(503);
    expect(tree.json()).toEqual({ error: "password_not_configured" });
  });

  it("rejects malformed static web paths without a server error", async () => {
    await app.close();
    db.close();

    const cwd = await mkdtemp(path.join(tmpdir(), "aether-static-"));
    await mkdir(path.join(cwd, "media"));
    await mkdir(path.join(cwd, "web-dist"), { recursive: true });
    await writeFile(
      path.join(cwd, "web-dist", "index.html"),
      "<main>Aether</main>"
    );
    const passwordHash = await hashPassword("correct horse battery staple");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: passwordHash,
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough",
        AETHER_WEB_DIST: "./web-dist"
      },
      cwd
    );

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });

    const malformed = await app.inject({ method: "GET", url: "/%zz" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: "invalid_request" });
  });

  it("only gives immutable caching to fingerprinted build assets", async () => {
    await app.close();
    db.close();

    const cwd = await mkdtemp(path.join(tmpdir(), "aether-static-"));
    await mkdir(path.join(cwd, "media"));
    await mkdir(path.join(cwd, "web-dist", "assets"), { recursive: true });
    await writeFile(
      path.join(cwd, "web-dist", "index.html"),
      "<main>Aether</main>"
    );
    await writeFile(path.join(cwd, "web-dist", "manifest.webmanifest"), "{}");
    await writeFile(path.join(cwd, "web-dist", "aether-icon-192.png"), "icon");
    await writeFile(
      path.join(cwd, "web-dist", "assets", "app-hash.js"),
      "export {};"
    );
    await writeFile(
      path.join(cwd, "web-dist", "assets", "font-hash.woff2"),
      "font"
    );
    const passwordHash = await hashPassword("correct horse battery staple");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: passwordHash,
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough",
        AETHER_WEB_DIST: "./web-dist"
      },
      cwd
    );

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });

    const manifest = await app.inject({
      method: "GET",
      url: "/manifest.webmanifest"
    });
    const icon = await app.inject({
      method: "GET",
      url: "/aether-icon-192.png"
    });
    const script = await app.inject({
      method: "GET",
      url: "/assets/app-hash.js"
    });
    const font = await app.inject({
      method: "GET",
      url: "/assets/font-hash.woff2"
    });

    expect(manifest.headers["cache-control"]).toBe("no-cache");
    expect(icon.headers["cache-control"]).toBe("no-cache");
    expect(script.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(font.headers["content-type"]).toBe("font/woff2");
  });

  function sessionLastSeenAt(sessionId: string): string {
    const row = db
      .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
      .get(sessionId) as { last_seen_at: string };

    return row.last_seen_at;
  }
});
