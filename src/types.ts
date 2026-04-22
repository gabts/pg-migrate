import type * as pg from "pg";

export interface DiskMigration {
  file: string;
  path: string;
}

export interface LoadedMigrations {
  all: DiskMigration[];
  byFile: Map<string, DiskMigration>;
}

export interface MigrationStep {
  file: string;
  sql: string;
}

export type MigrationDirection = "up" | "down";

export interface ParsedMigrationSql {
  down: string;
  up: string;
}

export interface AppliedRow {
  filename: string;
  version: string;
}

export type ClientConfig = string | pg.ClientConfig;
