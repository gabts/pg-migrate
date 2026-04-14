import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

export function validateAppliedHistory(rows: AppliedRow[]): void {
  const seenFiles = new Set<string>();

  for (const { file } of rows) {
    if (typeof file !== "string" || file.length === 0) {
      throw new Error(`Invalid applied migration file: ${file}`);
    }

    if (seenFiles.has(file)) {
      throw new Error(`Duplicate applied migration file: ${file}`);
    }

    seenFiles.add(file);
  }
}

export function validateAppliedFilesExistOnDisk(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): void {
  for (const { file } of appliedRows) {
    if (!disk.byFile.has(file)) {
      throw new Error(`Applied migration file is missing on disk: ${file}`);
    }
  }
}

function getAppliedFiles(appliedRows: AppliedRow[]): Set<string> {
  return new Set(appliedRows.map(({ file }) => file));
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

export function validateDownPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;

  if (!target) {
    validateAppliedFilesExistOnDisk(appliedRows, disk);
    return { targetMigration: null };
  }

  const targetMigration = disk.byFile.get(target);
  if (!targetMigration) {
    throw new Error(`No such target file "${target}"`);
  }

  validateAppliedFilesExistOnDisk(appliedRows, disk);

  const appliedFiles = getAppliedFiles(appliedRows);
  if (!appliedFiles.has(target)) {
    throw new Error(`Target migration is not applied: ${target}`);
  }

  return { targetMigration };
}

export function validateUpPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  latestAppliedMigration: DiskMigration | null;
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;
  const appliedFiles = getAppliedFiles(appliedRows);
  const latestAppliedMigration = getLatestAppliedMigration(appliedRows, disk);
  const targetMigration = target ? disk.byFile.get(target) : undefined;

  if (target && !targetMigration) {
    throw new Error(`No such target file "${target}"`);
  }

  validateAppliedFilesExistOnDisk(appliedRows, disk);

  if (latestAppliedMigration) {
    // Verify applied migrations are contiguous: every disk migration at or
    // before the latest applied migration must also be applied.
    for (const migration of disk.all) {
      if (!appliedFiles.has(migration.file)) {
        throw new Error(
          `Gap in applied migration history: "${migration.file}" is not applied, but migrations up to "${latestAppliedMigration.file}" have been applied`,
        );
      }

      if (migration === latestAppliedMigration) break;
    }

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
