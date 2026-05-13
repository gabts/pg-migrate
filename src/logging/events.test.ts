import * as assert from "node:assert";
import { events } from "./events.js";

describe("events", (): void => {
  it("builds lifecycle events with boring messages and metadata", (): void => {
    assert.deepEqual(
      events.runStarted({
        command: "up",
        directory: "migrations",
        dryRun: true,
        table: "migration_history",
        target: "20260416090000_create.sql",
      }),
      {
        event: {
          action: "up.started",
        },
        fields: {
          pg_migrate: {
            command: "up",
            directory: "migrations",
            dry_run: true,
            table: "migration_history",
            target: "20260416090000_create.sql",
          },
        },
        level: "info",
        message: "Migration run started",
      },
    );
    assert.equal(events.runCompleted("down").message, "Rollback completed");
    assert.deepEqual(
      events.runStarted({
        command: "validate",
        directory: "migrations",
        table: "migration_history",
      }).fields?.pg_migrate,
      {
        command: "validate",
        directory: "migrations",
        table: "migration_history",
      },
    );
    assert.equal(
      events.runAborted({
        command: "validate",
        error: new Error("bad state"),
      }).message,
      "Validation aborted",
    );
    assert.equal(
      events.runStarted({
        command: "status",
        directory: "migrations",
        table: "migration_history",
      }).message,
      "Status started",
    );
    assert.deepEqual(events.migrationStepsPlanned(2), {
      event: {
        action: "migrations.planned",
      },
      fields: {
        pg_migrate: {
          step_count: 2,
        },
      },
      level: "info",
      message: "Migration steps planned",
    });
  });

  it("builds migration step events with file metadata", (): void => {
    const error = "cannot drop";

    assert.deepEqual(events.migrationApplying("20260416090000_create.sql"), {
      event: {
        action: "migration.applying",
      },
      fields: {
        pg_migrate: {
          migration: {
            direction: "up",
            file: "20260416090000_create.sql",
            name: "20260416090000_create",
            version: "20260416090000",
          },
        },
      },
      level: "info",
      message: "Applying migration",
    });

    assert.deepEqual(
      events.migrationFailed({
        direction: "down",
        durationMs: 41,
        error,
        file: "20260416090000_create.sql",
      }),
      {
        error: {
          message: "cannot drop",
        },
        event: {
          action: "migration.failed",
          duration: 41_000_000,
          outcome: "failure",
        },
        fields: {
          pg_migrate: {
            migration: {
              direction: "down",
              file: "20260416090000_create.sql",
              name: "20260416090000_create",
              version: "20260416090000",
            },
          },
        },
        level: "error",
        message: "Migration failed",
      },
    );

    assert.deepEqual(
      events.migrationApplied({
        durationMs: 12,
        file: "20260416090000_create.sql",
      }),
      {
        event: {
          action: "migration.applied",
          duration: 12_000_000,
          outcome: "success",
        },
        fields: {
          pg_migrate: {
            migration: {
              direction: "up",
              file: "20260416090000_create.sql",
              name: "20260416090000_create",
              version: "20260416090000",
            },
          },
        },
        level: "info",
        message: "Migration applied",
      },
    );

    assert.deepEqual(
      events.migrationReverting({
        file: "20260416090000_create.sql",
        hasSql: false,
      }),
      {
        event: {
          action: "migration.reverting",
        },
        fields: {
          pg_migrate: {
            has_sql: false,
            migration: {
              direction: "down",
              file: "20260416090000_create.sql",
              name: "20260416090000_create",
              version: "20260416090000",
            },
          },
        },
        level: "info",
        message: "Reverting migration",
      },
    );

    assert.deepEqual(
      events.migrationReverted({
        durationMs: 13,
        file: "20260416090000_create.sql",
        hasSql: true,
      }),
      {
        event: {
          action: "migration.reverted",
          duration: 13_000_000,
          outcome: "success",
        },
        fields: {
          pg_migrate: {
            has_sql: true,
            migration: {
              direction: "down",
              file: "20260416090000_create.sql",
              name: "20260416090000_create",
              version: "20260416090000",
            },
          },
        },
        level: "info",
        message: "Migration reverted",
      },
    );
  });

  it("builds summary and command failure events", (): void => {
    assert.deepEqual(
      events.statusSummary({
        appliedCount: 2,
        initialized: true,
        pendingCount: 1,
        totalCount: 3,
      }),
      {
        event: {
          action: "status.summary",
          outcome: "success",
        },
        fields: {
          pg_migrate: {
            applied_count: 2,
            initialized: true,
            pending_count: 1,
            total_count: 3,
          },
        },
        level: "info",
        message: "Status summary",
      },
    );
    assert.deepEqual(
      events.validationSummary({
        nextDownCount: 1,
        pendingUpCount: 3,
        rollbackableDownCount: 2,
      }),
      {
        event: {
          action: "validation.summary",
          outcome: "success",
        },
        fields: {
          pg_migrate: {
            next_down_count: 1,
            pending_up_count: 3,
            rollbackable_down_count: 2,
          },
        },
        level: "info",
        message: "Validation summary",
      },
    );
    assert.deepEqual(events.commandFailed({ command: null, error: "bad" }), {
      error: {
        message: "bad",
      },
      event: {
        action: "command.failed",
        outcome: "failure",
      },
      fields: {
        pg_migrate: {
          command: null,
        },
      },
      level: "error",
      message: "bad",
    });
  });

  it("builds setup, debug, target, and rollback events", (): void => {
    assert.deepEqual(events.commandOptions({ json: true }), {
      event: {
        action: "command.options",
      },
      fields: {
        pg_migrate: {
          json: true,
        },
      },
      level: "debug",
      message: "Command options parsed",
    });

    assert.deepEqual(events.runTelemetry({ dry_run: false }), {
      event: {
        action: "run.options",
      },
      fields: {
        pg_migrate: {
          dry_run: false,
        },
      },
      level: "debug",
      message: "Run options parsed",
    });

    assert.deepEqual(events.migrationsTableCreating("migration_history"), {
      event: {
        action: "migration_history_table.creating",
      },
      fields: {
        pg_migrate: {
          table: "migration_history",
        },
      },
      level: "info",
      message: "Creating migration history table",
    });

    assert.deepEqual(events.targetSelected("20260416090000_create.sql"), {
      event: {
        action: "migration.target_selected",
      },
      fields: {
        pg_migrate: {
          migration: {
            file: "20260416090000_create.sql",
            name: "20260416090000_create",
            version: "20260416090000",
          },
        },
      },
      level: "info",
      message: "Target migration selected",
    });

    assert.deepEqual(
      events.migrationTransactionRolledBack({
        direction: "up",
        file: "20260416090000_create.sql",
      }),
      {
        event: {
          action: "migration_transaction.rolled_back",
          outcome: "success",
        },
        fields: {
          pg_migrate: {
            migration: {
              direction: "up",
              file: "20260416090000_create.sql",
              name: "20260416090000_create",
              version: "20260416090000",
            },
          },
        },
        level: "warn",
        message: "Migration transaction rolled back",
      },
    );

    assert.deepEqual(events.noMigrationsToRollback(), {
      event: {
        action: "rollback.noop",
        outcome: "success",
      },
      level: "info",
      message: "No migrations to roll back",
    });
  });
});
