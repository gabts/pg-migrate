interface StatusMigration {
  appliedAt: string | null;
  file: string;
  name: string;
  state: "applied" | "pending";
  version: string;
}

interface DatabaseDetails {
  database: string;
  host: string;
  port: number;
  user: string;
}

/** Status of the migration files and database history. */
export interface StatusResult {
  current: StatusMigration | null;
  directory: string;
  initialized: boolean;
  migrations: StatusMigration[];
  next: StatusMigration | null;
  summary: {
    applied: number;
    pending: number;
    total: number;
  };
  table: string;
}

/** Counts returned after successful migration validation. */
export interface ValidationResult {
  applied: number;
  pending: number;
  total: number;
}

/** Migration files executed by a migrate or rollback operation. */
export interface MigrateResult {
  files: string[];
}

/** A progress event emitted by the library. */
export type LogEvent =
  | { type: "directory-read-start"; directory: string }
  | { type: "directory-read-done"; directory: string }
  | { type: "filenames-validation-start" }
  | { type: "filenames-validation-done"; count: number }
  | { type: "checksum-calculation-start"; count: number }
  | { type: "checksum-calculation-done"; count: number }
  | { type: "sql-read-start"; count: number }
  | { type: "sql-read-done"; count: number }
  | { type: "sql-validation-start"; count: number }
  | { type: "sql-validation-done"; count: number }
  | { type: "database-connect-start"; database: DatabaseDetails }
  | { type: "database-connect-done"; database: DatabaseDetails }
  | { type: "database-disconnect-done"; database: DatabaseDetails }
  | { type: "lock-acquire-start"; table: string }
  | { type: "lock-acquire-done"; table: string }
  | { type: "history-definition-read-start"; table: string }
  | { type: "history-definition-read-done"; table: string }
  | { type: "history-definition-validation-start"; table: string }
  | { type: "history-definition-validation-done"; table: string }
  | { type: "applied-read-start"; table: string }
  | { type: "applied-read-done"; table: string; count: number }
  | { type: "target-resolve-start"; target: string }
  | {
      type: "target-resolve-done";
      file: string;
    }
  | { type: "consistency-validation-start" }
  | { type: "consistency-validation-done" }
  | { type: "plan-start"; direction: "up" | "down" }
  | {
      type: "plan-done";
      direction: "up" | "down";
      count: number;
    }
  | { type: "history-initialize-start"; table: string }
  | { type: "history-initialize-done"; table: string }
  | {
      type: "migration-start";
      file: string;
      direction: "up" | "down";
    }
  | {
      type: "migration-done";
      file: string;
      durationMs: number;
      direction: "up" | "down";
    }
  | {
      type: "migration-failed";
      file: string;
      durationMs: number;
      direction: "up" | "down";
    }
  | { type: "failed-migration-rollback-done" }
  | { type: "no-pending" }
  | { type: "no-applied" }
  | { type: "target-current" };

/** Receives progress events synchronously and returns no value. */
export type LogSink = (event: LogEvent) => void;

/** Options common to all database-connected operations. */
export interface DatabaseOptions {
  directory: string;
  log?: LogSink;
  table: string;
  url: string;
}

/** Options for applying or reverting migrations. */
export interface MigrateOptions extends DatabaseOptions {
  target?: string;
}
