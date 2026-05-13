import type { LogRecord } from "./schema.js";
import { appendNewline } from "./serialize.js";

interface LogStream {
  write(chunk: string): boolean | void;
}

/**
 * Destination for enriched structured log records.
 */
export interface LogSink {
  write(record: LogRecord): void;
}

function serializeLogRecord(record: LogRecord): string {
  try {
    const serialized = JSON.stringify(record);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fallback for values JSON cannot serialize (e.g. BigInt, circular refs).
  }

  return JSON.stringify(toJsonSafeValue(record));
}

function toJsonSafeValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "undefined" || typeof value === "function") {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const safeArray = value.map((item): unknown => toJsonSafeValue(item, seen));
    seen.delete(value);
    return safeArray;
  }

  const safeObject = Object.fromEntries(
    Object.entries(value).map(([key, item]): [string, unknown] => [
      key,
      toJsonSafeValue(item, seen),
    ]),
  );
  seen.delete(value);
  return safeObject;
}

/**
 * Creates a writer that writes structured log records as newline-delimited JSON.
 */
export function createJsonLogWriter(stream: LogStream): LogSink {
  return {
    write: (record: LogRecord): void => {
      stream.write(appendNewline(serializeLogRecord(record)));
    },
  };
}
