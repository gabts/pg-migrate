import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

export function planUpExecution(args: {
  disk: LoadedMigrations;
  latestAppliedMigration: DiskMigration | null;
  targetMigration: DiskMigration | null;
}): DiskMigration[] {
  const startIndex = args.latestAppliedMigration
    ? args.disk.all.indexOf(args.latestAppliedMigration) + 1
    : 0;
  const endIndex = args.targetMigration
    ? args.disk.all.indexOf(args.targetMigration) + 1
    : args.disk.all.length;

  return args.disk.all.slice(startIndex, endIndex);
}

export function planDownExecution(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  targetMigration: DiskMigration | null;
}): DiskMigration[] {
  const { appliedRows, disk, targetMigration } = args;
  const appliedFiles = new Set(appliedRows.map(({ file }) => file));
  const appliedMigrations = disk.all
    .filter(({ file }): boolean => appliedFiles.has(file))
    .reverse();

  if (!targetMigration) {
    return appliedMigrations[0] ? [appliedMigrations[0]] : [];
  }

  const targetPosition = appliedMigrations.indexOf(targetMigration);
  if (targetPosition === -1) return [];

  return appliedMigrations.slice(0, targetPosition);
}
