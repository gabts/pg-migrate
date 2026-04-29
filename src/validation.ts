import { getMigrationVersion } from "./migration-naming.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

/**
 * Validates basic invariants for rows read from migration history.
 */
export function validateAppliedHistory(rows: AppliedRow[]): void {
  const seenFiles = new Set<string>();
  const seenVersions = new Set<string>();

  for (const { filename, version } of rows) {
    if (typeof filename !== "string" || filename.length === 0) {
      throw new Error(`Invalid applied migration file: ${filename}`);
    }

    if (seenFiles.has(filename)) {
      throw new Error(`Duplicate applied migration file: ${filename}`);
    }

    seenFiles.add(filename);

    if (typeof version !== "string" || version.length === 0) {
      throw new Error(
        `Invalid applied migration version for file "${filename}": ${version}`,
      );
    }

    if (seenVersions.has(version)) {
      throw new Error(`Duplicate applied migration version: ${version}`);
    }

    seenVersions.add(version);
  }
}

/**
 * Ensures each applied migration filename still exists on disk.
 */
export function validateAppliedFilesExistOnDisk(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): void {
  for (const { filename } of appliedRows) {
    if (!disk.byFile.has(filename)) {
      throw new Error(`Applied migration file is missing on disk: ${filename}`);
    }
  }
}

function validateAppliedVersionsMatchDisk(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): void {
  for (const { filename, version } of appliedRows) {
    const expectedVersion = getMigrationVersion(
      disk.byFile.get(filename)!.file,
    );
    if (version !== expectedVersion) {
      throw new Error(
        `Applied migration version mismatch for file "${filename}": expected "${expectedVersion}", got "${version}"`,
      );
    }
  }
}

function getAppliedFiles(appliedRows: AppliedRow[]): Set<string> {
  return new Set(appliedRows.map(({ filename }): string => filename));
}

function getLatestAppliedMigration(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): DiskMigration | null {
  const appliedFiles = getAppliedFiles(appliedRows);
  let latestApplied: DiskMigration | null = null;

  for (const migration of disk.all) {
    if (appliedFiles.has(migration.file)) {
      latestApplied = migration;
    }
  }

  return latestApplied;
}

function validateAppliedHistoryConsistency(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): DiskMigration | null {
  validateAppliedFilesExistOnDisk(appliedRows, disk);
  validateAppliedVersionsMatchDisk(appliedRows, disk);

  const latestAppliedMigration = getLatestAppliedMigration(appliedRows, disk);
  if (!latestAppliedMigration) {
    return null;
  }

  const appliedFiles = getAppliedFiles(appliedRows);

  // Applied migrations must always form a contiguous prefix of disk migrations.
  for (const migration of disk.all) {
    if (!appliedFiles.has(migration.file)) {
      throw new Error(
        `Gap in applied migration history: "${migration.file}" is not applied, but migrations up to "${latestAppliedMigration.file}" have been applied`,
      );
    }

    if (migration === latestAppliedMigration) break;
  }

  return latestAppliedMigration;
}

/**
 * Validates preconditions for rollback planning and resolves target.
 */
export function validateDownPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;
  validateAppliedHistoryConsistency(appliedRows, disk);

  if (!target) {
    return { targetMigration: null };
  }

  const targetMigration = disk.byFile.get(target);
  if (!targetMigration) {
    throw new Error(`No such target file "${target}"`);
  }

  const appliedFiles = getAppliedFiles(appliedRows);
  if (!appliedFiles.has(target)) {
    throw new Error(`Target migration is not applied: ${target}`);
  }

  return { targetMigration };
}

/**
 * Validates preconditions for apply planning and resolves target bounds.
 */
export function validateUpPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  latestAppliedMigration: DiskMigration | null;
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;
  const latestAppliedMigration = validateAppliedHistoryConsistency(
    appliedRows,
    disk,
  );
  const targetMigration = target ? disk.byFile.get(target) : undefined;

  if (target && !targetMigration) {
    throw new Error(`No such target file "${target}"`);
  }

  if (latestAppliedMigration) {
    if (targetMigration === latestAppliedMigration) {
      return {
        latestAppliedMigration,
        targetMigration,
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
    targetMigration: targetMigration ?? null,
  };
}
