import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedArgs } from "./model.js";
import { parseArgs } from "./parse.js";

function parseInvocation(args: string[]): ParsedArgs {
  const result = parseArgs(args);
  if (!("invocation" in result)) {
    throw new Error("Expected an invocation.");
  }
  return result.invocation;
}

describe("parse", (): void => {
  describe("help", (): void => {
    it("skips option values when it selects the help command", (): void => {
      assert.deepEqual(parseArgs(["--directory", "up", "status", "--help"]), {
        help: "status",
      });
      assert.deepEqual(parseArgs(["-qd", "up", "status", "--help"]), {
        help: "status",
      });
    });
  });

  describe("parseArgs", (): void => {
    it("returns empty positionals and values for no args", (): void => {
      const { positionals, values } = parseInvocation([]);

      assert.deepEqual(positionals, []);
      // util.parseArgs returns objects with a null prototype. Copy the values
      // into a plain object before comparison.
      assert.deepEqual({ ...values }, {});
    });

    it("collects positional arguments", (): void => {
      const { positionals } = parseInvocation(["create", "add_users"]);

      assert.deepEqual(positionals, ["create", "add_users"]);
    });

    it("parses long string options", (): void => {
      const { values } = parseInvocation([
        "--config",
        ".env.local",
        "--directory",
        "migrations",
        "--table",
        "migration_history",
        "--target",
        "20240101120000_init.sql",
        "--url",
        "postgres://localhost/db",
      ]);

      assert.deepEqual(
        { ...values },
        {
          config: ".env.local",
          directory: "migrations",
          table: "migration_history",
          target: "20240101120000_init.sql",
          url: "postgres://localhost/db",
        },
      );
    });

    it("resolves short aliases to their long option names", (): void => {
      const { values } = parseInvocation([
        "-c",
        ".env.local",
        "-d",
        "migrations",
        "-t",
        "migration_history",
        "--target",
        "20240101120000_init.sql",
        "-u",
        "postgres://localhost/db",
      ]);

      assert.deepEqual(
        { ...values },
        {
          config: ".env.local",
          directory: "migrations",
          table: "migration_history",
          target: "20240101120000_init.sql",
          url: "postgres://localhost/db",
        },
      );
    });

    it("parses verbose with its long and short flags", (): void => {
      assert.equal(parseInvocation(["--verbose"]).values.verbose, true);
      assert.equal(parseInvocation(["-v"]).values.verbose, true);
    });

    it("omits verbose when the flag is absent", (): void => {
      assert.equal("verbose" in parseInvocation(["up"]).values, false);
    });

    it("parses quiet with its long and short flags", (): void => {
      assert.equal(parseInvocation(["--quiet"]).values.quiet, true);
      assert.equal(parseInvocation(["-q"]).values.quiet, true);
    });

    it("omits quiet when the flag is absent", (): void => {
      assert.equal("quiet" in parseInvocation(["up"]).values, false);
    });

    // This test checks strict parsing. Node supplies the other parse behavior.
    // The exact match checks removal of the final '--' explanation.
    it("throws a one-sentence error on unknown options", (): void => {
      assert.throws((): void => {
        parseInvocation(["--bogus"]);
      }, /^Error: Unknown option '--bogus'\.$/);
    });
  });
});
