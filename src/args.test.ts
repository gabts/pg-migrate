import * as assert from "assert";
import {
  assertFlagsAllowedFor,
  booleanFlag,
  extractGlobals,
  hasHelpFlag,
  parseTokens,
  valueFlag,
} from "./args.js";

describe("args", (): void => {
  describe("parseTokens", (): void => {
    it("returns empty flags and positional for no tokens", (): void => {
      const parsed = parseTokens([]);

      assert.equal(parsed.flags.size, 0);
      assert.deepEqual(parsed.positional, []);
    });

    it("collects positional arguments", (): void => {
      const parsed = parseTokens(["create", "postgres://localhost/db"]);

      assert.deepEqual(parsed.positional, [
        "create",
        "postgres://localhost/db",
      ]);
    });

    it("parses boolean flags as true", (): void => {
      const parsed = parseTokens(["--verbose", "--json"]);

      assert.equal(parsed.flags.get("--verbose"), true);
      assert.equal(parsed.flags.get("--json"), true);
    });

    it("resolves boolean aliases to the canonical key", (): void => {
      const parsed = parseTokens(["-v"]);

      assert.equal(parsed.flags.get("--verbose"), true);
      assert.equal(parsed.flags.get("-v"), undefined);
    });

    it("parses value flags with the next token as the value", (): void => {
      const parsed = parseTokens(["--directory", "migrations"]);

      assert.equal(parsed.flags.get("--directory"), "migrations");
    });

    it("resolves value flag aliases to the canonical key", (): void => {
      const parsed = parseTokens(["-d", "migrations"]);

      assert.equal(parsed.flags.get("--directory"), "migrations");
      assert.equal(parsed.flags.get("-d"), undefined);
    });

    it("accepts flags and positional args in any order", (): void => {
      const parsed = parseTokens([
        "--verbose",
        "create",
        "--name",
        "add_users",
      ]);

      assert.deepEqual(parsed.positional, ["create"]);
      assert.equal(parsed.flags.get("--verbose"), true);
      assert.equal(parsed.flags.get("--name"), "add_users");
    });

    it("accepts flags before the command", (): void => {
      const parsed = parseTokens([
        "--name",
        "add_users",
        "--verbose",
        "create",
      ]);

      assert.deepEqual(parsed.positional, ["create"]);
      assert.equal(parsed.flags.get("--verbose"), true);
      assert.equal(parsed.flags.get("--name"), "add_users");
    });

    it("throws on unknown flags", (): void => {
      assert.throws((): void => {
        parseTokens(["--bogus"]);
      }, /Unknown argument: --bogus/);
    });

    it("throws when value flag has no following token", (): void => {
      assert.throws((): void => {
        parseTokens(["--name"]);
      }, /Name flag \(--name, -n\) requires a value/);
    });

    it("includes aliases in missing-value error messages", (): void => {
      assert.throws((): void => {
        parseTokens(["--directory"]);
      }, /Directory flag \(--directory, -d\) requires a value/);
    });

    it("omits aliases when the flag has none", (): void => {
      assert.throws((): void => {
        parseTokens(["--table"]);
      }, /Table flag \(--table\) requires a value/);
    });

    it("consumes the next token as a value even if it looks like a flag", (): void => {
      const parsed = parseTokens(["--name", "--help"]);

      assert.equal(parsed.flags.get("--name"), "--help");
    });

    it("lets later occurrences of a flag overwrite earlier ones", (): void => {
      const parsed = parseTokens(["--name", "first", "--name", "second"]);

      assert.equal(parsed.flags.get("--name"), "second");
    });
  });

  describe("hasHelpFlag", (): void => {
    it("returns true when --help is present", (): void => {
      assert.equal(hasHelpFlag(["create", "--help"]), true);
    });

    it("returns true when -h is present", (): void => {
      assert.equal(hasHelpFlag(["-h"]), true);
    });

    it("returns true even if --help would be consumed as a value", (): void => {
      assert.equal(hasHelpFlag(["create", "--name", "--help"]), true);
    });

    it("returns false when neither --help nor -h is present", (): void => {
      assert.equal(hasHelpFlag(["create", "--name", "add_users"]), false);
    });
  });

  describe("valueFlag", (): void => {
    it("returns the value when set", (): void => {
      const parsed = parseTokens(["--directory", "migrations"]);

      assert.equal(valueFlag(parsed, "--directory"), "migrations");
    });

    it("returns undefined when unset", (): void => {
      const parsed = parseTokens([]);

      assert.equal(valueFlag(parsed, "--directory"), undefined);
    });

    it("returns undefined for boolean flags", (): void => {
      const parsed = parseTokens(["--verbose"]);

      assert.equal(valueFlag(parsed, "--verbose"), undefined);
    });
  });

  describe("booleanFlag", (): void => {
    it("returns true when the boolean flag is set", (): void => {
      const parsed = parseTokens(["--verbose"]);

      assert.equal(booleanFlag(parsed, "--verbose"), true);
    });

    it("returns false when the boolean flag is unset", (): void => {
      const parsed = parseTokens([]);

      assert.equal(booleanFlag(parsed, "--verbose"), false);
    });

    it("returns false for value flags with string values", (): void => {
      const parsed = parseTokens(["--name", "x"]);

      assert.equal(booleanFlag(parsed, "--name"), false);
    });
  });

  describe("assertFlagsAllowedFor", (): void => {
    it("accepts global flags for any command", (): void => {
      const parsed = parseTokens(["--verbose", "--json"]);

      assert.doesNotThrow((): void => {
        assertFlagsAllowedFor(parsed, "create");
      });
      assert.doesNotThrow((): void => {
        assertFlagsAllowedFor(parsed, "up");
      });
    });

    it("accepts command-owned flags on their owning command", (): void => {
      const parsed = parseTokens(["--name", "x"]);

      assert.doesNotThrow((): void => {
        assertFlagsAllowedFor(parsed, "create");
      });
    });

    it("rejects flags that are not allowed for the command", (): void => {
      const parsed = parseTokens(["--name", "x"]);

      assert.throws((): void => {
        assertFlagsAllowedFor(parsed, "up");
      }, /Unknown argument: --name/);
    });

    it("accepts shared flags across commands", (): void => {
      const parsed = parseTokens(["--directory", "migrations"]);

      for (const command of ["create", "up", "down", "validate"] as const) {
        assert.doesNotThrow((): void => {
          assertFlagsAllowedFor(parsed, command);
        });
      }
    });

    it("accepts --url and --table on validate", (): void => {
      const parsed = parseTokens([
        "--url",
        "postgres://localhost:5432/example",
        "--table",
        "migration_history",
      ]);

      assert.doesNotThrow((): void => {
        assertFlagsAllowedFor(parsed, "validate");
      });
    });

    it("rejects --dry-run on create", (): void => {
      const parsed = parseTokens(["--dry-run"]);

      assert.throws((): void => {
        assertFlagsAllowedFor(parsed, "create");
      }, /Unknown argument: --dry-run/);
    });

    it("rejects --target on validate", (): void => {
      const parsed = parseTokens(["--target", "x.sql"]);

      assert.throws((): void => {
        assertFlagsAllowedFor(parsed, "validate");
      }, /Unknown argument: --target/);
    });

    it("accepts global flags when no command is given", (): void => {
      const parsed = parseTokens(["--verbose", "--json", "--no-color"]);

      assert.doesNotThrow((): void => {
        assertFlagsAllowedFor(parsed, undefined);
      });
    });

    it("rejects command-scoped flags when no command is given", (): void => {
      const parsed = parseTokens(["--dry-run"]);

      assert.throws((): void => {
        assertFlagsAllowedFor(parsed, undefined);
      }, /Unknown argument: --dry-run/);
    });

    it("rejects --name when no command is given", (): void => {
      const parsed = parseTokens(["--name", "x"]);

      assert.throws((): void => {
        assertFlagsAllowedFor(parsed, undefined);
      }, /Unknown argument: --name/);
    });
  });

  describe("extractGlobals", (): void => {
    it("returns defaults when no global flags are set", (): void => {
      const parsed = parseTokens([]);

      assert.deepEqual(extractGlobals(parsed), {
        color: "auto",
        json: false,
        quiet: false,
        verbose: false,
      });
    });

    it("reflects every global flag", (): void => {
      const parsed = parseTokens([
        "--json",
        "--quiet",
        "--verbose",
        "--no-color",
      ]);

      assert.deepEqual(extractGlobals(parsed), {
        color: false,
        json: true,
        quiet: true,
        verbose: true,
      });
    });

    it("treats -v the same as --verbose", (): void => {
      const parsed = parseTokens(["-v"]);

      assert.equal(extractGlobals(parsed).verbose, true);
    });
  });
});
