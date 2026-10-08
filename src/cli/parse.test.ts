import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "./parse.js";

describe("parse", (): void => {
  describe("parseArgs", (): void => {
    it("returns empty positionals and values for no args", (): void => {
      const { positionals, values } = parseArgs([]);

      assert.deepEqual(positionals, []);
      // util.parseArgs returns objects with a null prototype. Copy the values
      // into a plain object before comparison.
      assert.deepEqual({ ...values }, {});
    });

    it("collects positional arguments", (): void => {
      const { positionals } = parseArgs(["create", "add_users"]);

      assert.deepEqual(positionals, ["create", "add_users"]);
    });

    it("parses long string options", (): void => {
      const { values } = parseArgs([
        "--env-file",
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
          "env-file": ".env.local",
          directory: "migrations",
          table: "migration_history",
          target: "20240101120000_init.sql",
          url: "postgres://localhost/db",
        },
      );
    });

    it("resolves short aliases to their long option names", (): void => {
      const { values } = parseArgs([
        "-d",
        "migrations",
        "-u",
        "postgres://localhost/db",
      ]);

      assert.deepEqual(
        { ...values },
        {
          directory: "migrations",
          url: "postgres://localhost/db",
        },
      );
    });

    it("parses verbose with its long and short flags", (): void => {
      assert.equal(parseArgs(["--verbose"]).values.verbose, true);
      assert.equal(parseArgs(["-v"]).values.verbose, true);
    });

    it("omits verbose when the flag is absent", (): void => {
      assert.equal("verbose" in parseArgs(["up"]).values, false);
    });

    it("parses quiet with its long and short flags", (): void => {
      assert.equal(parseArgs(["--quiet"]).values.quiet, true);
      assert.equal(parseArgs(["-q"]).values.quiet, true);
    });

    it("omits quiet when the flag is absent", (): void => {
      assert.equal("quiet" in parseArgs(["up"]).values, false);
    });

    // This test checks strict parsing. Node supplies the other parse behavior.
    // The exact match checks removal of the final '--' explanation.
    it("throws a one-sentence error on unknown options", (): void => {
      assert.throws((): void => {
        parseArgs(["--bogus"]);
      }, /^Error: Unknown option '--bogus'\.$/);
    });

    it("throws a one-sentence error on an option value that starts with a dash", (): void => {
      assert.throws((): void => {
        parseArgs(["up", "-d", "-v"]);
      }, /^Error: Option '-d' argument is ambiguous\.$/);
    });

    it("rejects '=' after a short option", (): void => {
      assert.throws((): void => {
        parseArgs(["create", "add_users", "-d=db"]);
      }, new Error("Unexpected '=' after option '-d'."));
      assert.throws((): void => {
        parseArgs(["up", "-qu=postgres://localhost/db"]);
      }, new Error("Unexpected '=' after option '-u'."));
    });

    it("rejects a repeated option", (): void => {
      assert.throws((): void => {
        parseArgs([
          "status",
          "--url",
          "postgres://a/db",
          "-u",
          "postgres://b/db",
        ]);
      }, new Error("Repeated option '--url'."));
      assert.throws((): void => {
        parseArgs(["status", "-vv"]);
      }, new Error("Repeated option '--verbose'."));
    });

    it("keeps '=' in a separate or long option value", (): void => {
      const { values } = parseArgs([
        "-d",
        "=db",
        "--table==history",
        "-uabc=def",
      ]);

      assert.deepEqual(
        { ...values },
        { directory: "=db", table: "=history", url: "abc=def" },
      );
    });
  });
});
