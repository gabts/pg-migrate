import { styleText } from "node:util";
import type {
  LogEvent,
  MigrateResult,
  StatusResult,
  ValidationResult,
} from "../main.js";
import type { CliLogEvent, Command } from "./model.js";

type DatabaseDetails = Extract<
  LogEvent,
  { type: "database-connect-start" }
>["database"];

// The caller determines color support for stderr. Disable the styleText
// check because it checks stdout.
function paint(
  format: Parameters<typeof styleText>[0],
  text: string,
  colors: boolean,
): string {
  return colors ? styleText(format, text, { validateStream: false }) : text;
}

function formatDatabaseAddress(database: DatabaseDetails): string {
  return database.host.startsWith("/")
    ? database.host
    : `${database.host}:${database.port}`;
}

function formatDatabase(database: DatabaseDetails): string {
  return (
    `'${database.database}' at '${formatDatabaseAddress(database)}' ` +
    `as '${database.user}'`
  );
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Formats a failure and an optional command-specific usage hint.
 */
export function formatError(
  message: string,
  colors: boolean,
  helpCommand?: Command | "help",
): string {
  const line = `${paint("red", "✖", colors)} Error: ${message}`;
  if (!helpCommand) {
    return line;
  }
  const command = helpCommand === "help" ? "" : `${helpCommand} `;
  return `${line}\n  Run \`pg-migrate ${command}--help\` for usage.`;
}

/** Formats the error cause after a migration failure line. */
export function formatFailureCause(message: string, colors: boolean): string {
  return `${paint("red", "Error", colors)}: '${message}'`;
}

/** Formats the final result of an up or down command. */
export function formatMigrate(
  result: MigrateResult,
  direction: "up" | "down",
): string | undefined {
  if (result.files.length === 0) {
    return undefined;
  }
  const migration = result.files.length === 1 ? "migration" : "migrations";
  const action = direction === "up" ? "applied" : "reverted";
  return `${result.files.length} ${migration} ${action}.`;
}

/** Formats migration status as terminal text. */
export function formatStatus(status: StatusResult): string {
  const summary =
    `${status.summary.applied} applied, ${status.summary.pending} pending, ` +
    `${status.summary.total} total.`;
  const migrations = status.migrations.map((migration) => {
    const state = migration.state === "applied" ? "✔ Applied" : "○ Pending";
    return `${state}  ${migration.file}`;
  });
  const notice = status.initialized
    ? []
    : ["History table is not initialized."];
  return [...notice, ...migrations, summary].join("\n");
}

/** Formats successful validation as terminal text. */
export function formatValidation(validation: ValidationResult): string {
  return (
    `✔ File structure and history are valid: ${validation.applied} applied, ` +
    `${validation.pending} pending, ${validation.total} total.`
  );
}

/** Formats a progress event as a human-readable message. */
export function formatEvent(event: CliLogEvent, colors: boolean): string {
  switch (event.type) {
    case "file-create-start":
      return `Creating migration in '${event.directory}'...`;
    case "directory-read-start":
      return `Reading migration directory '${event.directory}'...`;
    case "directory-read-done":
      return `${paint("gray", "›", colors)} Read migration directory '${event.directory}'.`;
    case "filenames-validation-start":
      return "Validating migration filenames...";
    case "filenames-validation-done":
      return (
        `${paint("gray", "›", colors)} Validated ` +
        `${formatCount(event.count, "migration filename")}.`
      );
    case "checksum-calculation-start":
      return `Calculating ${formatCount(event.count, "migration checksum")}...`;
    case "checksum-calculation-done":
      return (
        `${paint("gray", "›", colors)} Calculated ` +
        `${formatCount(event.count, "migration checksum")}.`
      );
    case "sql-read-start":
      return `Reading SQL from ${formatCount(event.count, "migration file")}...`;
    case "sql-read-done":
      return (
        `${paint("gray", "›", colors)} Read SQL from ` +
        `${formatCount(event.count, "migration file")}.`
      );
    case "sql-validation-start":
      return (
        `Validating structure of ` +
        `${formatCount(event.count, "migration file")}...`
      );
    case "sql-validation-done":
      return (
        `${paint("gray", "›", colors)} Validated structure of ` +
        `${formatCount(event.count, "migration file")}.`
      );
    case "database-connect-start":
      return `Connecting to ${formatDatabase(event.database)}...`;
    case "database-connect-done":
      return `${paint("gray", "›", colors)} Connected to ${formatDatabase(event.database)}.`;
    case "database-disconnect-done":
      return (
        `${paint("gray", "›", colors)} Disconnected from ` +
        `'${formatDatabaseAddress(event.database)}'.`
      );
    case "lock-acquire-start":
      return `Acquiring migration lock for '${event.table}'...`;
    case "lock-acquire-done":
      return `${paint("gray", "›", colors)} Acquired migration lock for '${event.table}'.`;
    case "history-definition-read-start":
      return `Reading migration history definition from '${event.table}'...`;
    case "history-definition-read-done":
      return `${paint("gray", "›", colors)} Read migration history definition from '${event.table}'.`;
    case "history-definition-validation-start":
      return `Validating migration history definition for '${event.table}'...`;
    case "history-definition-validation-done":
      return `${paint("gray", "›", colors)} Validated migration history definition for '${event.table}'.`;
    case "applied-read-start":
      return `Reading applied migrations from '${event.table}'...`;
    case "applied-read-done":
      return (
        `${paint("gray", "›", colors)} Read ` +
        `${formatCount(event.count, "applied migration")} from ` +
        `'${event.table}'.`
      );
    case "target-resolve-start":
      return `Resolving migration target '${event.target}'...`;
    case "target-resolve-done":
      return `${paint("gray", "›", colors)} Resolved migration target '${event.file}'.`;
    case "consistency-validation-start":
      return "Validating migration consistency...";
    case "consistency-validation-done":
      return `${paint("gray", "›", colors)} Validated migration consistency.`;
    case "plan-start":
      return `Planning migrations to ${event.direction === "up" ? "apply" : "revert"}...`;
    case "plan-done": {
      const migrations = event.count === 1 ? "migration" : "migrations";
      const action = event.direction === "up" ? "apply" : "revert";
      return (
        `${paint("gray", "›", colors)} Planned ${event.count} ${migrations} ` +
        `to ${action}.`
      );
    }
    case "history-initialize-start":
      return `Initializing migration history table '${event.table}'...`;
    case "history-initialize-done":
      return `${paint("gray", "›", colors)} Initialized migration history table '${event.table}'.`;
    case "migration-start":
      return `${event.direction === "up" ? "Applying" : "Reverting"} '${event.file}'...`;
    case "migration-done":
      return `${paint("green", "✔", colors)} ${event.direction === "up" ? "Applied" : "Reverted"} '${event.file}' (${event.durationMs}ms)`;
    case "migration-failed":
      return `${paint("red", "✖", colors)} Failed '${event.file}' (${event.durationMs}ms)`;
    case "failed-migration-rollback-done":
      return `${paint("gray", "›", colors)} Rolled back failed migration transaction.`;
    case "no-pending":
      return "No pending migrations.";
    case "no-applied":
      return "No applied migrations.";
    case "target-current":
      return "Migration target is already current.";
    case "file-created":
      return (
        `${paint("green", "✔", colors)} Created ${paint("cyan", event.path, colors)}\n` +
        `  Edit the file, then run \`pg-migrate up\` to apply it.`
      );
  }
}
