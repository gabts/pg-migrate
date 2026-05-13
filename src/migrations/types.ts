/**
 * Metadata for a migration file discovered on disk.
 */
export interface DiskMigration {
  file: string;
  path: string;
}

/**
 * Collection of disk migrations in both ordered and keyed form.
 */
export interface LoadedMigrations {
  all: DiskMigration[];
  byFile: Map<string, DiskMigration>;
}

/**
 * Executable SQL step for a single migration file.
 */
export interface MigrationStep {
  file: string;
  sql: string;
}

/**
 * Row shape read from the migration history table.
 */
export interface AppliedRow {
  version: string;
}

/**
 * Row shape read from the migration history table for status output.
 */
export interface AppliedStatusRow extends AppliedRow {
  appliedAt: Date | string;
}
