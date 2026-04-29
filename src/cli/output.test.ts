import * as assert from "assert";
import { createCliLogWriter, createCliResultWriter } from "./output.js";
import type { LogRecord } from "../logging/schema.js";

interface CapturedWritable {
  chunks: string[];
  stream: {
    isTTY?: boolean;
    write(chunk: string): boolean;
  };
}

function createWritable(isTTY = false): CapturedWritable {
  const chunks: string[] = [];

  return {
    chunks,
    stream: {
      isTTY,
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    },
  };
}

function record(overrides: Partial<LogRecord>): LogRecord {
  return {
    event: {
      action: "test.error",
    },
    level: "error",
    message: "Migration failed",
    service: { name: "migratorosaurus" },
    time: "2026-04-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("output", (): void => {
  it("writes log records as human-friendly lines", (): void => {
    const output = createWritable(false);
    const writer = createCliLogWriter(output.stream);

    writer.write(
      record({
        event: {
          action: "migration.failed",
        },
        fields: {
          migratorosaurus: {
            migration: {
              name: "20260416090000_create",
            },
          },
        },
      }),
    );

    assert.equal(
      output.chunks.join(""),
      "Error: Migration failed migration=20260416090000_create\n",
    );
  });

  it("writes JSON log records when json mode is enabled", (): void => {
    const output = createWritable(false);
    const writer = createCliLogWriter(output.stream, { json: true });

    writer.write(record({ message: "Migration failed" }));

    assert.equal(
      JSON.parse(output.chunks.join("")).message,
      "Migration failed",
    );
  });

  it("uses ANSI level prefixes in auto mode only when the target stream is a tty", (): void => {
    const output = createWritable(true);
    const writer = createCliLogWriter(output.stream);

    writer.write(record({ message: "Boom" }));

    assert.equal(output.chunks.join(""), "\u001B[31mError:\u001B[0m Boom\n");
  });

  it("allows color to be explicitly disabled for tty streams", (): void => {
    const output = createWritable(true);
    const writer = createCliLogWriter(output.stream, { color: false });

    writer.write(record({ message: "Boom" }));

    assert.equal(output.chunks.join(""), "Error: Boom\n");
  });

  it("writes string command results as lines", (): void => {
    const output = createWritable(false);
    const writer = createCliResultWriter(output.stream);

    writer.writeText("created.sql");

    assert.equal(output.chunks.join(""), "created.sql\n");
  });

  it("serializes object command results as JSON in json mode", (): void => {
    const output = createWritable(false);
    const writer = createCliResultWriter(output.stream);

    writer.writeJson({ command: "validate", ok: false });

    assert.equal(output.chunks.join(""), '{"command":"validate","ok":false}\n');
  });

  it("wraps non-object command results in json mode", (): void => {
    const output = createWritable(false);
    const writer = createCliResultWriter(output.stream);

    writer.writeJson("created.sql");
    writer.writeJson(undefined);

    assert.equal(
      output.chunks.join(""),
      '{"data":"created.sql"}\n{"data":null}\n',
    );
  });

  it("does not append a second newline", (): void => {
    const output = createWritable(false);
    const writer = createCliResultWriter(output.stream);

    writer.writeText("already terminated\n");

    assert.equal(output.chunks.join(""), "already terminated\n");
  });
});
