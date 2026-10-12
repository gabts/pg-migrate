import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { withSafeLog } from "./log.js";
import type { LogEvent } from "./model.js";

const event: LogEvent = { type: "no-pending" };

describe("log", (): void => {
  it("calls the log sink as a method of the options", (): void => {
    const options = {
      events: [] as LogEvent[],
      log(event: LogEvent): undefined {
        this.events.push(event);
      },
    };

    withSafeLog(options).log(event);

    assert.deepEqual(options.events, [event]);
  });

  it("ignores log sink failures", (): void => {
    let calls = 0;
    const options = withSafeLog({
      log(): undefined {
        calls++;
        throw new Error("Log failure.");
      },
    });

    assert.doesNotThrow(() => options.log(event));
    assert.equal(calls, 1);
  });

  it("ignores async log sink failures", async (): Promise<void> => {
    let calls = 0;
    let unhandled: unknown;

    function captureUnhandled(error: unknown): void {
      unhandled = error;
    }

    process.on("unhandledRejection", captureUnhandled);
    try {
      withSafeLog({
        async log(): Promise<void> {
          calls++;
          throw new Error("Async log failure.");
        },
      }).log(event);
      // Node reports unhandled rejections after the promise job is complete.
      await setImmediate();
      assert.equal(calls, 1);
      assert.equal(unhandled, undefined);
    } finally {
      process.off("unhandledRejection", captureUnhandled);
    }
  });
});
