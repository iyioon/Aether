import { describe, expect, it } from "vitest";
import { z } from "zod";
import { startupFailureMessage } from "../src/maintenance/startup-failure.js";

describe("startup failure messages", () => {
  it("identifies a missing dependency without disclosing the import path", () => {
    const error = Object.assign(
      new Error("Cannot find /private/library/module"),
      {
        code: "ERR_MODULE_NOT_FOUND",
        path: "/private/library/module",
        cause: new Error("private-session-secret")
      }
    );
    const message = startupFailureMessage("application setup", error);
    expect(message).toContain("Stage: application setup.");
    expect(message).toContain("Run npm ci and npm run build with Node.js 24");
    expect(message).not.toContain("/private");
    expect(message).not.toContain("private-session-secret");
  });

  it("distinguishes a busy API port from a configuration error", () => {
    const error = Object.assign(new Error("listen on private-address:3030"), {
      code: "EADDRINUSE"
    });
    const message = startupFailureMessage("API listener", error);
    expect(message).toContain("API port is already in use");
    expect(message).not.toContain("private-address");
  });

  it("explains named writable roots without echoing the configured path", () => {
    const message = startupFailureMessage(
      "configuration",
      new Error(
        "AETHER_WRITABLE_ROOTS must contain configured media root names."
      )
    );
    expect(message).toContain("names defined in AETHER_MEDIA_ROOTS");
  });

  it("reports invalid environment keys without input values or Zod messages", () => {
    const result = z
      .object({
        AETHER_MAX_UPLOAD_BYTES: z.number()
      })
      .safeParse({ AETHER_MAX_UPLOAD_BYTES: "private-value" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid configuration");
    const message = startupFailureMessage("configuration", result.error);
    expect(message).toContain("Invalid settings: AETHER_MAX_UPLOAD_BYTES.");
    expect(message).not.toContain("private-value");
    expect(message).not.toContain("Invalid input");
  });

  it.each([
    new Error("Database file /private/library/aether.sqlite is unsafe"),
    Object.assign(new Error("private-session-secret"), {
      code: "/private/path"
    }),
    { message: "private-session-secret", code: "EACCES" },
    "private-session-secret"
  ])("uses a bounded stage hint for unrecognized errors", (error) => {
    const message = startupFailureMessage("database", error);
    expect(message).toContain("Stage: database.");
    expect(message).toContain("Check database permissions and compatibility");
    expect(message).not.toContain("/private");
    expect(message).not.toContain("private-session-secret");
  });
});
