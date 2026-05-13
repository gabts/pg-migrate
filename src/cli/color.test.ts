import * as assert from "node:assert";
import { resolveSupportsColor } from "./color.js";

describe("color", (): void => {
  describe("resolveSupportsColor", (): void => {
    it("uses TTY support for auto and omitted color modes", (): void => {
      assert.equal(resolveSupportsColor(undefined, true), true);
      assert.equal(resolveSupportsColor(undefined, false), false);
      assert.equal(resolveSupportsColor("auto", true), true);
      assert.equal(resolveSupportsColor("auto", false), false);
    });

    it("honors explicit color modes", (): void => {
      assert.equal(resolveSupportsColor(true, false), true);
      assert.equal(resolveSupportsColor(false, true), false);
    });
  });
});
