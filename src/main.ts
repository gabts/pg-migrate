import {
  createLogger,
  withLoggerOptions,
  type Logger,
} from "./logging/logger.js";
import { executeDownPlan, executeUpPlan } from "./migrations/execution.js";
import { messages } from "./logging/messages.js";
import {
  loadDiskMigrations,
  materializeStepsFromSql,
  readMigrationSqlByFile,
} from "./migrations/files.js";
import { planDownExecution, planUpExecution } from "./migrations/planning.js";
import { withMigrationSession } from "./migrations/session.js";
import type { ClientConfig } from "./db/types.js";
import {
  validateUpPreconditions,
  validateDownPreconditions,
} from "./migrations/validation.js";

export type { Logger } from "./logging/logger.js";
export type { ClientConfig } from "./db/types.js";

/**
 * Runtime options shared by `up` and `down` migration commands.
 */
export interface MigrationOptions {
  directory?: string;
  dryRun?: boolean;
  logger?: Logger;
  quiet?: boolean;
  table?: string;
  target?: string;
  verbose?: boolean;
}

/**
 * Runtime options for migration validation runs.
 */
export interface ValidateOptions {
  directory?: string;
  logger?: Logger;
  quiet?: boolean;
  table?: string;
  verbose?: boolean;
}

function normalizeOptions(args: MigrationOptions): {
  logger: Logger;
  directory: string;
  dryRun: boolean;
  table: string;
  target?: string;
} {
  const logger =
    args.logger === undefined
      ? createLogger({
          quiet: args.quiet,
          verbose: args.verbose,
        })
      : withLoggerOptions(args.logger, {
          quiet: args.quiet,
          verbose: args.verbose ?? false,
        });

  return {
    logger,
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
  const { logger, directory, dryRun, table, target } = normalizeOptions(args);

  logger.debug(
    `run=up directory=${JSON.stringify(directory)} table=${JSON.stringify(table)} dryRun=${String(dryRun)} target=${JSON.stringify(target ?? null)}`,
  );
  logger.info(messages.startedUp(dryRun));
  if (target) {
    logger.info(messages.target(target));
  }

  try {
    const disk = loadDiskMigrations(directory);
    // Validate and parse the full migration set before opening a DB session
    // or running any SQL.
    const sqlByFile = readMigrationSqlByFile(disk.all);

    await withMigrationSession({
      clientConfig,
      logger,
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
        logger.info(messages.pending(steps.length));

        if (steps.length === 0) {
          return;
        }

        await executeUpPlan({ client, logger, dryRun, steps, table });
      },
    });

    logger.info(messages.completedUp());
  } catch (error) {
    logger.error(messages.abortedUp());
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
  const { logger, directory, dryRun, table, target } = normalizeOptions(args);

  logger.debug(
    `run=down directory=${JSON.stringify(directory)} table=${JSON.stringify(table)} dryRun=${String(dryRun)} target=${JSON.stringify(target ?? null)}`,
  );
  logger.info(messages.startedDown(dryRun));
  if (target) {
    logger.info(messages.target(target));
  }

  try {
    const disk = loadDiskMigrations(directory);
    // Validate and parse the full migration set before opening a DB session
    // or running any SQL.
    const sqlByFile = readMigrationSqlByFile(disk.all);

    await withMigrationSession({
      clientConfig,
      logger,
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
        logger.info(messages.pending(steps.length));

        if (steps.length === 0) {
          logger.info(messages.nothingToRollback());
          return;
        }

        await executeDownPlan({ client, logger, dryRun, steps, table });
      },
    });

    logger.info(messages.completedDown());
  } catch (error) {
    logger.error(messages.abortedDown());
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
  const { logger, directory, table } = normalizeOptions(args);

  logger.debug(
    `run=validate directory=${JSON.stringify(directory)} table=${JSON.stringify(table)}`,
  );
  logger.info(messages.startedValidate());

  try {
    const disk = loadDiskMigrations(directory);
    // Validate and parse the full migration set before opening a DB session.
    void readMigrationSqlByFile(disk.all);

    await withMigrationSession({
      clientConfig,
      initializeHistory: false,
      logger,
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

        logger.info(
          messages.validationSummary(
            pendingUp.length,
            appliedRows.length,
            nextDown.length,
          ),
        );
      },
    });

    logger.info(messages.completedValidate());
  } catch (error) {
    logger.error(messages.abortedValidate());
    throw error;
  }
}
