import { PresentationMediaError } from "./presentation-cache.js";
import { runMediaCommand } from "./video-processing.js";

type BounceCodec = "hevc" | "h264";
let cachedTools: {
  searchPath: string;
  result: Promise<{ modernFilterFile: boolean; encoders: Set<string> }>;
} | null = null;

export function bounceDependencyFailure(
  error: unknown,
  diagnostic: string,
  args: readonly string[]
): PresentationMediaError | null {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "ENOEXEC" ||
    /^(?:dyld(?:\[\d+\])?:|[^\r\n]*: error while loading shared libraries:)/m.test(
      diagnostic
    )
  )
    return new PresentationMediaError("media_tool_unavailable", 503);
  for (const [encoder, errorCode] of [
    ["libx265", "bounce_hevc_encoder_unavailable"],
    ["libx264", "bounce_h264_encoder_unavailable"]
  ] as const)
    if (
      args.includes(encoder) &&
      new RegExp(`Unknown encoder ['"]${encoder}['"]`).test(diagnostic)
    )
      return new PresentationMediaError(errorCode, 503);
  return null;
}

export async function bounceFilterFileArguments(
  filterPath: string,
  codec: BounceCodec,
  timeoutMs: number
): Promise<string[]> {
  if (timeoutMs <= 0)
    throw new PresentationMediaError("presentation_limit_exceeded", 422);
  const searchPath = process.env.PATH ?? "";
  if (!cachedTools || cachedTools.searchPath !== searchPath) {
    const result = Promise.all([
      runMediaCommand(
        "ffmpeg",
        ["-hide_banner", "-/filter_complex", filterPath, "-version"],
        timeoutMs
      )
        .then(() => true)
        .catch((error: unknown) => {
          if (
            error instanceof Error &&
            /Unrecognized option ['"]\/filter_complex/.test(error.message)
          )
            return false;
          throw error;
        }),
      runMediaCommand("ffmpeg", ["-hide_banner", "-encoders"], timeoutMs).then(
        ({ stdout }) =>
          new Set(
            stdout.split("\n").flatMap((line) => {
              const [flags, name] = line.trim().split(/\s+/);
              return flags?.length === 6 && flags.startsWith("V") && name
                ? [name]
                : [];
            })
          )
      )
    ])
      .then(([modernFilterFile, encoders]) => ({ modernFilterFile, encoders }))
      .catch((error: unknown) => {
        if (cachedTools?.searchPath === searchPath) cachedTools = null;
        throw (
          bounceDependencyFailure(
            error,
            error instanceof Error ? error.message : "",
            []
          ) ?? new PresentationMediaError("presentation_processing_failed", 422)
        );
      });
    cachedTools = { searchPath, result };
  }
  const tools = await cachedTools.result;
  const encoder = codec === "hevc" ? "libx265" : "libx264";
  if (!tools.encoders.has(encoder))
    throw new PresentationMediaError(
      codec === "hevc"
        ? "bounce_hevc_encoder_unavailable"
        : "bounce_h264_encoder_unavailable",
      503
    );
  // FFmpeg 9 removed the deprecated script flag. Releases before file-valued
  // options use the legacy spelling while retaining the same private graph.
  return [
    tools.modernFilterFile ? "-/filter_complex" : "-filter_complex_script",
    filterPath
  ];
}
