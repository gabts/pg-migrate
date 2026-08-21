import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LogEvent, LogSink } from "./model.js";

function logEvent(event: LogEvent): void {
  assert.equal(event.type, "consistency-validation-start");
}

describe("model", (): void => {
  it("accepts a void-returning log sink", (): void => {
    const log: LogSink = logEvent;

    log({ type: "consistency-validation-start" });
  });
});
