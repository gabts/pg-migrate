import {
  durationMsToNs,
  normalizeError,
  type LogFields,
  type LogRecord,
} from "./schema.js";

type MigrationCommand = "down" | "status" | "up" | "validate";
type MigrationDirection = "down" | "up";

function displayName(file: string): string {
  return file.replace(/\.sql$/, "");
}

function migrationVersion(file: string): string {
  const separatorIndex = file.indexOf("_");
  return separatorIndex === -1 ? file : file.slice(0, separatorIndex);
}

function migrationData(
  file: string,
  direction?: MigrationDirection,
): LogFields {
  return {
    migration: {
      ...(direction === undefined ? {} : { direction }),
      file,
      name: displayName(file),
      version: migrationVersion(file),
    },
  };
}

function commandLabel(command: MigrationCommand): string {
  switch (command) {
    case "up":
      return "Migration run";
    case "down":
      return "Rollback";
    case "status":
      return "Status";
    case "validate":
      return "Validation";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function logRecord(args: {
  action: string;
  domainFields?: LogFields;
  durationMs?: number;
  error?: unknown;
  level: LogRecord["level"];
  message: string;
  outcome?: LogRecord["event"]["outcome"];
}): LogRecord {
  return {
    ...(args.error === undefined ? {} : { error: normalizeError(args.error) }),
    event: {
      action: args.action,
      ...(args.durationMs === undefined
        ? {}
        : { duration: durationMsToNs(args.durationMs) }),
      ...(args.outcome === undefined ? {} : { outcome: args.outcome }),
    },
    ...(args.domainFields === undefined
      ? {}
      : {
          fields: {
            migratorosaurus: args.domainFields,
          },
        }),
    level: args.level,
    message: args.message,
  };
}

/**
 * Builders for structured runtime log events.
 */
export const events = {
  commandFailed: (args: {
    command: MigrationCommand | "create" | null;
    error: unknown;
  }): LogRecord =>
    logRecord({
      action: "command.failed",
      domainFields: {
        command: args.command,
      },
      error: args.error,
      level: "error",
      message: errorMessage(args.error),
      outcome: "failure",
    }),

  commandOptions: (data: Record<string, unknown>): LogRecord =>
    logRecord({
      action: "command.options",
      domainFields: data,
      level: "debug",
      message: "Command options parsed",
    }),

  historyTableCreating: (table: string): LogRecord =>
    logRecord({
      action: "migration_history_table.creating",
      domainFields: {
        table,
      },
      level: "info",
      message: "Creating migration history table",
    }),

  migrationApplied: (args: { durationMs: number; file: string }): LogRecord =>
    logRecord({
      action: "migration.applied",
      domainFields: migrationData(args.file, "up"),
      durationMs: args.durationMs,
      level: "info",
      message: "Migration applied",
      outcome: "success",
    }),

  migrationApplying: (file: string): LogRecord =>
    logRecord({
      action: "migration.applying",
      domainFields: migrationData(file, "up"),
      level: "info",
      message: "Applying migration",
    }),

  migrationFailed: (args: {
    direction: MigrationDirection;
    durationMs: number;
    error: unknown;
    file: string;
  }): LogRecord =>
    logRecord({
      action: "migration.failed",
      domainFields: migrationData(args.file, args.direction),
      durationMs: args.durationMs,
      error: args.error,
      level: "error",
      message: "Migration failed",
      outcome: "failure",
    }),

  migrationReverted: (args: {
    durationMs: number;
    file: string;
    hasSql: boolean;
  }): LogRecord =>
    logRecord({
      action: "migration.reverted",
      domainFields: {
        ...migrationData(args.file, "down"),
        has_sql: args.hasSql,
      },
      durationMs: args.durationMs,
      level: "info",
      message: "Migration reverted",
      outcome: "success",
    }),

  migrationReverting: (args: { file: string; hasSql: boolean }): LogRecord =>
    logRecord({
      action: "migration.reverting",
      domainFields: {
        ...migrationData(args.file, "down"),
        has_sql: args.hasSql,
      },
      level: "info",
      message: "Reverting migration",
    }),

  migrationTransactionRolledBack: (args: {
    direction: MigrationDirection;
    file: string;
  }): LogRecord =>
    logRecord({
      action: "migration_transaction.rolled_back",
      domainFields: migrationData(args.file, args.direction),
      level: "warn",
      message: "Migration transaction rolled back",
      outcome: "success",
    }),

  noMigrationsToRollback: (): LogRecord =>
    logRecord({
      action: "rollback.noop",
      level: "info",
      message: "No migrations to roll back",
      outcome: "success",
    }),

  migrationStepsPlanned: (count: number): LogRecord =>
    logRecord({
      action: "migrations.planned",
      domainFields: {
        step_count: count,
      },
      level: "info",
      message: "Migration steps planned",
    }),

  runAborted: (args: {
    command: MigrationCommand;
    error: unknown;
  }): LogRecord =>
    logRecord({
      action: `${args.command}.aborted`,
      domainFields: {
        command: args.command,
      },
      error: args.error,
      level: "error",
      message: `${commandLabel(args.command)} aborted`,
      outcome: "failure",
    }),

  runCompleted: (command: MigrationCommand): LogRecord =>
    logRecord({
      action: `${command}.completed`,
      domainFields: {
        command,
      },
      level: "info",
      message: `${commandLabel(command)} completed`,
      outcome: "success",
    }),

  runStarted: (args: {
    command: MigrationCommand;
    directory: string;
    dryRun?: boolean;
    table: string;
    target?: string;
  }): LogRecord =>
    logRecord({
      action: `${args.command}.started`,
      domainFields: {
        command: args.command,
        directory: args.directory,
        ...(args.dryRun === undefined ? {} : { dry_run: args.dryRun }),
        table: args.table,
        ...(args.target === undefined ? {} : { target: args.target }),
      },
      level: "info",
      message: `${commandLabel(args.command)} started`,
    }),

  runTelemetry: (data: Record<string, unknown>): LogRecord =>
    logRecord({
      action: "run.options",
      domainFields: data,
      level: "debug",
      message: "Run options parsed",
    }),

  targetSelected: (file: string): LogRecord =>
    logRecord({
      action: "migration.target_selected",
      domainFields: migrationData(file),
      level: "info",
      message: "Target migration selected",
    }),

  statusSummary: (args: {
    appliedCount: number;
    initialized: boolean;
    pendingCount: number;
    totalCount: number;
  }): LogRecord =>
    logRecord({
      action: "status.summary",
      domainFields: {
        applied_count: args.appliedCount,
        initialized: args.initialized,
        pending_count: args.pendingCount,
        total_count: args.totalCount,
      },
      level: "info",
      message: "Status summary",
      outcome: "success",
    }),

  validationSummary: (args: {
    nextDownCount: number;
    pendingUpCount: number;
    rollbackableDownCount: number;
  }): LogRecord =>
    logRecord({
      action: "validation.summary",
      domainFields: {
        next_down_count: args.nextDownCount,
        pending_up_count: args.pendingUpCount,
        rollbackable_down_count: args.rollbackableDownCount,
      },
      level: "info",
      message: "Validation summary",
      outcome: "success",
    }),
};
