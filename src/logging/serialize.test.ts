import * as assert from "node:assert";
import { appendNewline, serializeValue } from "./serialize.js";

describe("serialize", (): void => {
  describe("serializeValue", (): void => {
    it("returns strings unchanged", (): void => {
      assert.equal(serializeValue("hello"), "hello");
    });

    it("serializes JSON-compatible values", (): void => {
      assert.equal(
        serializeValue({ count: 2, ok: true }),
        '{"count":2,"ok":true}',
      );
      assert.equal(serializeValue(["a", 1]), '["a",1]');
      assert.equal(serializeValue(null), "null");
    });

    it("falls back to String for values JSON cannot serialize", (): void => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      assert.equal(serializeValue(1n), "1");
      assert.equal(serializeValue(circular), "[object Object]");
    });

    it("falls back to String when JSON.stringify returns undefined", (): void => {
      assert.equal(serializeValue(undefined), "undefined");
      assert.equal(serializeValue(Symbol("log")), "Symbol(log)");
    });
  });

  describe("appendNewline", (): void => {
    it("adds a trailing newline when missing", (): void => {
      assert.equal(appendNewline("hello"), "hello\n");
    });

    it("leaves values that already end with newline unchanged", (): void => {
      assert.equal(appendNewline("hello\n"), "hello\n");
      assert.equal(appendNewline("hello\n\n"), "hello\n\n");
    });
  });
});
