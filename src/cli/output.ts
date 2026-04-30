import { formatHumanLogRecord } from "../logging/format.js";
import type { LogRecord } from "../logging/schema.js";
import { appendNewline, serializeValue } from "../logging/serialize.js";
import { createJsonLogWriter, type LogSink } from "../logging/writers.js";
import { resolveSupportsColor, type ColorMode } from "./color.js";

interface CliWritable {
  isTTY?: boolean;
  write(chunk: string): boolean | void;
}

interface CliLogWriterOptions {
  color?: ColorMode;
  json?: boolean;
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
 * Creates a writer that renders structured log records for CLI stderr.
 */
export function createCliLogWriter(
  stream: CliWritable,
  options?: CliLogWriterOptions,
): LogSink {
  if (options?.json) {
    return createJsonLogWriter(stream);
  }

  const supportsColor = resolveSupportsColor(
    options?.color,
    stream.isTTY ?? false,
  );

  return {
    write(record: LogRecord): void {
      stream.write(
        appendNewline(
          formatHumanLogRecord(record, {
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
