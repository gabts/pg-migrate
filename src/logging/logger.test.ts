import * as assert from "node:assert";
import { createLogger } from "./logger.js";
import type { LogRecord } from "./schema.js";
import type { LogSink } from "./writers.js";

interface CapturedLogSink {
  chunks: LogRecord[];
  sink: LogSink;
}

function createCapturedLogSink(): CapturedLogSink {
  const chunks: LogRecord[] = [];
  return {
    chunks,
    sink: {
      write: (record: LogRecord): void => {
        chunks.push(record);
      },
    },
  };
}

function event(level: LogRecord["level"], message: string): LogRecord {
  return {
    event: {
      action: `test.${level}`,
    },
    fields: {
      pg_migrate: {
        value: level,
      },
    },
    level,
    message,
  };
}

describe("logger", (): void => {
  it("emits enriched records and hides debug by default", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      clock: (): Date => new Date("2026-04-29T12:00:00.000Z"),
      correlationId: "correlation-1",
      sink: capture.sink,
    });

    logger.emit(event("info", "hello"));
    logger.emit(event("warn", "careful"));
    logger.emit(event("error", "boom"));
    logger.emit(event("debug", "details"));

    assert.deepEqual(capture.chunks, [
      {
        event: {
          action: "test.info",
        },
        fields: {
          pg_migrate: {
            correlation_id: "correlation-1",
            value: "info",
          },
        },
        level: "info",
        message: "hello",
        service: { name: "pg-migrate" },
        time: "2026-04-29T12:00:00.000Z",
      },
      {
        event: {
          action: "test.warn",
        },
        fields: {
          pg_migrate: {
            correlation_id: "correlation-1",
            value: "warn",
          },
        },
        level: "warn",
        message: "careful",
        service: { name: "pg-migrate" },
        time: "2026-04-29T12:00:00.000Z",
      },
      {
        event: {
          action: "test.error",
        },
        fields: {
          pg_migrate: {
            correlation_id: "correlation-1",
            value: "error",
          },
        },
        level: "error",
        message: "boom",
        service: { name: "pg-migrate" },
        time: "2026-04-29T12:00:00.000Z",
      },
    ]);
  });

  it("suppresses non-error logs in quiet mode", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      quiet: true,
      verbose: true,
      sink: capture.sink,
    });

    logger.emit(event("info", "hello"));
    logger.emit(event("warn", "careful"));
    logger.emit(event("debug", "details"));
    logger.emit(event("error", "boom"));

    assert.deepEqual(
      capture.chunks.map((record): string => record.message),
      ["boom"],
    );
  });

  it("prints debug when verbose is enabled", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      verbose: true,
      sink: capture.sink,
    });

    logger.emit(event("debug", "details"));

    assert.deepEqual(
      capture.chunks.map((record): string => record.level),
      ["debug"],
    );
  });

  it("preserves errors and durations", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      clock: (): Date => new Date("2026-04-29T12:00:00.000Z"),
      correlationId: "correlation-1",
      sink: capture.sink,
    });

    logger.emit({
      error: {
        code: "23505",
        message: "duplicate key",
        type: "Error",
      },
      event: {
        action: "migration.failed",
        duration: 12_000_000,
        outcome: "failure",
      },
      level: "error",
      message: "Migration failed",
    });

    assert.equal(capture.chunks[0]?.event.duration, 12_000_000);
    assert.equal(capture.chunks[0]?.error?.code, "23505");
    assert.equal(capture.chunks[0]?.error?.message, "duplicate key");
    assert.equal(capture.chunks[0]?.error?.type, "Error");
  });

  it("copies optional event metadata into records", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      clock: (): Date => new Date("2026-04-29T12:00:00.000Z"),
      correlationId: "correlation-1",
      serviceVersion: "2.0.0",
      sink: capture.sink,
    });

    logger.emit({
      event: {
        action: "migration.applied",
        duration: 1_500_000,
        outcome: "success",
      },
      fields: {
        pg_migrate: {
          migration: {
            file: "20260416090000_create.sql",
          },
        },
      },
      level: "info",
      message: "Migration applied",
    });

    assert.deepEqual(capture.chunks[0], {
      event: {
        action: "migration.applied",
        duration: 1_500_000,
        outcome: "success",
      },
      fields: {
        pg_migrate: {
          correlation_id: "correlation-1",
          migration: {
            file: "20260416090000_create.sql",
          },
        },
      },
      level: "info",
      message: "Migration applied",
      service: {
        name: "pg-migrate",
        version: "2.0.0",
      },
      time: "2026-04-29T12:00:00.000Z",
    });
  });

  it("keeps the service name owned by the logger", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      clock: (): Date => new Date("2026-04-29T12:00:00.000Z"),
      correlationId: "correlation-1",
      serviceVersion: "2.0.0",
      sink: capture.sink,
    });

    logger.emit({
      event: {
        action: "test.info",
      },
      level: "info",
      message: "hello",
      service: {
        name: "other" as "pg-migrate",
        version: "1.0.0",
      },
    });

    assert.deepEqual(capture.chunks[0]?.service, {
      name: "pg-migrate",
      version: "2.0.0",
    });
  });

  it("keeps the correlation id owned by the logger", (): void => {
    const capture = createCapturedLogSink();
    const logger = createLogger({
      clock: (): Date => new Date("2026-04-29T12:00:00.000Z"),
      correlationId: "correlation-1",
      sink: capture.sink,
    });

    logger.emit({
      event: {
        action: "test.info",
      },
      fields: {
        pg_migrate: {
          correlation_id: "other",
        },
      },
      level: "info",
      message: "hello",
    });

    assert.deepEqual(capture.chunks[0]?.fields?.pg_migrate, {
      correlation_id: "correlation-1",
    });
  });

  it("writes records to a configured sink", (): void => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      clock: (): Date => new Date("2026-04-29T12:00:00.000Z"),
      correlationId: "correlation-1",
      sink: {
        write: (record: LogRecord): void => {
          records.push(record);
        },
      },
    });

    logger.emit(event("info", "hello"));

    assert.equal(records[0]?.message, "hello");
  });
});
