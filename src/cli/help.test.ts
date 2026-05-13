import * as assert from "node:assert";
import { writeHelp } from "./help.js";
import type { CliResultWriter } from "./output.js";

interface CapturedResultWriter extends CliResultWriter {
  jsonValues: unknown[];
  textValues: string[];
}

function createResultWriter(): CapturedResultWriter {
  const jsonValues: unknown[] = [];
  const textValues: string[] = [];

  return {
    jsonValues,
    textValues,
    writeJson(value: unknown): void {
      jsonValues.push(value);
    },
    writeText(value: string): void {
      textValues.push(value);
    },
  };
}

describe("help", (): void => {
  it("writes default help text", (): void => {
    const writer = createResultWriter();

    writeHelp(writer, undefined, false);

    assert.equal(writer.jsonValues.length, 0);
    assert.match(writer.textValues[0]!, /Usage: pg-migrate <command>/);
    assert.match(writer.textValues[0]!, /--env-file <path>/);
  });

  it("writes command help text", (): void => {
    const writer = createResultWriter();

    writeHelp(writer, "create", false);

    assert.equal(writer.jsonValues.length, 0);
    assert.match(writer.textValues[0]!, /Usage: pg-migrate create/);
    assert.match(writer.textValues[0]!, /Creates <YYYYMMDDHHMMSS>_<name>\.sql/);
  });

  it("documents target version and filename formats", (): void => {
    const writer = createResultWriter();

    writeHelp(writer, "up", false);

    assert.equal(writer.jsonValues.length, 0);
    assert.match(
      writer.textValues[0]!,
      /--target accepts <YYYYMMDDHHMMSS> or <YYYYMMDDHHMMSS>_<slug>\.sql/,
    );
    assert.match(writer.textValues[0]!, /--target <target>/);
  });

  it("writes status help text", (): void => {
    const writer = createResultWriter();

    writeHelp(writer, "status", false);

    assert.equal(writer.jsonValues.length, 0);
    assert.match(writer.textValues[0]!, /Usage: pg-migrate status/);
    assert.match(writer.textValues[0]!, /initialized=false/);
    assert.match(
      writer.textValues[0]!,
      /Current means the latest applied migration by file order/,
    );
  });

  it("writes JSON help payloads", (): void => {
    const writer = createResultWriter();

    writeHelp(writer, "create", true);

    assert.equal(writer.textValues.length, 0);
    assert.equal(writer.jsonValues.length, 1);
    const payload = writer.jsonValues[0] as {
      command: string;
      help: string;
      ok: boolean;
    };
    assert.equal(payload.command, "create");
    assert.equal(payload.ok, true);
    assert.match(payload.help, /Usage: pg-migrate create/);
  });
});
