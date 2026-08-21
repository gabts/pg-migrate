import type { DiskMigration, MigrationIndex } from "./files.js";
import type { AppliedMigration } from "./history.js";
import type { LogSink } from "./model.js";

function validateAppliedMigration(
  migration: AppliedMigration,
  seenVersions: Set<string>,
  migrationIndex: MigrationIndex,
): void {
  if (seenVersions.has(migration.version)) {
    throw new Error(
      `Applied migration version '${migration.version}' is duplicated.`,
    );
  }
  if (!migrationIndex.byVersion.has(migration.version)) {
    throw new Error(
      `Applied migration version '${migration.version}' does not exist on ` +
        "disk.",
    );
  }
  seenVersions.add(migration.version);
}

function findLatestApplied(
  migrationIndex: MigrationIndex,
  appliedVersions: Set<string>,
): DiskMigration | null {
  return (
    migrationIndex.all.findLast((migration) =>
      appliedVersions.has(migration.version),
    ) ?? null
  );
}

function validateContinuousHistory(
  migrationIndex: MigrationIndex,
  appliedVersions: Set<string>,
): void {
  const latest = findLatestApplied(migrationIndex, appliedVersions);
  if (!latest) {
    return;
  }

  for (const migration of migrationIndex.all) {
    if (!appliedVersions.has(migration.version)) {
      throw new Error(
        `Migration history has a gap at '${migration.file}' before ` +
          `'${latest.file}'.`,
      );
    }
    if (migration === latest) {
      return;
    }
  }
}

/** Validates consistency between migration files and applied history. */
export function validateMigrationConsistency(
  migrationIndex: MigrationIndex,
  applied: AppliedMigration[],
  log: LogSink = (): undefined => undefined,
): void {
  log({ type: "consistency-validation-start" });
  const appliedVersions = new Set<string>();
  for (const migration of applied) {
    validateAppliedMigration(migration, appliedVersions, migrationIndex);
  }
  validateContinuousHistory(migrationIndex, appliedVersions);
  log({ type: "consistency-validation-done" });
}
