import { randomUUID } from "crypto";
import type { LogFields, LogRecord } from "./schema.js";
import { createJsonLogWriter, type LogSink } from "./writers.js";

/**
 * Logging contract used throughout the migrator runtime.
 */
export interface Logger {
  emit(record: LogRecord): void;
}

interface LoggerOptions {
  clock?: () => Date;
  quiet?: boolean;
  correlationId?: string;
  serviceVersion?: string;
  sink?: LogSink;
  verbose?: boolean;
}

function shouldEmit(
  record: LogRecord,
  options: Pick<LoggerOptions, "quiet" | "verbose">,
): boolean {
  if (options.quiet && record.level !== "error") {
    return false;
  }
  return (
    (record.level !== "debug" && record.level !== "trace") ||
    options.verbose !== false
  );
}

function isLogFields(value: unknown): value is LogFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enrichFields(
  fields: LogFields | undefined,
  correlationId: string,
): LogFields {
  const pgMigrate = isLogFields(fields?.pg_migrate) ? fields.pg_migrate : {};

  return {
    ...(fields ?? {}),
    pg_migrate: {
      ...pgMigrate,
      correlation_id: correlationId,
    },
  };
}

function enrichService(
  service: LogRecord["service"],
  serviceVersion: string | undefined,
): NonNullable<LogRecord["service"]> {
  return {
    ...(service ?? {}),
    ...(serviceVersion === undefined ? {} : { version: serviceVersion }),
    name: "pg-migrate",
  };
}

function enrichLogRecord(
  record: LogRecord,
  options: Required<Pick<LoggerOptions, "clock" | "correlationId">> &
    Pick<LoggerOptions, "serviceVersion">,
): LogRecord {
  return {
    ...record,
    event: { ...record.event },
    fields: enrichFields(record.fields, options.correlationId),
    service: enrichService(record.service, options.serviceVersion),
    time: record.time ?? options.clock().toISOString(),
  };
}

/**
 * Creates a logger that emits enriched structured log records.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? createJsonLogWriter(process.stderr);
  const clock = options.clock ?? ((): Date => new Date());
  const correlationId = options.correlationId ?? randomUUID();

  return {
    emit(record: LogRecord): void {
      if (
        !shouldEmit(record, {
          quiet: options.quiet ?? false,
          verbose: options.verbose ?? false,
        })
      ) {
        return;
      }
      sink.write(
        enrichLogRecord(record, {
          clock,
          correlationId,
          serviceVersion: options.serviceVersion,
        }),
      );
    },
  };
}
