import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";
import { validateAppliedFilesExistOnDisk } from "./validation.js";

export function planUpExecution(args: {
  disk: LoadedMigrations;
  latestApplied: AppliedRow | null;
  targetMigration: DiskMigration | null;
}): DiskMigration[] {
  const latestAppliedIndex = args.latestApplied?.index ?? -1;
  const targetIndex = args.targetMigration?.index ?? Number.POSITIVE_INFINITY;

  return args.disk.all
    .filter(
      ({ index }): boolean =>
        index > latestAppliedIndex && index <= targetIndex,
    )
    .sort((a, b): number => a.index - b.index);
}

export function planDownExecution(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): DiskMigration[] {
  const { appliedRows, disk, target } = args;
  let rowsToRollback: AppliedRow[];

  if (!target) {
    rowsToRollback = appliedRows[0] ? [appliedRows[0]] : [];
  } else {
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

    rowsToRollback = appliedRows.slice(0, targetPosition);
  }

  validateAppliedFilesExistOnDisk(rowsToRollback, disk);
  return rowsToRollback.map(
    ({ file }): DiskMigration => disk.byFile.get(file)!,
  );
}
