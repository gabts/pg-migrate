import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

export function planUpExecution(args: {
  disk: LoadedMigrations;
  latestApplied: AppliedRow | null;
  targetMigration: DiskMigration | null;
}): DiskMigration[] {
  const latestAppliedIndex = args.latestApplied?.index ?? -1;
  const targetIndex = args.targetMigration?.index ?? Number.POSITIVE_INFINITY;

  return args.disk.all.filter(
    ({ index }): boolean => index > latestAppliedIndex && index <= targetIndex,
  );
}

export function planDownExecution(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  targetMigration: DiskMigration | null;
}): DiskMigration[] {
  const { appliedRows, disk, targetMigration } = args;
  let rowsToRollback: AppliedRow[];

  if (!targetMigration) {
    rowsToRollback = appliedRows[0] ? [appliedRows[0]] : [];
  } else {
    const targetPosition = appliedRows.findIndex(
      ({ file }): boolean => file === targetMigration.file,
    );
    rowsToRollback = appliedRows.slice(0, targetPosition);
  }

  return rowsToRollback.map(
    ({ file }): DiskMigration => disk.byFile.get(file)!,
  );
}
