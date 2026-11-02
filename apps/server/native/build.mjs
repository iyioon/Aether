import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(directory, "../dist/native/file-operations");

// Browsing remains available on platforms without the verified mutation helper.
if (process.platform === "linux") {
  mkdirSync(path.dirname(output), { recursive: true });
  const temporaryDirectory = mkdtempSync(
    path.join(path.dirname(output), ".build-")
  );
  try {
    const temporaryOutput = path.join(temporaryDirectory, "file-operations");
    const result = spawnSync(
      process.env.CC || "cc",
      [
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        path.join(directory, "file-operations.c"),
        "-o",
        temporaryOutput
      ],
      { stdio: "inherit" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    else renameSync(temporaryOutput, output);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
