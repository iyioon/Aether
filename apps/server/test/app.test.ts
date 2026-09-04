import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";

describe("app security foundation", () => {
  let app: FastifyInstance;
  let db: AetherDatabase;
  let configuredRootId: string;

  beforeEach(async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-app-"));
    await mkdir(path.join(cwd, "media"));
    const passwordHash = await hashPassword("correct horse battery staple");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        AETHER_PASSWORD_HASH: passwordHash,
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
    configuredRootId = config.mediaRoots[0]?.id ?? "";
  });

  afterEach(async () => {
    await app.close();
    db.close();
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
    const sessionCookie = cookies.find((entry) => entry.name === "aether_session");
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
    const csrfCookie = login.cookies.find((entry) => entry.name === "aether_csrf");

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
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
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
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );

    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });

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
    await writeFile(path.join(cwd, "web-dist", "index.html"), "<main>Aether</main>");
    const passwordHash = await hashPassword("correct horse battery staple");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
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
});
