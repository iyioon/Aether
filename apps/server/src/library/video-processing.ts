import { spawn } from "node:child_process";

interface CommandResult {
  stdout: string;
  stderr: string;
}

export const LOCAL_MEDIA_INPUT_ARGS = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegvideo,m4v,apng,avif,png_pipe,gif"
] as const;

const MAX_PROCESS_OUTPUT_BYTES = 96 * 1024;
const MAX_VIDEO_PROCESSING_JOBS = 2;

const videoProcessingQueue: Array<() => void> = [];
let activeVideoProcessingJobs = 0;

export async function runMediaCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;

      if (stdoutBytes <= MAX_PROCESS_OUTPUT_BYTES) {
        stdout.push(chunk);
      } else {
        outputExceeded = true;
        child.kill("SIGKILL");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;

      if (stderrBytes <= MAX_PROCESS_OUTPUT_BYTES) {
        stderr.push(chunk);
      }
    });

    child.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const stdoutText = Buffer.concat(stdout).toString("utf8");
        const stderrText = Buffer.concat(stderr).toString("utf8");

        if (outputExceeded) {
          reject(
            new MediaProcessingError(`${command} exceeded its output limit.`)
          );
          return;
        }

        if (timedOut) {
          reject(new MediaProcessingError(`${command} timed out.`));
          return;
        }

        if (code !== 0) {
          reject(
            new MediaProcessingError(
              stderrText.trim() ||
                `${command} exited with code ${code ?? "unknown"}.`
            )
          );
          return;
        }

        resolve({
          stdout: stdoutText,
          stderr: stderrText
        });
      });
    });

    function finish(callback: () => void) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      callback();
    }
  });
}

export async function withVideoProcessingSlot<T>(
  task: () => Promise<T>
): Promise<T> {
  if (activeVideoProcessingJobs >= MAX_VIDEO_PROCESSING_JOBS) {
    await new Promise<void>((resolve) => {
      videoProcessingQueue.push(resolve);
    });
  } else {
    activeVideoProcessingJobs += 1;
  }

  try {
    return await task();
  } finally {
    const next = videoProcessingQueue.shift();
    if (next) next();
    else activeVideoProcessingJobs -= 1;
  }
}

export class MediaProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingError";
  }
}
