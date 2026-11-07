import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(directory, "../dist/native/file-operations");

// Browsing remains available on platforms without the verified mutation helper.
if (["linux", "darwin"].includes(process.platform)) {
  mkdirSync(path.dirname(output), { recursive: true });
  const temporaryDirectory = mkdtempSync(
    path.join(path.dirname(output), ".build-")
  );
  try {
    const architecture =
      process.platform === "darwin"
        ? [
            "-arch",
            process.arch === "arm64"
              ? "arm64"
              : process.arch === "x64"
                ? "x86_64"
                : "unsupported"
          ]
        : [];
    if (architecture.includes("unsupported"))
      throw new Error("Unsupported macOS architecture.");
    const temporaryOutput = path.join(temporaryDirectory, "file-operations");
    const result = spawnSync(
      process.env.CC || "cc",
      [
        ...architecture,
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
    else {
      const require = createRequire(import.meta.url);
      const { include_dir: headers } = require("node-api-headers");
      const addon = path.join(temporaryDirectory, "descriptor-filesystem.node");
      const compiled = spawnSync(
        process.env.CC || "cc",
        [
          ...architecture,
          "-std=c11",
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-fPIC",
          ...(process.platform === "darwin"
            ? ["-bundle", "-undefined", "dynamic_lookup"]
            : ["-shared"]),
          "-DNAPI_VERSION=8",
          "-I",
          headers,
          path.join(directory, "descriptor-filesystem.c"),
          "-o",
          addon
        ],
        { stdio: "inherit" }
      );
      if (compiled.error) throw compiled.error;
      if (compiled.status !== 0) process.exitCode = compiled.status ?? 1;
      else {
        renameSync(temporaryOutput, output);
        renameSync(
          addon,
          path.join(path.dirname(output), "descriptor-filesystem.node")
        );
      }
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
