import type * as pg from "pg";

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
 * Supported migration execution direction.
 */
export type MigrationDirection = "up" | "down";

/**
 * Parsed `up` and `down` SQL sections for a migration file.
 */
export interface ParsedMigrationSql {
  down: string;
  up: string;
}

/**
 * Row shape read from the migration history table.
 */
export interface AppliedRow {
  filename: string;
  version: string;
}

/**
 * Allowed database client configuration inputs.
 */
export type ClientConfig = string | pg.ClientConfig;
