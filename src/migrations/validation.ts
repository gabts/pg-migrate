import {
  getMigrationVersion,
  isMigrationFilename,
  isMigrationVersion,
} from "./naming.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

/**
 * Validates basic invariants for rows read from migration history.
 */
export function validateAppliedHistory(rows: AppliedRow[]): void {
  const seenVersions = new Set<string>();

  for (const { version } of rows) {
    if (typeof version !== "string" || !isMigrationVersion(version)) {
      throw new Error(`Invalid applied migration version: ${version}`);
    }

    if (seenVersions.has(version)) {
      throw new Error(`Duplicate applied migration version: ${version}`);
    }

    seenVersions.add(version);
  }
}

/**
 * Ensures each applied migration version still exists on disk.
 */
export function validateAppliedVersionsExistOnDisk(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): void {
  const diskVersions = new Set(
    disk.all.map(({ file }): string => getMigrationVersion(file)),
  );

  for (const { version } of appliedRows) {
    if (!diskVersions.has(version)) {
      throw new Error(
        `Applied migration version is missing on disk: ${version}`,
      );
    }
  }
}

function getAppliedVersions(appliedRows: AppliedRow[]): Set<string> {
  return new Set(appliedRows.map(({ version }): string => version));
}

function getLatestAppliedMigration(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): DiskMigration | null {
  const appliedVersions = getAppliedVersions(appliedRows);
  let latestApplied: DiskMigration | null = null;

  for (const migration of disk.all) {
    if (appliedVersions.has(getMigrationVersion(migration.file))) {
      latestApplied = migration;
    }
  }

  return latestApplied;
}

function validateAppliedHistoryConsistency(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): DiskMigration | null {
  validateAppliedVersionsExistOnDisk(appliedRows, disk);

  const latestAppliedMigration = getLatestAppliedMigration(appliedRows, disk);
  if (!latestAppliedMigration) {
    return null;
  }

  const appliedVersions = getAppliedVersions(appliedRows);

  // Applied migrations must always form a contiguous prefix of disk migrations.
  for (const migration of disk.all) {
    if (!appliedVersions.has(getMigrationVersion(migration.file))) {
      throw new Error(
        `Gap in applied migration history: "${migration.file}" is not applied, but migrations up to "${latestAppliedMigration.file}" have been applied`,
      );
    }

    if (migration === latestAppliedMigration) break;
  }

  return latestAppliedMigration;
}

/**
 * Resolves a target string by version or canonical filename.
 */
export function resolveTargetMigration(
  target: string,
  disk: LoadedMigrations,
): DiskMigration {
  if (isMigrationVersion(target)) {
    const migration = disk.all.find(
      ({ file }): boolean => getMigrationVersion(file) === target,
    );
    if (!migration) {
      throw new Error(`No migration found for target version "${target}"`);
    }
    return migration;
  }

  if (isMigrationFilename(target)) {
    const migration = disk.byFile.get(target);
    if (!migration) {
      throw new Error(`No migration found for target file "${target}"`);
    }
    return migration;
  }

  throw new Error(
    `Invalid target "${target}". Expected <YYYYMMDDHHMMSS> or <YYYYMMDDHHMMSS>_<slug>.sql`,
  );
}

function validateTargetMigrationLoaded(
  targetMigration: DiskMigration,
  disk: LoadedMigrations,
): void {
  if (disk.byFile.get(targetMigration.file) !== targetMigration) {
    throw new Error(
      `Target migration object does not belong to the loaded disk set: ${targetMigration.file}`,
    );
  }
}

/**
 * Validates preconditions for rollback planning.
 */
export function validateDownPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  targetMigration?: DiskMigration | null;
}): void {
  const { appliedRows, disk, targetMigration = null } = args;
  validateAppliedHistoryConsistency(appliedRows, disk);

  if (!targetMigration) {
    return;
  }

  validateTargetMigrationLoaded(targetMigration, disk);

  const appliedVersions = getAppliedVersions(appliedRows);
  if (!appliedVersions.has(getMigrationVersion(targetMigration.file))) {
    throw new Error(`Target migration is not applied: ${targetMigration.file}`);
  }
}

/**
 * Validates preconditions for apply planning and target bounds.
 */
export function validateUpPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  targetMigration?: DiskMigration | null;
}): {
  latestAppliedMigration: DiskMigration | null;
} {
  const { appliedRows, disk, targetMigration = null } = args;
  const latestAppliedMigration = validateAppliedHistoryConsistency(
    appliedRows,
    disk,
  );

  if (targetMigration) {
    validateTargetMigrationLoaded(targetMigration, disk);
  }

  if (latestAppliedMigration) {
    if (targetMigration === latestAppliedMigration) {
      return {
        latestAppliedMigration,
      };
    }

    if (
      targetMigration &&
      disk.all.indexOf(targetMigration) <
        disk.all.indexOf(latestAppliedMigration)
    ) {
      throw new Error(
        `Target migration "${targetMigration.file}" is behind latest applied migration "${latestAppliedMigration.file}"`,
      );
    }
  }

  return {
    latestAppliedMigration,
  };
}
