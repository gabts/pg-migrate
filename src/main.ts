import { executeDownPlan, executeUpPlan } from "./execution.js";
import { loadDiskMigrations, materializeSteps } from "./migration-files.js";
import { planDownExecution, planUpExecution } from "./planning.js";
import { withMigrationSession } from "./transaction.js";
import type { ClientConfig, LogFn } from "./types.js";
import {
  validateDownPreconditions,
  validateUpPreconditions,
} from "./validation.js";

export interface MigrationOptions {
  directory?: string;
  log?: LogFn;
  table?: string;
  target?: string;
}

function normalizeOptions(args: MigrationOptions): {
  directory: string;
  log: LogFn;
  table: string;
  target?: string;
} {
  return {
    directory: args.directory ?? "migrations",
    log: args.log ?? ((): undefined => undefined),
    table: args.table ?? "migration_history",
    target: args.target,
  };
}

export async function up(
  clientConfig: ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { directory, log, table, target } = normalizeOptions(args);
  log("🦖 migratorosaurus up initiated!");

  const disk = loadDiskMigrations(directory);

  await withMigrationSession({
    clientConfig,
    log,
    table,
    run: async ({ appliedRows, client }): Promise<void> => {
      const { latestApplied, targetMigration } = validateUpPreconditions({
        appliedRows,
        disk,
        target,
      });

      const migrations = planUpExecution({
        disk,
        latestApplied,
        targetMigration,
      });

      const steps = materializeSteps(migrations, "up");

      if (steps.length === 0) {
        log("No pending migrations.");
        return;
      }

      await executeUpPlan({ client, log, steps, table });
    },
  });

  log("🌋 migratorosaurus up completed!");
}

export async function down(
  clientConfig: ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { directory, log, table, target } = normalizeOptions(args);
  log("🦖 migratorosaurus down initiated!");

  const disk = loadDiskMigrations(directory);

  await withMigrationSession({
    clientConfig,
    log,
    table,
    run: async ({ appliedRows, client }): Promise<void> => {
      const { targetMigration } = validateDownPreconditions({
        appliedRows,
        disk,
        target,
      });

      const migrations = planDownExecution({
        appliedRows,
        disk,
        targetMigration,
      });

      const steps = materializeSteps(migrations, "down");

      if (steps.length === 0) {
        log("No migrations to roll back.");
        return;
      }

      await executeDownPlan({ client, log, steps, table });
    },
  });

  log("🌋 migratorosaurus down completed!");
}
