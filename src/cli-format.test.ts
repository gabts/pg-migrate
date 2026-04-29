import * as assert from "assert";
import { createCliLogWriter, createCliResultWriter } from "./cli-format.js";

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

describe("cli-format", (): void => {
  it("writes log events as human-friendly lines", (): void => {
    const output = createWritable(false);
    const writer = createCliLogWriter(output.stream);

    writer.write({
      fields: { file: "20260416090000_create.sql" },
      logLevel: "error",
      message: "migration failed",
    });

    assert.equal(
      output.chunks.join(""),
      'Error: migration failed {"file":"20260416090000_create.sql"}\n',
    );
  });

  it("uses ANSI level prefixes in auto mode only when the target stream is a tty", (): void => {
    const output = createWritable(true);
    const writer = createCliLogWriter(output.stream);

    writer.write({ logLevel: "error", message: "boom" });

    assert.equal(output.chunks.join(""), "\u001B[31mError:\u001B[0m boom\n");
  });

  it("allows color to be explicitly disabled for tty streams", (): void => {
    const output = createWritable(true);
    const writer = createCliLogWriter(output.stream, { color: false });

    writer.write({ logLevel: "error", message: "boom" });

    assert.equal(output.chunks.join(""), "Error: boom\n");
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
