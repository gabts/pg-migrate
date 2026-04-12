import { executeDownPlan, executeUpPlan } from "./execution.js";
import { loadDiskMigrations } from "./migration-files.js";
import { planDownExecution, planUpExecution } from "./planning.js";
import { withMigrationTransaction } from "./transaction.js";
import type { ClientConfig, LogFn } from "./types.js";
import { validateUpPreconditions } from "./validation.js";

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
  if (!disk.all.length) {
    log("🌋 migratorosaurus completed! no files found.");
    return;
  }

  await withMigrationTransaction({
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

      await executeUpPlan({ client, log, migrations, table });
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

  await withMigrationTransaction({
    clientConfig,
    log,
    table,
    run: async ({ appliedRows, client }): Promise<void> => {
      const migrations = planDownExecution({
        appliedRows,
        disk,
        target,
      });

      await executeDownPlan({ client, log, migrations, table });
    },
  });

  log("🌋 migratorosaurus down completed!");
}
