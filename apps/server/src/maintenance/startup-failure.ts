import { ZodError } from "zod";

export type StartupStage =
  | "environment"
  | "data directory"
  | "runtime lock"
  | "private settings"
  | "restore recovery"
  | "temporary files"
  | "configuration"
  | "database"
  | "application setup"
  | "API listener";

const stageHints: Record<StartupStage, string> = {
  environment: "Check .env and .env.local settings.",
  "data directory":
    "Check AETHER_DATA_DIR ownership, permissions and location.",
  "runtime lock":
    "Check whether another Aether instance or maintenance process is using the data directory.",
  "private settings": "Check private.env and AETHER_DATA_DIR settings.",
  "restore recovery":
    "Check for an interrupted restore before changing the data directory.",
  "temporary files":
    "Check data-directory permissions and available disk space.",
  configuration:
    "Check configured media folders, mounted drives and environment settings.",
  database:
    "Check database permissions and compatibility. Preserve the existing data directory.",
  "application setup":
    "Check installed dependencies and data-directory permissions.",
  "API listener": "Check AETHER_HOST, AETHER_PORT and other running servers."
};

const messageHints = new Map([
  [
    "AETHER_WRITABLE_ROOTS must contain configured media root names.",
    "AETHER_WRITABLE_ROOTS must list names defined in AETHER_MEDIA_ROOTS, not paths or true."
  ],
  [
    "Writable media roots cannot overlap another configured media root.",
    "A writable media root overlaps another configured root. Check AETHER_MEDIA_ROOTS."
  ],
  [
    "AETHER_DATA_DIR cannot be changed from inside private.env.",
    "Set AETHER_DATA_DIR in .env.local or the process environment, not private.env."
  ],
  [
    "AETHER_SESSION_SECRET must be set to at least 32 characters in production.",
    "Production requires AETHER_SESSION_SECRET with at least 32 characters."
  ],
  [
    "The production web build is missing. Build apps/web before starting Aether.",
    "The production web build is missing. Run npm run build before starting Aether."
  ],
  [
    "Upload staging requires a private directory.",
    "Upload staging must be a private directory owned by the server account with permissions 0700."
  ],
  [
    "Upload staging changed during startup.",
    "The upload staging directory changed during startup. Check the data volume and retry."
  ]
]);

const codeHints = new Map([
  [
    "ERR_MODULE_NOT_FOUND",
    "A required module could not be loaded. Run npm ci and npm run build with Node.js 24."
  ],
  [
    "MODULE_NOT_FOUND",
    "A required module could not be loaded. Run npm ci and npm run build with Node.js 24."
  ],
  [
    "ERR_DLOPEN_FAILED",
    "A native dependency could not be loaded. Run npm ci on this machine with Node.js 24."
  ],
  [
    "EADDRINUSE",
    "The API port is already in use. Stop the other server or change AETHER_PORT."
  ],
  [
    "EADDRNOTAVAIL",
    "AETHER_HOST is not available on this machine. Check the bind address."
  ],
  [
    "EACCES",
    "Permission was denied. Check server-account access to the data directory and media folders."
  ],
  [
    "EPERM",
    "The filesystem denied an operation. Check ownership, mount permissions and filesystem support."
  ],
  [
    "ENOSPC",
    "The filesystem has no free space. Free space on the affected volume and retry."
  ],
  [
    "EROFS",
    "A required write reached a read-only filesystem. Check the data-directory mount."
  ],
  [
    "SQLITE_BUSY",
    "The database is busy. Check for another Aether or maintenance process."
  ],
  [
    "SQLITE_CORRUPT",
    "The database is damaged. Preserve the data directory and restore a verified backup."
  ],
  [
    "SQLITE_NOTADB",
    "The database file is not a valid SQLite database. Preserve it and check your backup."
  ],
  [
    "SQLITE_CANTOPEN",
    "The database could not be opened. Check data-directory ownership and permissions."
  ]
]);

export function startupFailureMessage(
  stage: StartupStage,
  error: unknown
): string {
  let hint: string | undefined;
  if (stage === "configuration" && error instanceof ZodError) {
    const fields = [
      ...new Set(
        error.issues.flatMap((issue) => {
          const field = issue.path[0];
          return typeof field === "string" &&
            /^[A-Z][A-Z0-9_]{0,63}$/.test(field)
            ? [field]
            : [];
        })
      )
    ].slice(0, 10);
    if (fields.length)
      hint = `Invalid settings: ${fields.join(", ")}. Check private.env and environment overrides.`;
  }
  if (error instanceof Error) {
    hint ??= messageHints.get(error.message);
    const code = "code" in error ? error.code : undefined;
    if (!hint && typeof code === "string") hint = codeHints.get(code);
    if (!hint && code === "ENOENT")
      hint =
        "A required file or folder is missing. Check mounted drives, configured paths and installed dependencies.";
  }
  return `Aether server failed to start. Stage: ${stage}. ${hint ?? stageHints[stage]}`;
}
