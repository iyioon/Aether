import { spawn } from "node:child_process";

interface CommandResult {
  stdout: string;
  stderr: string;
}

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
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;

      if (stdoutBytes <= MAX_PROCESS_OUTPUT_BYTES) {
        stdout.push(chunk);
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
  }

  activeVideoProcessingJobs += 1;

  try {
    return await task();
  } finally {
    activeVideoProcessingJobs -= 1;
    videoProcessingQueue.shift()?.();
  }
}

export class MediaProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingError";
  }
}
