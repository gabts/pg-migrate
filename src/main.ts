import { createLogger, type ColorMode, type Logger } from "./logger.js";
import { executeDownPlan, executeUpPlan } from "./execution.js";
import { messages } from "./log-messages.js";
import {
  loadDiskMigrations,
  materializeStepsFromSql,
  readMigrationSqlByFile,
} from "./migration-files.js";
import { planDownExecution, planUpExecution } from "./planning.js";
import { withMigrationSession } from "./transaction.js";
import type { ClientConfig } from "./types.js";
import {
  validateUpPreconditions,
  validateDownPreconditions,
} from "./validation.js";

/**
 * Runtime options shared by `up` and `down` migration commands.
 */
export interface MigrationOptions {
  color?: ColorMode;
  directory?: string;
  dryRun?: boolean;
  quiet?: boolean;
  table?: string;
  target?: string;
  verbose?: boolean;
}

/**
 * Runtime options for migration validation runs.
 */
export interface ValidateOptions {
  color?: ColorMode;
  directory?: string;
  quiet?: boolean;
  table?: string;
  verbose?: boolean;
}

function normalizeOptions(args: MigrationOptions): {
  log: Logger;
  directory: string;
  dryRun: boolean;
  table: string;
  target?: string;
} {
  const log = createLogger({
    color: args.color,
    quiet: args.quiet,
    verbose: args.verbose,
  });

  return {
    log,
    directory: args.directory ?? "migrations",
    dryRun: args.dryRun ?? false,
    table: args.table ?? "migration_history",
    target: args.target,
  };
}

/**
 * Applies pending migrations up to an optional target file.
 */
export async function up(
  clientConfig: ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { log, directory, dryRun, table, target } = normalizeOptions(args);

  log.debug(
    `run=up directory=${JSON.stringify(directory)} table=${JSON.stringify(table)} dryRun=${String(dryRun)} target=${JSON.stringify(target ?? null)}`,
  );
  log.info(messages.startedUp(dryRun));
  if (target) {
    log.info(messages.target(target));
  }

  try {
    const disk = loadDiskMigrations(directory);
    // Validate and parse the full migration set before opening a DB session
    // or running any SQL.
    const sqlByFile = readMigrationSqlByFile(disk.all);

    await withMigrationSession({
      clientConfig,
      log,
      dryRun,
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

        const steps = materializeStepsFromSql(migrations, "up", sqlByFile);
        log.info(messages.pending(steps.length));

        if (steps.length === 0) {
          return;
        }

        await executeUpPlan({ client, log, dryRun, steps, table });
      },
    });

    log.info(messages.completedUp());
  } catch (error) {
    log.error(messages.abortedUp());
    throw error;
  }
}

/**
 * Rolls back migrations according to optional target semantics.
 */
export async function down(
  clientConfig: ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { log, directory, dryRun, table, target } = normalizeOptions(args);

  log.debug(
    `run=down directory=${JSON.stringify(directory)} table=${JSON.stringify(table)} dryRun=${String(dryRun)} target=${JSON.stringify(target ?? null)}`,
  );
  log.info(messages.startedDown(dryRun));
  if (target) {
    log.info(messages.target(target));
  }

  try {
    const disk = loadDiskMigrations(directory);
    // Validate and parse the full migration set before opening a DB session
    // or running any SQL.
    const sqlByFile = readMigrationSqlByFile(disk.all);

    await withMigrationSession({
      clientConfig,
      log,
      dryRun,
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

        const steps = materializeStepsFromSql(migrations, "down", sqlByFile);
        log.info(messages.pending(steps.length));

        if (steps.length === 0) {
          log.info(messages.nothingToRollback());
          return;
        }

        await executeDownPlan({ client, log, dryRun, steps, table });
      },
    });

    log.info(messages.completedDown());
  } catch (error) {
    log.error(messages.abortedDown());
    throw error;
  }
}

/**
 * Validates migration files and applied migration history consistency.
 */
export async function validate(
  clientConfig: ClientConfig,
  args: ValidateOptions = {},
): Promise<void> {
  const { log, directory, table } = normalizeOptions(args);

  log.debug(
    `run=validate directory=${JSON.stringify(directory)} table=${JSON.stringify(table)}`,
  );
  log.info(messages.startedValidate());

  try {
    const disk = loadDiskMigrations(directory);
    // Validate and parse the full migration set before opening a DB session.
    void readMigrationSqlByFile(disk.all);

    await withMigrationSession({
      clientConfig,
      initializeHistory: false,
      log,
      table,
      run: async ({ appliedRows }): Promise<void> => {
        const { latestAppliedMigration } = validateUpPreconditions({
          appliedRows,
          disk,
        });

        const pendingUp = planUpExecution({
          disk,
          latestAppliedMigration,
          targetMigration: null,
        });

        const nextDown = planDownExecution({
          appliedRows,
          disk,
          targetMigration: null,
        });

        log.info(
          messages.validationSummary(
            pendingUp.length,
            appliedRows.length,
            nextDown.length,
          ),
        );
      },
    });

    log.info(messages.completedValidate());
  } catch (error) {
    log.error(messages.abortedValidate());
    throw error;
  }
}
