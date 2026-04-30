import { runCli } from "./cli/run.js";

// CLI runs need bounded shutdown; give pipes a chance to drain without hanging forever.
const flushTimeoutMs = 1_000;
const forcedExitGraceMs = 1_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve): void => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref();
  });
}

function waitForStreamWrite(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.destroyed || !stream.writable || stream.writableEnded) {
    return Promise.resolve();
  }

  return new Promise((resolve): void => {
    try {
      stream.write("", (): void => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function writeError(error: unknown): void {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  try {
    process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  } catch {
    // Ignore output failures; the exit code is still the source of truth.
  }
}

function forceExitIfStillRunning(exitCode: number): void {
  // CLI runs must not hang after work is complete; normal cleanup still exits naturally.
  const timeout = setTimeout((): void => {
    process.exit(exitCode);
  }, forcedExitGraceMs);
  timeout.unref();
}

export async function runCliProcess(): Promise<void> {
  let exitCode = 1;

  try {
    exitCode = await runCli();
  } catch (error) {
    writeError(error);
  }

  process.exitCode = exitCode;
  await Promise.race([
    Promise.all([process.stdout, process.stderr].map(waitForStreamWrite)),
    wait(flushTimeoutMs),
  ]);

  forceExitIfStillRunning(exitCode);
}
