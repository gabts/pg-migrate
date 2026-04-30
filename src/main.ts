import { createLogger, type Logger } from "./logging/logger.js";
import type { LogSink } from "./logging/writers.js";
import { executeDownPlan, executeUpPlan } from "./migrations/execution.js";
import { events } from "./logging/events.js";
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
import { readRuntimeEnv } from "./env.js";

export type { LogRecord } from "./logging/schema.js";
export type { LogSink } from "./logging/writers.js";
export type { ClientConfig } from "./db/types.js";

/**
 * Runtime options shared by `up` and `down` migration commands.
 */
export interface MigrationOptions {
  directory?: string;
  dryRun?: boolean;
  logSink?: LogSink;
  quiet?: boolean;
  correlationId?: string;
  table?: string;
  target?: string;
  verbose?: boolean;
}

/**
 * Runtime options for migration validation runs.
 */
export interface ValidateOptions {
  directory?: string;
  logSink?: LogSink;
  quiet?: boolean;
  correlationId?: string;
  table?: string;
  verbose?: boolean;
}

type CommonOptions = Pick<
  MigrationOptions,
  "directory" | "logSink" | "quiet" | "correlationId" | "table" | "verbose"
>;

function normalizeCommonOptions(args: CommonOptions): {
  logger: Logger;
  directory: string;
  table: string;
} {
  const runtimeEnv = readRuntimeEnv();
  const logger = createLogger({
    quiet: args.quiet,
    correlationId: args.correlationId,
    sink: args.logSink,
    verbose: args.verbose,
  });

  return {
    logger,
    directory: args.directory ?? runtimeEnv.migrationDirectory,
    table: args.table ?? runtimeEnv.migrationHistoryTable,
  };
}

/**
 * Applies pending migrations up to an optional target file.
 */
export async function up(
  clientConfig: ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { logger, directory, table } = normalizeCommonOptions(args);
  const dryRun = args.dryRun ?? false;
  const target = args.target;

  logger.emit(
    events.runTelemetry({
      command: "up",
      directory,
      dry_run: dryRun,
      table,
      ...(target === undefined ? {} : { target }),
    }),
  );

  logger.emit(
    events.runStarted({
      command: "up",
      directory,
      dryRun,
      table,
      target,
    }),
  );

  if (target) {
    logger.emit(events.targetSelected(target));
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
        logger.emit(events.migrationStepsPlanned(steps.length));

        if (steps.length === 0) {
          return;
        }

        await executeUpPlan({ client, logger, dryRun, steps, table });
      },
    });

    logger.emit(events.runCompleted("up"));
  } catch (error) {
    logger.emit(events.runAborted({ command: "up", error }));
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
  const { logger, directory, table } = normalizeCommonOptions(args);
  const dryRun = args.dryRun ?? false;
  const target = args.target;

  logger.emit(
    events.runTelemetry({
      command: "down",
      directory,
      dry_run: dryRun,
      table,
      ...(target === undefined ? {} : { target }),
    }),
  );

  logger.emit(
    events.runStarted({
      command: "down",
      directory,
      dryRun,
      table,
      target,
    }),
  );

  if (target) {
    logger.emit(events.targetSelected(target));
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
        logger.emit(events.migrationStepsPlanned(steps.length));

        if (steps.length === 0) {
          logger.emit(events.noMigrationsToRollback());
          return;
        }

        await executeDownPlan({ client, logger, dryRun, steps, table });
      },
    });

    logger.emit(events.runCompleted("down"));
  } catch (error) {
    logger.emit(events.runAborted({ command: "down", error }));
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
  const { logger, directory, table } = normalizeCommonOptions(args);

  logger.emit(
    events.runTelemetry({
      command: "validate",
      directory,
      table,
    }),
  );

  logger.emit(
    events.runStarted({
      command: "validate",
      directory,
      table,
    }),
  );

  try {
    const disk = loadDiskMigrations(directory);
    // Parse only; throws on malformed SQL before opening a DB session.
    readMigrationSqlByFile(disk.all);

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

        logger.emit(
          events.validationSummary({
            nextDownCount: nextDown.length,
            pendingUpCount: pendingUp.length,
            rollbackableDownCount: appliedRows.length,
          }),
        );
      },
    });

    logger.emit(events.runCompleted("validate"));
  } catch (error) {
    logger.emit(events.runAborted({ command: "validate", error }));
    throw error;
  }
}
