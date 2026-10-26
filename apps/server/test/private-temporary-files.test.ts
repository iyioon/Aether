import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "../src/config/data-directory.js";
import {
  createPrivateTemporaryFiles,
  removeAbandonedTemporaryFiles
} from "../src/maintenance/private-temporary-files.js";
import { acquireRuntimeLock } from "../src/maintenance/runtime-lock.js";
import { withDataDirectoryMaintenanceLock } from "../src/maintenance/data-directory.js";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "aether-private-temp-"));
  fixtures.push(directory);
  const paths = resolveDataPaths({}, directory);
  await initializeDataDirectory(paths);
  return { directory, paths };
}

describe("private native temporary files", () => {
  it("cleans a prior instance of its own PID after a restart without deleting current work", async () => {
    const { paths } = await createFixture();
    const staged = path.join(paths.tempDir, "staged-old-scope");
    await mkdir(staged);
    await writeFile(path.join(staged, "private.tmp"), "old process bytes");
    const hasCreationTime = (await stat(staged)).birthtimeMs > 0;
    // Leave room for filesystems whose creation timestamps have coarse precision.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const temporaryModule = new URL(
      "../src/maintenance/private-temporary-files.ts",
      import.meta.url
    ).href;
    const lockModule = new URL(
      "../src/maintenance/runtime-lock.ts",
      import.meta.url
    ).href;
    const script = `
      import { access, rename } from 'node:fs/promises';
      import path from 'node:path';
      import { createHash } from 'node:crypto';
      import { hostname } from 'node:os';
      import { createPrivateTemporaryFiles, removeAbandonedTemporaryFiles } from ${JSON.stringify(temporaryModule)};
      import { acquireRuntimeLock } from ${JSON.stringify(lockModule)};
      const paths = JSON.parse(process.argv[1]);
      const key = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);
      const old = path.join(paths.tempDir, 'scope-' + key + '-' + process.pid + '-11111111-1111-4111-8111-111111111111');
      await rename(process.argv[2], old);
      const live = await createPrivateTemporaryFiles(paths, {});
      const release = await acquireRuntimeLock(paths);
      try {
        await removeAbandonedTemporaryFiles(paths);
        const oldExists = await access(old).then(() => true, () => false);
        const liveExists = await access(live.directory).then(() => true, () => false);
        if (oldExists === ${hasCreationTime} || !liveExists) process.exitCode = 1;
      } finally { await live.close(); await release(); }
    `;
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        JSON.stringify(paths),
        staged
      ],
      { timeout: 5000 }
    );
    expect(child.status, child.stderr.toString()).toBe(0);
  }, 10000);

  it("refuses offline maintenance while an online backup has registered live work", async () => {
    const { paths, directory } = await createFixture();
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" }
    );
    const stopped = new Promise<void>((resolve) =>
      child.once("exit", () => resolve())
    );
    const hostKey = createHash("sha256")
      .update(hostname())
      .digest("hex")
      .slice(0, 16);
    const scope = path.join(
      paths.tempDir,
      `scope-${hostKey}-${child.pid}-11111111-1111-4111-8111-111111111111`
    );
    try {
      await mkdir(scope);
      let ran = false;
      await expect(
        withDataDirectoryMaintenanceLock(paths, directory, [], async () => {
          ran = true;
        })
      ).rejects.toThrow("temporary work in progress");
      expect(ran).toBe(false);
      await expect(access(paths.runtimeLockPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(access(scope)).resolves.toBeUndefined();
    } finally {
      child.kill();
      await stopped;
    }
    await expect(
      withDataDirectoryMaintenanceLock(
        paths,
        directory,
        [],
        async () => undefined
      )
    ).resolves.toBeUndefined();
  });
  it("contains native temporary work, restores the environment and removes only its scope", async () => {
    const { paths } = await createFixture();
    const env: NodeJS.ProcessEnv = {
      TMPDIR: "/prior-temp",
      TEMP: "/prior-temp"
    };
    const scope = await createPrivateTemporaryFiles(paths, env);
    expect(path.dirname(scope.directory)).toBe(paths.tempDir);
    expect(env).toMatchObject({
      TMPDIR: scope.directory,
      TMP: scope.directory,
      TEMP: scope.directory
    });
    expect((await stat(scope.directory)).mode & 0o777).toBe(0o700);
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        "require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'decoder.tmp'), 'private bytes')"
      ],
      { env: { ...process.env, ...env } }
    );
    expect(child.status).toBe(0);
    expect(
      await readFile(path.join(scope.directory, "decoder.tmp"), "utf8")
    ).toBe("private bytes");
    const other = await createPrivateTemporaryFiles(paths, {});
    await scope.close();
    await scope.close();
    expect(env).toEqual({ TMPDIR: "/prior-temp", TEMP: "/prior-temp" });
    await expect(access(scope.directory)).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(access(other.directory)).resolves.toBeUndefined();
    await other.close();
  });

  it("removes crashed same-host scopes while preserving live processes and foreign hosts", async () => {
    const { paths } = await createFixture();
    const hostKey = createHash("sha256")
      .update(hostname())
      .digest("hex")
      .slice(0, 16);
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    const token = "11111111-1111-4111-8111-111111111111";
    const dead = path.join(
      paths.tempDir,
      `scope-${hostKey}-${deadPid}-${token}`
    );
    const foreign = path.join(
      paths.tempDir,
      `scope-${hostKey === "0000000000000000" ? "1111111111111111" : "0000000000000000"}-${deadPid}-${token}`
    );
    await mkdir(dead);
    await writeFile(path.join(dead, "private.tmp"), "obsolete");
    await mkdir(foreign);
    const live = await createPrivateTemporaryFiles(paths, {});
    const release = await acquireRuntimeLock(paths);
    try {
      await removeAbandonedTemporaryFiles(paths);
      await expect(access(dead)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(foreign)).resolves.toBeUndefined();
      await expect(access(live.directory)).resolves.toBeUndefined();
    } finally {
      await live.close();
      await release();
    }
  });

  it("rejects a temporary directory symlink without changing the target or environment", async () => {
    const { paths, directory } = await createFixture();
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "preserve");
    await rm(paths.tempDir, { recursive: true });
    await symlink(outside, paths.tempDir);
    const env = { TMPDIR: "/previous" };
    await expect(createPrivateTemporaryFiles(paths, env)).rejects.toThrow(
      "real managed directory"
    );
    await expect(removeAbandonedTemporaryFiles(paths)).rejects.toThrow(
      "real managed directory"
    );
    expect(env.TMPDIR).toBe("/previous");
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe(
      "preserve"
    );
  });
});
