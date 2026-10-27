import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { deflateRaw, inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { PresentationMediaError } from "./presentation-cache.js";

const compress = promisify(deflateRaw);
const decompress = promisify(inflateRaw);
const MAX_DIAGNOSTIC_BYTES = 96 * 1024;

interface FrameLocation {
  position: number;
  size: number;
}

export interface BounceFrameSpool {
  handle: FileHandle;
  frames: FrameLocation[];
  bytes: number;
}

export interface BounceCommandScope {
  signal: AbortSignal;
  remainingMs(): number;
}

function cancelled(): never {
  throw new PresentationMediaError("presentation_processing_cancelled", 499);
}
function failed(): never {
  throw new PresentationMediaError("presentation_processing_failed", 422);
}
function limited(): never {
  throw new PresentationMediaError("presentation_limit_exceeded", 422);
}

/** Run one streaming child; callers consume or produce data with backpressure. */
async function streamCommand(
  args: string[],
  scope: BounceCommandScope,
  transfer: (child: ReturnType<typeof spawn>) => Promise<void>,
  input: boolean
): Promise<void> {
  if (scope.signal.aborted) cancelled();
  const timeoutMs = scope.remainingMs();
  if (timeoutMs <= 0) limited();
  const child = spawn("ffmpeg", args, {
    stdio: [input ? "pipe" : "ignore", input ? "ignore" : "pipe", "pipe"]
  });
  let diagnosticBytes = 0;
  let timedOut = false;
  let aborted = false;
  let processError: Error | undefined;
  child.on("error", (error) => {
    processError = error;
  });
  // A closed encoder pipe is reported through its exit status, without an
  // unhandled EPIPE event while a pending write is being cancelled.
  child.stdin?.on("error", () => undefined);
  child.stderr?.on("data", (chunk: Buffer) => {
    diagnosticBytes += chunk.length;
    if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES) child.kill("SIGKILL");
  });
  const exit = new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  const onAbort = () => {
    aborted = true;
    child.kill("SIGKILL");
  };
  scope.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    if (scope.signal.aborted) onAbort();
    await transfer(child);
    const code = await exit;
    if (aborted) cancelled();
    if (timedOut || diagnosticBytes > MAX_DIAGNOSTIC_BYTES) limited();
    if (code !== 0 || processError) failed();
  } catch (error) {
    child.kill("SIGKILL");
    await exit;
    if (aborted || scope.signal.aborted) cancelled();
    if (timedOut) limited();
    if (error instanceof PresentationMediaError) throw error;
    failed();
  } finally {
    clearTimeout(timer);
    scope.signal.removeEventListener("abort", onAbort);
  }
}

/** Each independently compressed frame can be read in either direction. */
export async function decodeBounceFrames(
  spoolPath: string,
  args: string[],
  frameBytes: number,
  frameCount: number,
  maxWorkBytes: number,
  scope: BounceCommandScope
): Promise<BounceFrameSpool> {
  const handle = await open(
    spoolPath,
    constants.O_RDWR |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  );
  const spool: BounceFrameSpool = { handle, frames: [], bytes: 0 };
  try {
    await streamCommand(
      args,
      scope,
      async (child) => {
        const frame = Buffer.allocUnsafe(frameBytes);
        let filled = 0;
        for await (const value of child.stdout!) {
          const chunk = value as Buffer;
          let offset = 0;
          while (offset < chunk.length) {
            if (scope.signal.aborted) cancelled();
            if (spool.frames.length >= frameCount) failed();
            const length = Math.min(frameBytes - filled, chunk.length - offset);
            chunk.copy(frame, filled, offset, offset + length);
            filled += length;
            offset += length;
            if (filled !== frameBytes) continue;
            const compressed = await compress(frame, { level: 1 });
            if (spool.bytes + compressed.length > maxWorkBytes) limited();
            let written = 0;
            while (written < compressed.length) {
              const result = await handle.write(
                compressed,
                written,
                compressed.length - written,
                spool.bytes + written
              );
              if (!result.bytesWritten) failed();
              written += result.bytesWritten;
            }
            spool.frames.push({
              position: spool.bytes,
              size: compressed.length
            });
            spool.bytes += compressed.length;
            filled = 0;
          }
        }
        if (filled || spool.frames.length !== frameCount) failed();
      },
      false
    );
    return spool;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function encodeBounceFrames(
  spool: BounceFrameSpool,
  args: string[],
  indices: number[],
  frameBytes: number,
  scope: BounceCommandScope
): Promise<void> {
  await streamCommand(
    args,
    scope,
    async (child) => {
      const input = child.stdin!;
      for (const index of indices) {
        if (scope.signal.aborted) cancelled();
        const location = spool.frames[index];
        if (!location) failed();
        const compressed = Buffer.allocUnsafe(location.size);
        let received = 0;
        while (received < compressed.length) {
          const result = await spool.handle.read(
            compressed,
            received,
            compressed.length - received,
            location.position + received
          );
          if (!result.bytesRead) failed();
          received += result.bytesRead;
        }
        const frame = await decompress(compressed, {
          maxOutputLength: frameBytes
        });
        if (frame.length !== frameBytes) failed();
        await new Promise<void>((resolve, reject) => {
          input.write(frame, (error) => (error ? reject(error) : resolve()));
        });
      }
      input.end();
    },
    true
  );
}
