import * as assert from "node:assert";
import type { LogRecord } from "./schema.js";
import { createJsonLogWriter } from "./writers.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    event: {
      action: "test.info",
    },
    level: "info",
    message: "hello",
    service: { name: "pg-migrate" },
    time: "2026-04-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("writers", (): void => {
  it("writes JSON lines", (): void => {
    const chunks: string[] = [];
    const writer = createJsonLogWriter({
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    });

    writer.write(record());

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0]?.endsWith("\n"));
    assert.equal(JSON.parse(chunks[0]!).message, "hello");
  });

  it("serializes non-JSON field values safely", (): void => {
    const chunks: string[] = [];
    const writer = createJsonLogWriter({
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    writer.write(
      record({
        fields: {
          pg_migrate: {
            circular,
            count: 1n,
          },
        },
      }),
    );

    const parsed = JSON.parse(chunks[0]!);
    assert.equal(parsed.fields.pg_migrate.count, "1");
    assert.equal(parsed.fields.pg_migrate.circular.self, "[Circular]");
  });
});
