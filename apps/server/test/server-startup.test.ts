import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
const tsxImportPath = createRequire(import.meta.url).resolve("tsx");

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((fixture) => rm(fixture, { recursive: true, force: true }))
  );
});

describe("server startup", () => {
  it("releases its runtime lock and redacts details after database startup fails", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "aether-startup-"));
    fixtures.push(fixture);
    const dataDir = path.join(fixture, "aether-data");
    const configDir = path.join(dataDir, "config");
    const cacheDir = path.join(dataDir, "cache");
    const backupDir = path.join(dataDir, "backups");
    const mediaDir = path.join(fixture, "media");
    const outsideDatabase = path.join(fixture, "outside.sqlite");

    await Promise.all([
      mkdir(path.join(fixture, "apps", "server"), { recursive: true }),
      mkdir(path.join(fixture, "apps", "web"), { recursive: true }),
      mkdir(configDir, { recursive: true }),
      mkdir(cacheDir, { recursive: true }),
      mkdir(backupDir, { recursive: true }),
      mkdir(mediaDir, { recursive: true })
    ]);
    await Promise.all([
      writeFile(path.join(fixture, "package.json"), '{"private":true}\n'),
      writeFile(path.join(fixture, "apps", "server", "package.json"), "{}\n"),
      writeFile(path.join(fixture, "apps", "web", "package.json"), "{}\n"),
      writeFile(
        path.join(dataDir, ".aether-data.json"),
        '{"application":"aether","version":1}\n'
      ),
      writeFile(outsideDatabase, "not a database")
    ]);
    await symlink(outsideDatabase, path.join(configDir, "aether.sqlite"));

    const indexPath = fileURLToPath(
      new URL("../src/index.ts", import.meta.url)
    );
    const result = await runServer(indexPath, fixture, {
      AETHER_DATA_DIR: dataDir,
      AETHER_MEDIA_ROOTS: mediaDir,
      AETHER_WATCH_ENABLED: "false",
      NODE_ENV: "test"
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Aether server failed to start.");
    expect(result.stderr).not.toContain(fixture);
    expect(result.stderr).not.toContain("aether.sqlite");
    await expect(access(path.join(dataDir, "runtime.lock"))).rejects.toThrow();
  });
});

async function runServer(
  indexPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(
    process.execPath,
    ["--import", tsxImportPath, indexPath],
    {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"]
    }
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Server startup test timed out."));
    }, 10_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr });
    });
  });
}
