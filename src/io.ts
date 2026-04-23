import {
  createLogger,
  resolveSupportsColor,
  type ColorMode,
  type Logger,
} from "./logger.js";

interface WritableStreamLike {
  isTTY?: boolean;
  write(chunk: string): boolean;
}

/**
 * Configuration options for the combined logger/output helper.
 */
export interface IoOptions {
  color?: ColorMode;
  json?: boolean;
  quiet?: boolean;
  stderr?: WritableStreamLike;
  stdout?: WritableStreamLike;
  verbose?: boolean;
}

/**
 * Logger plus command-result output helpers for CLI workflows.
 */
export interface Io extends Logger {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  supportsColor: boolean;
  result(value: unknown): void;
}

function writeLine(stream: WritableStreamLike, value: string): void {
  if (value.endsWith("\n")) {
    stream.write(value);
    return;
  }

  stream.write(`${value}\n`);
}

function asLine(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fallback for values JSON cannot serialize (e.g. BigInt, circular refs).
  }

  return String(value);
}

/**
 * Creates an `Io` instance with logging and structured output behavior.
 */
export function createIo(options: IoOptions = {}): Io {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const json = options.json ?? false;
  const quiet = options.quiet ?? false;
  const verbose = options.verbose ?? false;
  const color = options.color ?? "auto";
  const supportsColor = resolveSupportsColor(color, Boolean(stderr.isTTY));
  const log = createLogger({
    color,
    quiet,
    stderr,
    verbose,
  });

  return {
    ...log,
    json,
    quiet,
    verbose,
    supportsColor,
    result(value: unknown): void {
      writeLine(stdout, asLine(value));
    },
  };
}
