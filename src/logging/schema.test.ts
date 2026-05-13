import * as assert from "node:assert";
import { durationMsToNs, normalizeError } from "./schema.js";

describe("schema", (): void => {
  it("converts millisecond durations to nanoseconds", (): void => {
    assert.equal(durationMsToNs(12), 12_000_000);
    assert.equal(durationMsToNs(0.5), 500_000);
  });

  it("normalizes Error values", (): void => {
    const error = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const normalized = normalizeError(error);

    assert.equal(normalized.code, "23505");
    assert.equal(normalized.message, "duplicate key");
    assert.equal(normalized.type, "Error");
  });

  it("omits empty error codes", (): void => {
    const error = Object.assign(new Error("duplicate key"), {
      code: "",
    });

    assert.equal(normalizeError(error).code, undefined);
  });

  it("normalizes non-Error values", (): void => {
    assert.deepEqual(normalizeError("plain string"), {
      message: "plain string",
    });
  });
});
