/**
 * Logging contract used throughout the migrator runtime.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/**
 * Color rendering mode for log output.
 */
export type ColorMode = boolean | "auto";

interface WritableStreamLike {
  isTTY?: boolean;
  write(chunk: string): boolean;
}

/**
 * Options for creating a configured logger instance.
 */
export interface LoggerOptions {
  color?: ColorMode;
  quiet?: boolean;
  stderr?: WritableStreamLike;
  verbose?: boolean;
}

function writeLine(stream: WritableStreamLike, value: string): void {
  if (value.endsWith("\n")) {
    stream.write(value);
    return;
  }

  stream.write(`${value}\n`);
}

function formatLevelPrefix(
  label: string,
  colorCode: number,
  supportsColor: boolean,
): string {
  if (!supportsColor) {
    return `${label}:`;
  }
  return `\u001B[${colorCode}m${label}:\u001B[0m`;
}

/**
 * Creates a logger that writes leveled messages to stderr.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const stderr = options.stderr ?? process.stderr;
  const quiet = options.quiet ?? false;
  const verbose = options.verbose ?? false;
  const supportsColor = resolveSupportsColor(
    options.color,
    Boolean(stderr.isTTY),
  );

  return {
    info(message: string): void {
      if (quiet) {
        return;
      }
      writeLine(stderr, message);
    },
    warn(message: string): void {
      if (quiet) {
        return;
      }
      const prefix = formatLevelPrefix("Warning", 33, supportsColor);
      writeLine(stderr, `${prefix} ${message}`);
    },
    error(message: string): void {
      const prefix = formatLevelPrefix("Error", 31, supportsColor);
      writeLine(stderr, `${prefix} ${message}`);
    },
    debug(message: string): void {
      if (!verbose || quiet) {
        return;
      }
      const prefix = formatLevelPrefix("Debug", 36, supportsColor);
      writeLine(stderr, `${prefix} ${message}`);
    },
  };
}

/**
 * Resolves whether ANSI color should be enabled for output.
 */
export function resolveSupportsColor(
  color: ColorMode | undefined,
  isTTY: boolean,
): boolean {
  const mode = color ?? "auto";
  if (mode === "auto") {
    return isTTY;
  }
  return mode;
}
