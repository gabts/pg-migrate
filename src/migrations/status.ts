import { getMigrationName, getMigrationVersion } from "./naming.js";
import type {
  AppliedStatusRow,
  DiskMigration,
  LoadedMigrations,
} from "./types.js";

export type MigrationStatusState = "applied" | "pending";

export interface MigrationStatusItem {
  appliedAt: string | null;
  file: string;
  name: string;
  state: MigrationStatusState;
  version: string;
}

export interface MigrationStatusSummary {
  applied: number;
  pending: number;
  total: number;
}

export interface MigrationStatusResult {
  current: MigrationStatusItem | null;
  directory: string;
  initialized: boolean;
  migrations: MigrationStatusItem[];
  next: MigrationStatusItem | null;
  summary: MigrationStatusSummary;
  table: string;
}

function toAppliedAt(value: Date | string, file: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(
        `Invalid applied migration timestamp for file "${file}": ${value}`,
      );
    }

    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid applied migration timestamp for file "${file}": ${value}`,
    );
  }

  return parsed.toISOString();
}

function buildStatusItem(
  migration: DiskMigration,
  appliedRow: AppliedStatusRow | undefined,
): MigrationStatusItem {
  return {
    appliedAt:
      appliedRow === undefined
        ? null
        : toAppliedAt(appliedRow.appliedAt, migration.file),
    file: migration.file,
    name: getMigrationName(migration.file),
    state: appliedRow === undefined ? "pending" : "applied",
    version: getMigrationVersion(migration.file),
  };
}

/**
 * Builds the read-only migration status model from disk and history state.
 */
export function buildMigrationStatus(args: {
  appliedRows: AppliedStatusRow[];
  directory: string;
  disk: LoadedMigrations;
  initialized: boolean;
  table: string;
}): MigrationStatusResult {
  const { appliedRows, directory, disk, initialized, table } = args;
  const appliedByVersion = new Map(
    appliedRows.map((row): [string, AppliedStatusRow] => [row.version, row]),
  );
  const migrations = disk.all.map((migration): MigrationStatusItem => {
    return buildStatusItem(
      migration,
      appliedByVersion.get(getMigrationVersion(migration.file)),
    );
  });
  const applied = migrations.filter(
    ({ state }): boolean => state === "applied",
  );
  const pending = migrations.filter(
    ({ state }): boolean => state === "pending",
  );

  return {
    // Current means latest applied migration by disk order.
    current: applied[applied.length - 1] ?? null,
    directory,
    initialized,
    migrations,
    next: pending[0] ?? null,
    summary: {
      applied: applied.length,
      pending: pending.length,
      total: migrations.length,
    },
    table,
  };
}
