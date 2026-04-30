import * as assert from "assert";
import {
  assertValidTokens,
  booleanFlag,
  commandName,
  parseTokens,
  valueFlag,
} from "./args.js";

describe("args", (): void => {
  describe("parseTokens", (): void => {
    it("returns empty flags and positional for no tokens", (): void => {
      const parsed = parseTokens([]);

      assert.equal(parsed.command, undefined);
      assert.deepEqual(parsed.extraPositional, []);
      assert.equal(parsed.flags.size, 0);
      assert.deepEqual(parsed.globals, {
        color: "auto",
        json: false,
        quiet: false,
        verbose: false,
      });
      assert.equal(parsed.help, false);
      assert.deepEqual(parsed.positional, []);
      assert.deepEqual(parsed.validationIssues, []);
    });

    it("collects positional arguments", (): void => {
      const parsed = parseTokens(["create", "postgres://localhost/db"]);

      assert.deepEqual(parsed.positional, [
        "create",
        "postgres://localhost/db",
      ]);
      assert.equal(parsed.command, "create");
      assert.deepEqual(parsed.extraPositional, ["postgres://localhost/db"]);
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

    it("records unknown flags for validation", (): void => {
      const parsed = parseTokens(["--bogus"]);

      assert.deepEqual(parsed.validationIssues, [
        {
          kind: "unknown-argument",
          token: "--bogus",
        },
      ]);
    });

    it("records missing value flags for validation", (): void => {
      const parsed = parseTokens(["--name"]);

      assert.deepEqual(parsed.validationIssues, [
        {
          kind: "missing-value",
          label: "Name",
          tokens: "--name, -n",
        },
      ]);
    });

    it("includes aliases in missing-value error messages", (): void => {
      const parsed = parseTokens(["--directory"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Directory flag \(--directory, -d\) requires a value/);
    });

    it("omits aliases when the flag has none", (): void => {
      const parsed = parseTokens(["--table"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
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

  describe("help", (): void => {
    it("returns true when --help is present", (): void => {
      assert.equal(parseTokens(["create", "--help"]).help, true);
    });

    it("returns true when -h is present", (): void => {
      assert.equal(parseTokens(["-h"]).help, true);
    });

    it("returns true even if --help would be consumed as a value", (): void => {
      assert.equal(parseTokens(["create", "--name", "--help"]).help, true);
    });

    it("returns false when neither --help nor -h is present", (): void => {
      assert.equal(parseTokens(["create", "--name", "add_users"]).help, false);
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

  describe("commandName", (): void => {
    it("returns a command name for known commands", (): void => {
      const parsed = parseTokens(["create"]);

      assert.equal(commandName(parsed), "create");
    });

    it("returns undefined for unknown commands", (): void => {
      const parsed = parseTokens(["unknown"]);

      assert.equal(commandName(parsed), undefined);
    });
  });

  describe("assertValidTokens", (): void => {
    it("accepts global flags for any command", (): void => {
      const createParsed = parseTokens(["create", "--verbose", "--json"]);
      const upParsed = parseTokens(["up", "--verbose", "--json"]);

      assert.doesNotThrow((): void => {
        assertValidTokens(createParsed);
      });
      assert.doesNotThrow((): void => {
        assertValidTokens(upParsed);
      });
    });

    it("accepts command-owned flags on their owning command", (): void => {
      const parsed = parseTokens(["create", "--name", "x"]);

      assert.doesNotThrow((): void => {
        assertValidTokens(parsed);
      });
    });

    it("rejects flags that are not allowed for the command", (): void => {
      const parsed = parseTokens(["up", "--name", "x"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown argument: --name/);
    });

    it("accepts shared flags across commands", (): void => {
      for (const command of [
        "create",
        "up",
        "down",
        "validate",
        "status",
      ] as const) {
        const parsed = parseTokens([command, "--directory", "migrations"]);

        assert.doesNotThrow((): void => {
          assertValidTokens(parsed);
        });
      }
    });

    it("accepts --url and --table on validate", (): void => {
      const parsed = parseTokens([
        "validate",
        "--url",
        "postgres://localhost:5432/example",
        "--table",
        "migration_history",
      ]);

      assert.doesNotThrow((): void => {
        assertValidTokens(parsed);
      });
    });

    it("accepts --url and --table on status", (): void => {
      const parsed = parseTokens([
        "status",
        "--url",
        "postgres://localhost:5432/example",
        "--table",
        "migration_history",
      ]);

      assert.doesNotThrow((): void => {
        assertValidTokens(parsed);
      });
    });

    it("rejects --dry-run on create", (): void => {
      const parsed = parseTokens(["create", "--dry-run"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown argument: --dry-run/);
    });

    it("rejects --target on validate", (): void => {
      const parsed = parseTokens(["validate", "--target", "x.sql"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown argument: --target/);
    });

    it("rejects migration execution flags on status", (): void => {
      for (const flag of ["--target", "--dry-run"]) {
        const parsed = parseTokens(["status", flag, "x.sql"]);

        assert.throws(
          (): void => {
            assertValidTokens(parsed);
          },
          new RegExp(`Unknown argument: ${flag}`),
        );
      }
    });

    it("accepts global flags when no command is given", (): void => {
      const parsed = parseTokens(["--verbose", "--json", "--no-color"]);

      assert.doesNotThrow((): void => {
        assertValidTokens(parsed);
      });
    });

    it("rejects command-scoped flags when no command is given", (): void => {
      const parsed = parseTokens(["--dry-run"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown argument: --dry-run/);
    });

    it("rejects --name when no command is given", (): void => {
      const parsed = parseTokens(["--name", "x"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown argument: --name/);
    });

    it("rejects unknown flags", (): void => {
      const parsed = parseTokens(["--bogus"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown argument: --bogus/);
    });

    it("rejects missing flag values", (): void => {
      const parsed = parseTokens(["--name"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Name flag \(--name, -n\) requires a value/);
    });

    it("rejects unknown commands", (): void => {
      const parsed = parseTokens(["unknown"]);

      assert.throws((): void => {
        assertValidTokens(parsed);
      }, /Unknown command: unknown/);
    });

    it("allows command-scoped flags when help is requested", (): void => {
      const parsed = parseTokens(["--name", "x", "--help"]);

      assert.doesNotThrow((): void => {
        assertValidTokens(parsed);
      });
    });
  });

  describe("globals", (): void => {
    it("returns defaults when no global flags are set", (): void => {
      const parsed = parseTokens([]);

      assert.deepEqual(parsed.globals, {
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

      assert.deepEqual(parsed.globals, {
        color: false,
        json: true,
        quiet: true,
        verbose: true,
      });
    });

    it("treats -v the same as --verbose", (): void => {
      const parsed = parseTokens(["-v"]);

      assert.equal(parsed.globals.verbose, true);
    });

    it("detects parse-time json and color globals", (): void => {
      assert.deepEqual(
        parseTokens(["--json", "--no-color", "--bogus"]).globals,
        {
          color: false,
          json: true,
          quiet: false,
          verbose: false,
        },
      );
    });

    it("skips values consumed by known value flags", (): void => {
      assert.deepEqual(
        parseTokens(["--name", "--json", "--directory", "--no-color"]).globals,
        {
          color: "auto",
          json: false,
          quiet: false,
          verbose: false,
        },
      );
    });
  });
});
