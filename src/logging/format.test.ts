import * as assert from "assert";
import { formatHumanLogEvent } from "./format.js";

describe("format", (): void => {
  it("formats info messages without a prefix by default", (): void => {
    assert.equal(
      formatHumanLogEvent({
        logLevel: "info",
        message: "migration run started",
      }),
      "migration run started",
    );
  });

  it("formats warning, error, and debug prefixes when requested", (): void => {
    assert.equal(
      formatHumanLogEvent(
        { logLevel: "warn", message: "careful" },
        { prefixes: true },
      ),
      "Warning: careful",
    );
    assert.equal(
      formatHumanLogEvent(
        { logLevel: "error", message: "boom" },
        { prefixes: true },
      ),
      "Error: boom",
    );
    assert.equal(
      formatHumanLogEvent(
        { logLevel: "debug", message: "details" },
        { prefixes: true },
      ),
      "Debug: details",
    );
  });

  it("adds ANSI color to prefixes when requested", (): void => {
    assert.equal(
      formatHumanLogEvent(
        { logLevel: "error", message: "boom" },
        { prefixes: true, supportsColor: true },
      ),
      "\u001B[31mError:\u001B[0m boom",
    );
  });

  it("appends fields as JSON", (): void => {
    assert.equal(
      formatHumanLogEvent({
        fields: { file: "20260416090000_create.sql" },
        logLevel: "error",
        message: "migration failed",
      }),
      'migration failed {"file":"20260416090000_create.sql"}',
    );
  });

  it("formats unknown levels without a prefix", (): void => {
    assert.equal(
      formatHumanLogEvent(
        { logLevel: "trace", message: "ignored prefix" },
        { prefixes: true },
      ),
      "ignored prefix",
    );
  });
});
