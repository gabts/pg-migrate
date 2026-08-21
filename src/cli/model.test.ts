import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCommand } from "./model.js";

describe("model", (): void => {
  it("accepts every recognized command", (): void => {
    for (const command of ["create", "status", "validate", "up", "down"]) {
      assert.equal(isCommand(command), true);
    }
  });

  it("rejects unknown strings", (): void => {
    assert.equal(isCommand("bogus"), false);
    assert.equal(isCommand("help"), false);
    assert.equal(isCommand(""), false);
  });

  it("rejects non-string values", (): void => {
    assert.equal(isCommand(undefined), false);
    assert.equal(isCommand(null), false);
    assert.equal(isCommand(3), false);
  });
});
