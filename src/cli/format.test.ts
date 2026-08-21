import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatError,
  formatEvent,
  formatFailureCause,
  formatMigrate,
  formatStatus,
  formatValidation,
} from "./format.js";

describe("format", (): void => {
  describe("formatError", (): void => {
    it("formats the message with a mark and a usage hint", (): void => {
      assert.equal(
        formatError("Unknown command 'bogus'.", false, "help"),
        "✖ Error: Unknown command 'bogus'.\n" +
          "  Run `pg-migrate --help` for usage.",
      );
    });

    it("omits the usage hint for execution errors", (): void => {
      assert.equal(
        formatError("Division by zero.", false),
        "✖ Error: Division by zero.",
      );
    });

    it("points the hint at the command's help when given one", (): void => {
      assert.equal(
        formatError("Missing required argument 'name'.", false, "create"),
        "✖ Error: Missing required argument 'name'.\n" +
          "  Run `pg-migrate create --help` for usage.",
      );
    });

    it("colors the mark when colors are enabled", (): void => {
      // "\u001b[31m" and "\u001b[39m" set and reset red foreground.
      assert.ok(
        formatError("Oops.", true).startsWith("\u001b[31m\u2716\u001b[39m"),
      );
    });
  });

  describe("formatFailureCause", (): void => {
    it("formats a quoted cause without another failure mark", (): void => {
      assert.equal(
        formatFailureCause("division by zero", false),
        "Error: 'division by zero'",
      );
    });

    it("colors the error label when colors are enabled", (): void => {
      // "\u001b[31m" and "\u001b[39m" set and reset red foreground.
      assert.ok(
        formatFailureCause("division by zero", true).startsWith(
          "\u001b[31mError\u001b[39m: ",
        ),
      );
    });
  });

  describe("formatMigrate", (): void => {
    it("formats the number of applied migrations", (): void => {
      assert.equal(
        formatMigrate({ files: ["one.sql", "two.sql"] }, "up"),
        "2 migrations applied.",
      );
    });

    it("formats one reverted migration", (): void => {
      assert.equal(
        formatMigrate({ files: ["one.sql"] }, "down"),
        "1 migration reverted.",
      );
    });

    it("omits an empty migration result", (): void => {
      assert.equal(formatMigrate({ files: [] }, "up"), undefined);
    });
  });

  describe("formatStatus", (): void => {
    it("lists each migration and the summary", (): void => {
      assert.equal(
        formatStatus({
          current: {
            appliedAt: "2026-08-14T10:10:00.000Z",
            file: "20260814121000_add_posts.sql",
            name: "add_posts",
            state: "applied",
            version: "20260814121000",
          },
          directory: "migrations",
          initialized: true,
          migrations: [
            {
              appliedAt: "2026-08-14T10:00:00.000Z",
              file: "20260814120000_add_users.sql",
              name: "add_users",
              state: "applied",
              version: "20260814120000",
            },
            {
              appliedAt: "2026-08-14T10:10:00.000Z",
              file: "20260814121000_add_posts.sql",
              name: "add_posts",
              state: "applied",
              version: "20260814121000",
            },
            {
              appliedAt: null,
              file: "20260814122000_add_comments.sql",
              name: "add_comments",
              state: "pending",
              version: "20260814122000",
            },
          ],
          next: {
            appliedAt: null,
            file: "20260814122000_add_comments.sql",
            name: "add_comments",
            state: "pending",
            version: "20260814122000",
          },
          summary: { applied: 2, pending: 1, total: 3 },
          table: "schema_migrations",
        }),
        "✔ Applied  20260814120000_add_users.sql\n" +
          "✔ Applied  20260814121000_add_posts.sql\n" +
          "○ Pending  20260814122000_add_comments.sql\n" +
          "2 applied, 1 pending, 3 total.",
      );
    });

    it("reports when the history table is not initialized", (): void => {
      assert.equal(
        formatStatus({
          current: null,
          directory: "migrations",
          initialized: false,
          migrations: [
            {
              appliedAt: null,
              file: "20260814120000_add_users.sql",
              name: "add_users",
              state: "pending",
              version: "20260814120000",
            },
          ],
          next: {
            appliedAt: null,
            file: "20260814120000_add_users.sql",
            name: "add_users",
            state: "pending",
            version: "20260814120000",
          },
          summary: { applied: 0, pending: 1, total: 1 },
          table: "schema_migrations",
        }),
        "History table is not initialized.\n" +
          "○ Pending  20260814120000_add_users.sql\n" +
          "0 applied, 1 pending, 1 total.",
      );
    });
  });

  describe("formatValidation", (): void => {
    it("formats successful validation with migration counts", (): void => {
      assert.equal(
        formatValidation({ applied: 2, pending: 1, total: 3 }),
        "✔ Valid: 2 applied, 1 pending, 3 total.",
      );
    });
  });

  describe("formatEvent", (): void => {
    it("formats file creation phases", (): void => {
      assert.equal(
        formatEvent({ type: "file-create-start", directory: "demo" }, false),
        "Creating migration in 'demo'...",
      );
    });

    it("formats migration file phases", (): void => {
      assert.equal(
        formatEvent({ type: "directory-read-start", directory: "demo" }, false),
        "Reading migration directory 'demo'...",
      );
      assert.equal(
        formatEvent({ type: "directory-read-done", directory: "demo" }, false),
        "› Read migration directory 'demo'.",
      );
      assert.equal(
        formatEvent({ type: "filenames-validation-start" }, false),
        "Validating migration filenames...",
      );
      assert.equal(
        formatEvent({ type: "filenames-validation-done", count: 2 }, false),
        "› Validated 2 migration filenames.",
      );
      assert.equal(
        formatEvent({ type: "sql-read-start", count: 1 }, false),
        "Reading SQL from 1 migration file...",
      );
      assert.equal(
        formatEvent({ type: "sql-read-done", count: 1 }, false),
        "› Read SQL from 1 migration file.",
      );
      assert.equal(
        formatEvent({ type: "sql-validation-start", count: 2 }, false),
        "Validating SQL in 2 migration files...",
      );
      assert.equal(
        formatEvent({ type: "sql-validation-done", count: 2 }, false),
        "› Validated SQL in 2 migration files.",
      );
    });

    it("formats database connection phases", (): void => {
      const database = {
        database: "pg_migrate_test",
        host: "localhost",
        port: 5432,
        user: "gabe",
      };
      assert.equal(
        formatEvent({ type: "database-connect-start", database }, false),
        "Connecting to 'pg_migrate_test' at 'localhost:5432' as 'gabe'...",
      );
      assert.equal(
        formatEvent({ type: "database-connect-done", database }, false),
        "› Connected to 'pg_migrate_test' at 'localhost:5432' as 'gabe'.",
      );
      assert.equal(
        formatEvent({ type: "database-disconnect-done", database }, false),
        "› Disconnected from 'localhost:5432'.",
      );
    });

    it("formats lock phases", (): void => {
      assert.equal(
        formatEvent(
          { type: "lock-acquire-start", table: "schema_migrations" },
          false,
        ),
        "Acquiring migration lock for 'schema_migrations'...",
      );
      assert.equal(
        formatEvent(
          { type: "lock-acquire-done", table: "schema_migrations" },
          false,
        ),
        "› Acquired migration lock for 'schema_migrations'.",
      );
    });

    it("formats history phases", (): void => {
      assert.equal(
        formatEvent(
          {
            type: "history-definition-read-start",
            table: "schema_migrations",
          },
          false,
        ),
        "Reading migration history definition from 'schema_migrations'...",
      );
      assert.equal(
        formatEvent(
          {
            type: "history-definition-read-done",
            table: "schema_migrations",
          },
          false,
        ),
        "› Read migration history definition from 'schema_migrations'.",
      );
      assert.equal(
        formatEvent(
          {
            type: "history-definition-validation-start",
            table: "schema_migrations",
          },
          false,
        ),
        "Validating migration history definition for 'schema_migrations'...",
      );
      assert.equal(
        formatEvent(
          {
            type: "history-definition-validation-done",
            table: "schema_migrations",
          },
          false,
        ),
        "› Validated migration history definition for 'schema_migrations'.",
      );
      assert.equal(
        formatEvent(
          { type: "applied-read-start", table: "schema_migrations" },
          false,
        ),
        "Reading applied migrations from 'schema_migrations'...",
      );
      assert.equal(
        formatEvent(
          {
            type: "applied-read-done",
            table: "schema_migrations",
            count: 2,
          },
          false,
        ),
        "› Read 2 applied migrations from 'schema_migrations'.",
      );
    });

    it("formats target resolution phases", (): void => {
      assert.equal(
        formatEvent(
          { type: "target-resolve-start", target: "20260530152542_five.sql" },
          false,
        ),
        "Resolving migration target '20260530152542_five.sql'...",
      );
      assert.equal(
        formatEvent(
          {
            file: "20260530152542_five.sql",
            type: "target-resolve-done",
          },
          false,
        ),
        "› Resolved migration target '20260530152542_five.sql'.",
      );
    });

    it("formats consistency validation phases", (): void => {
      assert.equal(
        formatEvent({ type: "consistency-validation-start" }, false),
        "Validating migration consistency...",
      );
      assert.equal(
        formatEvent({ type: "consistency-validation-done" }, false),
        "› Validated migration consistency.",
      );
    });

    it("formats up planning phases", (): void => {
      assert.equal(
        formatEvent({ direction: "up", type: "plan-start" }, false),
        "Planning migrations to apply...",
      );
      assert.equal(
        formatEvent({ count: 2, direction: "up", type: "plan-done" }, false),
        "› Planned 2 migrations to apply.",
      );
    });

    it("formats down planning phases with a singular count", (): void => {
      assert.equal(
        formatEvent({ direction: "down", type: "plan-start" }, false),
        "Planning migrations to revert...",
      );
      assert.equal(
        formatEvent({ count: 1, direction: "down", type: "plan-done" }, false),
        "› Planned 1 migration to revert.",
      );
    });

    it("colors a setup mark gray when colors are enabled", (): void => {
      assert.ok(
        formatEvent(
          { type: "directory-read-done", directory: "demo" },
          true,
        ).startsWith("\u001b[90m\u203a\u001b[39m"),
      );
    });

    it("formats migration-start going up", (): void => {
      assert.equal(
        formatEvent(
          {
            type: "migration-start",
            file: "20260719120000_add_users.sql",
            direction: "up",
          },
          false,
        ),
        "Applying '20260719120000_add_users.sql'...",
      );
    });

    it("formats migration-start going down", (): void => {
      assert.equal(
        formatEvent(
          {
            type: "migration-start",
            file: "20260719120000_add_users.sql",
            direction: "down",
          },
          false,
        ),
        "Reverting '20260719120000_add_users.sql'...",
      );
    });

    it("formats history initialization", (): void => {
      assert.equal(
        formatEvent(
          { table: "schema_migrations", type: "history-initialize-start" },
          false,
        ),
        "Initializing migration history table 'schema_migrations'...",
      );
      assert.equal(
        formatEvent(
          { table: "schema_migrations", type: "history-initialize-done" },
          false,
        ),
        "› Initialized migration history table 'schema_migrations'.",
      );
    });

    it("formats a completed up migration as applied", (): void => {
      assert.equal(
        formatEvent(
          {
            direction: "up",
            type: "migration-done",
            file: "20260719120000_add_users.sql",
            durationMs: 42,
          },
          false,
        ),
        "✔ Applied '20260719120000_add_users.sql' (42ms)",
      );
    });

    it("formats a completed down migration as reverted", (): void => {
      assert.equal(
        formatEvent(
          {
            direction: "down",
            type: "migration-done",
            file: "20260719120000_add_users.sql",
            durationMs: 42,
          },
          false,
        ),
        "✔ Reverted '20260719120000_add_users.sql' (42ms)",
      );
    });

    it("colors a migration checkmark when colors are enabled", (): void => {
      assert.ok(
        formatEvent(
          {
            direction: "up",
            type: "migration-done",
            file: "20260719120000_add_users.sql",
            durationMs: 42,
          },
          true,
        ).startsWith("\u001b[32m\u2714\u001b[39m"),
      );
    });

    it("formats a failed migration", (): void => {
      assert.equal(
        formatEvent(
          {
            direction: "up",
            type: "migration-failed",
            file: "20260530152542_five.sql",
            durationMs: 1,
          },
          false,
        ),
        "✖ Failed '20260530152542_five.sql' (1ms)",
      );
    });

    it("formats a failed transaction rollback event", (): void => {
      assert.equal(
        formatEvent({ type: "failed-migration-rollback-done" }, false),
        "› Rolled back failed migration transaction.",
      );
    });

    it("formats no-pending", (): void => {
      assert.equal(
        formatEvent({ type: "no-pending" }, false),
        "No pending migrations.",
      );
    });

    it("formats no-applied", (): void => {
      assert.equal(
        formatEvent({ type: "no-applied" }, false),
        "No applied migrations.",
      );
    });

    it("formats target-current", (): void => {
      assert.equal(
        formatEvent({ type: "target-current" }, false),
        "Migration target is already current.",
      );
    });

    it("formats file-created with the path and a next-step hint", (): void => {
      assert.equal(
        formatEvent(
          {
            type: "file-created",
            path: "migrations/20240101120000_add_users.sql",
          },
          false,
        ),
        "✔ Created migrations/20240101120000_add_users.sql\n" +
          "  Edit the file, then run `pg-migrate up` to apply it.",
      );
    });
  });
});
