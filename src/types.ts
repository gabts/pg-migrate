import type * as pg from "pg";

export interface DiskMigration {
  file: string;
  index: number;
  path: string;
}

export interface LoadedMigrations {
  all: DiskMigration[];
  byFile: Map<string, DiskMigration>;
}

export interface MigrationStep {
  file: string;
  index: number;
  sql: string;
}

export interface AppliedRow {
  file: string;
  index: number;
}

export type ClientConfig = string | pg.ClientConfig;
export type LogFn = (...args: any[]) => void;
