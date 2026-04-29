import { resolveSupportsColor, type ColorMode } from "./color.js";
import { formatHumanLogEvent } from "../logging/format.js";
import type { LogObject, LogWriter } from "../logging/logger.js";
import { appendNewline, serializeValue } from "../logging/serialize.js";

interface CliWritable {
  isTTY?: boolean;
  write(chunk: string): boolean | void;
}

interface CliLogWriterOptions {
  color?: ColorMode;
}

/**
 * Writes command results to CLI stdout.
 */
export interface CliResultWriter {
  writeJson(value: unknown): void;
  writeText(value: string): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Creates a writer that renders structured log objects for CLI stderr.
 */
export function createCliLogWriter(
  stream: CliWritable,
  options?: CliLogWriterOptions,
): LogWriter {
  const supportsColor = resolveSupportsColor(
    options?.color,
    stream.isTTY ?? false,
  );

  return {
    write(event: LogObject): void {
      stream.write(
        appendNewline(
          formatHumanLogEvent(event, {
            prefixes: true,
            supportsColor,
          }),
        ),
      );
    },
  };
}

/**
 * Creates a writer that renders command results for CLI stdout.
 */
export function createCliResultWriter(stream: CliWritable): CliResultWriter {
  return {
    writeJson(value: unknown): void {
      const rendered = serializeValue(
        isObject(value) ? value : { data: value ?? null },
      );
      stream.write(appendNewline(rendered));
    },
    writeText(value: string): void {
      stream.write(appendNewline(value));
    },
  };
}
