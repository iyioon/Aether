import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { hashPassword } from "../auth/password.js";

class HiddenOutput extends Writable {
  muted = false;

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (this.muted) {
      callback();
      return;
    }

    process.stderr.write(chunk, callback);
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (args.length > 1 || (args.length === 1 && args[0] !== "--stdin")) {
  console.error("Aether does not accept passwords as command-line arguments.");
  printUsage();
  process.exit(1);
}

const password = await (
  args[0] === "--stdin" ? readPasswordFromStdin() : promptForPassword()
).catch((error: unknown): never => {
  console.error(
    error instanceof Error ? error.message : "Could not read password."
  );
  process.exit(1);
});
if (!password) {
  console.error("Password cannot be empty.");
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);

async function promptForPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    console.error(
      "No terminal was detected. Pass --stdin to read from standard input."
    );
    printUsage();
    process.exit(1);
  }

  const output = new HiddenOutput();
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: true
  });

  try {
    const first = await hiddenQuestion(readline, output, "Password: ");
    const second = await hiddenQuestion(readline, output, "Confirm password: ");
    if (first !== second) {
      throw new Error("Passwords do not match.");
    }
    return first;
  } finally {
    readline.close();
  }
}

async function hiddenQuestion(
  readline: ReturnType<typeof createInterface>,
  output: HiddenOutput,
  prompt: string
): Promise<string> {
  process.stderr.write(prompt);
  output.muted = true;
  try {
    return await readline.question("");
  } finally {
    output.muted = false;
    process.stderr.write("\n");
  }
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "--stdin requires piped input. Omit it to use the hidden prompt."
    );
  }

  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }
  return input.replace(/\r?\n$/, "");
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  npm run hash-password -w @aether/server",
      "  secret-command | npm run hash-password -w @aether/server -- --stdin"
    ].join("\n")
  );
}
