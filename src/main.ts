import { executeDownPlan, executeUpPlan } from "./execution.js";
import { messages } from "./log-messages.js";
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
  log(messages.startedUp());
  if (target) {
    log(messages.target(target));
  }

  try {
    const disk = loadDiskMigrations(directory);

    await withMigrationSession({
      clientConfig,
      log,
      table,
      run: async ({ appliedRows, client }): Promise<void> => {
        const { latestAppliedMigration, targetMigration } =
          validateUpPreconditions({
            appliedRows,
            disk,
            target,
          });

        const migrations = planUpExecution({
          disk,
          latestAppliedMigration,
          targetMigration,
        });

        const steps = materializeSteps(migrations, "up");

        log(messages.pending(steps.length));

        if (steps.length === 0) {
          return;
        }

        await executeUpPlan({ client, log, steps, table });
      },
    });

    log(messages.completedUp());
  } catch (error) {
    log(messages.abortedUp());
    throw error;
  }
}

export async function down(
  clientConfig: ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { directory, log, table, target } = normalizeOptions(args);
  log(messages.startedDown());
  if (target) {
    log(messages.target(target));
  }

  try {
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
          log(messages.nothingToRollback());
          return;
        }

        await executeDownPlan({ client, log, steps, table });
      },
    });

    log(messages.completedDown());
  } catch (error) {
    log(messages.abortedDown());
    throw error;
  }
}
