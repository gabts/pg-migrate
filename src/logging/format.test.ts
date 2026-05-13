import * as assert from "node:assert";
import { formatHumanLogRecord } from "./format.js";
import type { LogRecord } from "./schema.js";

function record(overrides: Partial<LogRecord>): LogRecord {
  return {
    event: {
      action: "test.info",
    },
    level: "info",
    message: "Migration run started",
    service: { name: "pg-migrate" },
    time: "2026-04-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("format", (): void => {
  it("formats info messages without a prefix by default", (): void => {
    assert.equal(
      formatHumanLogRecord(record({ message: "Migration run started" })),
      "Migration run started",
    );
  });

  it("formats warning, error, and debug prefixes when requested", (): void => {
    assert.equal(
      formatHumanLogRecord(record({ level: "warn", message: "Careful" }), {
        prefixes: true,
      }),
      "Warning: Careful",
    );
    assert.equal(
      formatHumanLogRecord(record({ level: "error", message: "Boom" }), {
        prefixes: true,
      }),
      "Error: Boom",
    );
    assert.equal(
      formatHumanLogRecord(record({ level: "debug", message: "Details" }), {
        prefixes: true,
      }),
      "Debug: Details",
    );
  });

  it("adds ANSI color to prefixes when requested", (): void => {
    assert.equal(
      formatHumanLogRecord(record({ level: "error", message: "Boom" }), {
        prefixes: true,
        supportsColor: true,
      }),
      "\u001B[31mError:\u001B[0m Boom",
    );
  });

  it("appends selected migration fields without dumping JSON", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          event: {
            action: "migration.applied",
            duration: 41_000_000,
          },
          fields: {
            pg_migrate: {
              migration: {
                file: "20260416090000_create.sql",
                name: "20260416090000_create",
                version: "20260416090000",
              },
            },
          },
          message: "Migration applied",
        }),
      ),
      "Migration applied migration=20260416090000_create duration=41ms",
    );
  });

  it("formats validation summary counts", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          event: {
            action: "validation.summary",
          },
          fields: {
            pg_migrate: {
              next_down_count: 1,
              pending_up_count: 3,
              rollbackable_down_count: 2,
            },
          },
          message: "Validation summary",
        }),
      ),
      "Validation summary pending_up=3 rollbackable_down=2 next_down=1",
    );
  });

  it("formats status summary counts", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          event: {
            action: "status.summary",
          },
          fields: {
            pg_migrate: {
              applied_count: 2,
              initialized: true,
              pending_count: 1,
              total_count: 3,
            },
          },
          message: "Status summary",
        }),
      ),
      "Status summary initialized=true applied=2 pending=1 total=3",
    );
  });

  it("formats safety-relevant runtime fields for info logs", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          fields: {
            pg_migrate: {
              command: "up",
              directory: "migrations",
              dry_run: true,
              table: "migration_history",
            },
          },
          message: "Migration run started",
        }),
      ),
      "Migration run started table=migration_history dry_run=true",
    );
    assert.equal(
      formatHumanLogRecord(
        record({
          fields: {
            pg_migrate: {
              has_sql: false,
              migration: {
                name: "20260416090000_backfill",
              },
            },
          },
          message: "Reverting migration",
        }),
      ),
      "Reverting migration migration=20260416090000_backfill has_sql=false",
    );
  });

  it("formats error details without duplicating command failure messages", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          error: {
            code: "42601",
            message: "syntax error",
            type: "Error",
          },
          level: "error",
          message: "Migration failed",
        }),
        { prefixes: true },
      ),
      "Error: Migration failed code=42601 error=syntax error",
    );
    assert.equal(
      formatHumanLogRecord(
        record({
          error: {
            message: "Unknown argument: --bogus",
            type: "Error",
          },
          level: "error",
          message: "Unknown argument: --bogus",
        }),
        { prefixes: true },
      ),
      "Error: Unknown argument: --bogus",
    );
  });

  it("keeps human logs on one line", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          error: {
            message: "line one\nline two",
            type: "Error",
          },
          level: "error",
          message: "Migration failed",
        }),
        { prefixes: true },
      ),
      "Error: Migration failed error=line one\\nline two",
    );
  });

  it("includes remaining structured fields for debug logs", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          fields: {
            pg_migrate: {
              dry_run: true,
              nested: { a: 1 },
              correlation_id: "correlation-1",
              table: "migration_history",
            },
          },
          level: "debug",
          message: "Details",
        }),
        { prefixes: true },
      ),
      'Debug: Details table=migration_history dry_run=true nested={"a":1}',
    );
  });

  it("ignores array-shaped pg_migrate field groups", (): void => {
    assert.equal(
      formatHumanLogRecord(
        record({
          fields: {
            pg_migrate: ["not", "a", "field", "object"],
          },
          level: "debug",
          message: "Details",
        }),
        { prefixes: true },
      ),
      "Debug: Details",
    );
  });
});
