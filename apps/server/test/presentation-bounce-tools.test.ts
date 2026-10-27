import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bounceDependencyFailure,
  bounceFilterFileArguments
} from "../src/library/presentation-bounce-tools.js";
import * as processing from "../src/library/video-processing.js";

let searchPath = 0;
const encoderList = " V....D libx264 H.264\n V....D libx265 HEVC\n";
beforeEach(() => {
  vi.stubEnv("PATH", `/disposable-bounce-tools-${++searchPath}`);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Bounce tool compatibility", () => {
  it("coalesces modern file-option and encoder probes across codecs and files", async () => {
    const command = vi
      .spyOn(processing, "runMediaCommand")
      .mockImplementation(async (_command, args) => ({
        stdout: args.includes("-encoders")
          ? encoderList
          : "ffmpeg version 9.0.2",
        stderr: ""
      }));
    const result = await Promise.all([
      bounceFilterFileArguments("/private/first/filter.txt", "hevc", 5000),
      bounceFilterFileArguments("/private/second/filter.txt", "h264", 5000)
    ]);
    expect(result).toEqual([
      ["-/filter_complex", "/private/first/filter.txt"],
      ["-/filter_complex", "/private/second/filter.txt"]
    ]);
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls.every((call) => call[2] === 5000)).toBe(true);
  });

  it("uses the legacy file option only when an older FFmpeg rejects the modern option", async () => {
    vi.spyOn(processing, "runMediaCommand").mockImplementation(
      async (_command, args) => {
        if (!args.includes("-encoders"))
          throw new Error(
            "Unrecognized option '/filter_complex'.\nError splitting the argument list: Option not found"
          );
        return { stdout: encoderList, stderr: "" };
      }
    );
    await expect(
      bounceFilterFileArguments("/private/filter.txt", "hevc", 5000)
    ).resolves.toEqual(["-filter_complex_script", "/private/filter.txt"]);
  });

  it.each([
    ["hevc", "libx264", "bounce_hevc_encoder_unavailable"],
    ["h264", "libx265", "bounce_h264_encoder_unavailable"]
  ] as const)(
    "reports a missing %s encoder before decoding source frames",
    async (codec, installed, code) => {
      vi.spyOn(processing, "runMediaCommand").mockImplementation(
        async (_command, args) => ({
          stdout: args.includes("-encoders")
            ? ` V....D ${installed} installed\n`
            : "version",
          stderr: ""
        })
      );
      await expect(
        bounceFilterFileArguments("/private/filter.txt", codec, 5000)
      ).rejects.toMatchObject({
        code,
        status: 503,
        message: code
      });
    }
  );

  it("does not downgrade an unrelated probe failure and retries a failed capability probe", async () => {
    const command = vi
      .spyOn(processing, "runMediaCommand")
      .mockRejectedValue(new Error("Unable to read /private/media/source.mov"));
    await expect(
      bounceFilterFileArguments("/private/filter.txt", "hevc", 5000)
    ).rejects.toMatchObject({
      code: "presentation_processing_failed",
      message: "presentation_processing_failed"
    });
    command.mockImplementation(async (_command, args) => ({
      stdout: args.includes("-encoders") ? encoderList : "version",
      stderr: ""
    }));
    await expect(
      bounceFilterFileArguments("/private/filter.txt", "hevc", 5000)
    ).resolves.toEqual(["-/filter_complex", "/private/filter.txt"]);
    expect(command).toHaveBeenCalledTimes(4);
  });

  it("starts no tool outside the shared deadline", async () => {
    const command = vi.spyOn(processing, "runMediaCommand");
    await expect(
      bounceFilterFileArguments("/private/filter.txt", "hevc", 0)
    ).rejects.toMatchObject({
      code: "presentation_limit_exceeded"
    });
    expect(command).not.toHaveBeenCalled();
  });
});

describe("safe Bounce dependency errors", () => {
  it.each(["ENOENT", "EACCES", "ENOEXEC"])(
    "classifies %s without returning executable paths",
    (code) => {
      const error = Object.assign(
        new Error("Cannot execute /private/tool/ffmpeg"),
        { code }
      );
      expect(bounceDependencyFailure(error, "", [])).toMatchObject({
        code: "media_tool_unavailable",
        status: 503,
        message: "media_tool_unavailable"
      });
    }
  );

  it.each([
    "dyld[1234]: Library not loaded: /private/missing.dylib",
    "ffmpeg: error while loading shared libraries: /private/missing.so"
  ])(
    "classifies a broken dynamic loader without returning its diagnostic",
    (diagnostic) => {
      expect(bounceDependencyFailure(undefined, diagnostic, [])).toMatchObject({
        code: "media_tool_unavailable",
        message: "media_tool_unavailable"
      });
    }
  );

  it.each([
    ["libx265", "bounce_hevc_encoder_unavailable"],
    ["libx264", "bounce_h264_encoder_unavailable"]
  ])(
    "classifies %s only when the command requested that encoder",
    (encoder, code) => {
      const diagnostic = `Unknown encoder '${encoder}'\n/private/source.mov`;
      expect(
        bounceDependencyFailure(undefined, diagnostic, ["-c:v", encoder!])
      ).toMatchObject({ code, status: 503 });
      expect(
        bounceDependencyFailure(undefined, diagnostic, ["-c:v", "rawvideo"])
      ).toBeNull();
    }
  );

  it("leaves unrelated decoding failures generic", () => {
    expect(
      bounceDependencyFailure(
        new Error("/private/source.mov"),
        "Invalid data found in /private/source.mov",
        ["-i", "/private/source.mov"]
      )
    ).toBeNull();
  });
});
