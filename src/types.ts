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

export interface AppliedRow {
  file: string;
}

export type ClientConfig = string | pg.ClientConfig;
export type LogFn = (...args: any[]) => void;
