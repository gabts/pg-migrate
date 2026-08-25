import type { DiskMigration, MigrationIndex } from "./files.js";
import type { AppliedMigration } from "./history.js";
import type { LogSink } from "./model.js";

function validateAppliedMigration(
  migration: AppliedMigration,
  seenVersions: Set<string>,
  migrationIndex: MigrationIndex,
  checksums: Map<string, string>,
): void {
  if (seenVersions.has(migration.version)) {
    throw new Error(
      `Applied migration version '${migration.version}' is duplicated.`,
    );
  }
  const diskMigration = migrationIndex.byVersion.get(migration.version);
  if (!diskMigration) {
    throw new Error(
      `Applied migration version '${migration.version}' does not exist on ` +
        "disk.",
    );
  }
  if (migration.file !== diskMigration.file) {
    throw new Error(
      `Applied migration version '${migration.version}' was recorded with ` +
        `file '${migration.file}', not '${diskMigration.file}'.`,
    );
  }
  const checksum = checksums.get(diskMigration.file);
  if (!checksum) {
    throw new Error(
      `Checksum for migration file '${diskMigration.file}' is not available.`,
    );
  }
  if (migration.checksum !== checksum) {
    throw new Error(
      `Applied migration file '${diskMigration.file}' does not match its ` +
        "recorded checksum.",
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
  checksums: Map<string, string>,
  log: LogSink = (): undefined => undefined,
): void {
  log({ type: "consistency-validation-start" });
  const appliedVersions = new Set<string>();
  for (const migration of applied) {
    validateAppliedMigration(
      migration,
      appliedVersions,
      migrationIndex,
      checksums,
    );
  }
  validateContinuousHistory(migrationIndex, appliedVersions);
  log({ type: "consistency-validation-done" });
}
