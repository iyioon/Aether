import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";

describe("loadConfig", () => {
  it("canonicalizes configured media roots", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache"
      },
      cwd
    );

    expect(config.mediaRoots).toHaveLength(1);
    expect(config.mediaRoots[0]?.realPath).toBe(await realpath(mediaRoot));
    expect(config.sessionCookieName).toBe("aether_session");
  });

  it("allows escaped commas in configured media root paths", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "0478_w17_ms_23,pdf", "data");
    await mkdir(mediaRoot, { recursive: true });

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./0478_w17_ms_23\\,pdf/data",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache"
      },
      cwd
    );

    expect(config.mediaRoots).toHaveLength(1);
    expect(config.mediaRoots[0]?.inputPath).toBe("./0478_w17_ms_23,pdf/data");
    expect(config.mediaRoots[0]?.realPath).toBe(await realpath(mediaRoot));
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

  it("configures media watching from environment flags", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-config-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
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
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        NODE_ENV: "test"
      },
      cwd
    );
    const explicit = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
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
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        NODE_ENV: "test"
      },
      cwd
    );
    const ollama = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
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
