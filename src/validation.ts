import {
  migrationFilePattern,
  parseMigrationIndex,
} from "./migration-files.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

export function validateAppliedHistory(rows: AppliedRow[]): void {
  let previousIndex: number | null = null;
  const seenFiles = new Set<string>();
  const seenIndexes = new Set<number>();

  for (const { file, index } of rows) {
    if (!Number.isInteger(index)) {
      throw new Error(`Invalid applied migration index for ${file}: ${index}`);
    }

    if (!file.match(migrationFilePattern)) {
      throw new Error(`Invalid applied migration file name: ${file}`);
    }

    const parsedIndex = parseMigrationIndex(file);
    if (index !== parsedIndex) {
      throw new Error(
        `Applied migration index mismatch for ${file}: expected ${parsedIndex}, found ${index}`,
      );
    }

    if (seenFiles.has(file)) {
      throw new Error(`Duplicate applied migration file: ${file}`);
    }

    if (seenIndexes.has(index)) {
      throw new Error(`Duplicate applied migration index: ${index}`);
    }

    if (previousIndex !== null && index >= previousIndex) {
      throw new Error("Applied migration history is not strictly descending");
    }

    seenFiles.add(file);
    seenIndexes.add(index);
    previousIndex = index;
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

export function validateDownPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;

  if (!target) {
    if (appliedRows[0]) {
      validateAppliedFilesExistOnDisk([appliedRows[0]], disk);
    }
    return { targetMigration: null };
  }

  const targetMigration = disk.byFile.get(target);
  if (!targetMigration) {
    throw new Error(`migratorosaurus: no such target file "${target}"`);
  }

  const targetPosition = appliedRows.findIndex(
    ({ file }): boolean => file === target,
  );
  if (targetPosition === -1) {
    throw new Error(`Target migration is not applied: ${target}`);
  }

  const rowsToRollback = appliedRows.slice(0, targetPosition);
  validateAppliedFilesExistOnDisk(rowsToRollback, disk);

  return { targetMigration };
}

export function validateUpPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  latestApplied: AppliedRow | null;
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;
  const appliedFiles = new Set(appliedRows.map(({ file }): string => file));
  const latestApplied = appliedRows[0] ?? null;
  const unappliedDiskMigrations = disk.all.filter(
    ({ file }): boolean => !appliedFiles.has(file),
  );
  const targetMigration = target ? disk.byFile.get(target) : undefined;

  if (target && !targetMigration) {
    throw new Error(`migratorosaurus: no such target file "${target}"`);
  }

  validateAppliedFilesExistOnDisk(appliedRows, disk);

  if (latestApplied) {
    // Verify applied migrations are contiguous: every disk migration at or
    // below the latest applied index must also be applied.
    const appliedIndices = new Set(appliedRows.map(({ index }) => index));
    for (const migration of disk.all) {
      if (migration.index > latestApplied.index) break;
      if (!appliedIndices.has(migration.index)) {
        throw new Error(
          `Gap in applied migration history: "${migration.file}" (index ${migration.index}) is not applied, but migrations up to index ${latestApplied.index} have been applied`,
        );
      }
    }

    if (targetMigration?.file === latestApplied.file) {
      return {
        latestApplied,
        targetMigration,
      };
    }

    if (
      targetMigration &&
      targetMigration.file !== latestApplied.file &&
      targetMigration.index < latestApplied.index
    ) {
      throw new Error(
        `Target migration "${targetMigration.file}" is behind latest applied migration "${latestApplied.file}"`,
      );
    }
  }

  return {
    latestApplied,
    targetMigration: targetMigration ?? null,
  };
}
