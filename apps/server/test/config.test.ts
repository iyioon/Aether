import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/config.js";
import { stableId } from "../src/library/ids.js";

describe("loadConfig", () => {
  it("canonicalizes configured media roots", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );

    expect(config.mediaRoots).toHaveLength(1);
    expect(config.mediaRoots[0]?.realPath).toBe(await realpath(mediaRoot));
    expect(config.mediaRoots[0]?.id).toBe(
      stableId("root", await realpath(mediaRoot))
    );
    expect(config.dataDir).toBe(path.join(cwd, "aether-data"));
    expect(config.configDir).toBe(path.join(cwd, "aether-data", "config"));
    expect(config.cacheDir).toBe(path.join(cwd, "aether-data", "cache"));
    expect(config.backupDir).toBe(path.join(cwd, "aether-data", "backups"));
    expect(config.sessionCookieName).toBe("aether_session");
  });

  it("allows escaped commas in configured media root paths", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "exam,papers", "data");
    await mkdir(mediaRoot, { recursive: true });

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./exam\\,papers/data",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );

    expect(config.mediaRoots).toHaveLength(1);
    expect(config.mediaRoots[0]?.inputPath).toBe("./exam,papers/data");
    expect(config.mediaRoots[0]?.realPath).toBe(await realpath(mediaRoot));
  });

  it("uses a named media root key as stable identity across path changes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const oldMediaRoot = path.join(cwd, "old-media");
    const newMediaRoot = path.join(cwd, "new-media");
    await mkdir(oldMediaRoot);
    await mkdir(newMediaRoot);

    const oldConfig = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "archive=./old-media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const newConfig = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "archive=./new-media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );

    expect(oldConfig.mediaRoots[0]).toMatchObject({
      id: stableId("root", "named", "archive"),
      label: "archive",
      inputPath: "./old-media",
      realPath: await realpath(oldMediaRoot)
    });
    expect(newConfig.mediaRoots[0]).toMatchObject({
      id: oldConfig.mediaRoots[0]?.id,
      label: "archive",
      inputPath: "./new-media",
      realPath: await realpath(newMediaRoot)
    });
  });

  it("allows escaped commas in named media root paths", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "exam,papers", "data");
    await mkdir(mediaRoot, { recursive: true });

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "study-library=./exam\\,papers/data",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );

    expect(config.mediaRoots).toHaveLength(1);
    expect(config.mediaRoots[0]).toMatchObject({
      id: stableId("root", "named", "study-library"),
      label: "study-library",
      inputPath: "./exam,papers/data",
      realPath: await realpath(mediaRoot)
    });
  });

  it("rejects duplicate named media root keys", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    await mkdir(path.join(cwd, "photos"));
    await mkdir(path.join(cwd, "videos"));

    await expect(
      loadConfig(
        {
          AETHER_MEDIA_ROOTS: "library=./photos,library=./videos",
          AETHER_DATA_DIR: "./aether-data"
        },
        cwd
      )
    ).rejects.toThrow("Duplicate media root key: library");
  });

  it("requires a strong session secret in production", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));

    await expect(
      loadConfig(
        {
          NODE_ENV: "production",
          AETHER_SESSION_SECRET: "short"
        },
        cwd
      )
    ).rejects.toThrow(/AETHER_SESSION_SECRET/);
  });

  it("rejects malformed and unsupported password hashes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));

    await expect(
      loadConfig(
        {
          AETHER_DATA_DIR: "./aether-data",
          AETHER_PASSWORD_HASH: "not-a-password-hash"
        },
        cwd
      )
    ).rejects.toThrow(/AETHER_PASSWORD_HASH/);

    const argon2iHash = await argon2.hash("password", {
      type: argon2.argon2i,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1
    });
    await expect(
      loadConfig(
        {
          AETHER_DATA_DIR: "./aether-data",
          AETHER_PASSWORD_HASH: argon2iHash
        },
        cwd
      )
    ).rejects.toThrow(/Argon2id/);

    const valid = await loadConfig(
      {
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: await hashPassword("password")
      },
      cwd
    );
    expect(valid.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("requires a real built web index in production", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const productionEnv = {
      NODE_ENV: "production",
      AETHER_DATA_DIR: "./aether-data",
      AETHER_SESSION_SECRET: "production-session-secret-that-is-long-enough"
    };

    await expect(loadConfig(productionEnv, cwd)).rejects.toThrow(
      /production web build/
    );

    await mkdir(path.join(cwd, "apps", "web", "dist"), { recursive: true });
    await writeFile(
      path.join(cwd, "apps", "web", "dist", "index.html"),
      "<main>Aether</main>"
    );
    const config = await loadConfig(productionEnv, cwd);

    expect(config.requireWebBuild).toBe(true);
    expect(config.webDistDir).toBe(path.join(cwd, "apps", "web", "dist"));
  });

  it("keeps the data directory separate from media", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    await mkdir(path.join(cwd, "media"));

    await expect(
      loadConfig(
        {
          AETHER_MEDIA_ROOTS: "./media",
          AETHER_DATA_DIR: "./media/aether-data"
        },
        cwd
      )
    ).rejects.toThrow("AETHER_DATA_DIR and media roots must not overlap");
  });

  it("configures media watching from environment flags", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_WATCH_ENABLED: "true",
        AETHER_WATCH_DEBOUNCE_MS: "750",
        NODE_ENV: "test"
      },
      cwd
    );

    expect(config.watchEnabled).toBe(true);
    expect(config.watchDebounceMs).toBe(750);
  });

  it("configures persistent login throttling from environment flags", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    await mkdir(path.join(cwd, "media"));

    const defaults = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        NODE_ENV: "test"
      },
      cwd
    );
    const explicit = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_LOGIN_MAX_ATTEMPTS: "5",
        AETHER_LOGIN_WINDOW_MINUTES: "10",
        AETHER_LOGIN_LOCKOUT_MINUTES: "30",
        NODE_ENV: "test"
      },
      cwd
    );

    expect(defaults.loginMaxAttempts).toBe(10);
    expect(defaults.loginWindowMs).toBe(15 * 60 * 1000);
    expect(defaults.loginLockoutMs).toBe(15 * 60 * 1000);
    expect(explicit.loginMaxAttempts).toBe(5);
    expect(explicit.loginWindowMs).toBe(10 * 60 * 1000);
    expect(explicit.loginLockoutMs).toBe(30 * 60 * 1000);
  });

  it("keeps AI disabled by default and configures local Ollama explicitly", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    await mkdir(path.join(cwd, "media"));

    const defaults = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        NODE_ENV: "test"
      },
      cwd
    );
    const ollama = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_AI_PROVIDER: "ollama",
        AETHER_OLLAMA_BASE_URL: "http://127.0.0.1:11434/",
        AETHER_OLLAMA_VISION_MODEL: "llava:13b",
        AETHER_AI_TIMEOUT_MS: "5000",
        NODE_ENV: "test"
      },
      cwd
    );

    expect(defaults.aiProvider).toBe("disabled");
    expect(ollama.aiProvider).toBe("ollama");
    expect(ollama.ollamaBaseUrl).toBe("http://127.0.0.1:11434");
    expect(ollama.ollamaVisionModel).toBe("llava:13b");
    expect(ollama.aiTimeoutMs).toBe(5000);
  });
});
