import {
  isMigrationFilename,
  isMigrationVersion,
  type DiskMigration,
  type MigrationIndex,
} from "./files.js";
import type { AppliedMigration } from "./history.js";
import type { LogSink } from "./model.js";

function getAppliedVersions(applied: AppliedMigration[]): Set<string> {
  return new Set(applied.map((migration) => migration.version));
}

function findLatestApplied(
  migrationIndex: MigrationIndex,
  appliedVersions: Set<string>,
): DiskMigration | undefined {
  return migrationIndex.all.findLast((migration) =>
    appliedVersions.has(migration.version),
  );
}

function validateMigrationTarget(target: string): void {
  if (!isMigrationVersion(target) && !isMigrationFilename(target)) {
    throw new Error(
      `Invalid migration target '${target}', expected a version or filename.`,
    );
  }
}

/** Validates and finds a migration target by version or filename. */
export function findMigrationTarget(
  target: string,
  migrationIndex: MigrationIndex,
  log: LogSink = (): undefined => undefined,
): DiskMigration {
  log({ target, type: "target-resolve-start" });
  validateMigrationTarget(target);
  const migration = isMigrationVersion(target)
    ? migrationIndex.byVersion.get(target)
    : migrationIndex.byFile.get(target);

  if (!migration) {
    throw new Error(`Migration target '${target}' does not exist.`);
  }
  log({ file: migration.file, type: "target-resolve-done" });
  return migration;
}

function validateUpPlan(
  migrationIndex: MigrationIndex,
  applied: AppliedMigration[],
  target: DiskMigration | null,
): void {
  if (!target) {
    return;
  }

  const appliedVersions = getAppliedVersions(applied);
  const latestApplied = findLatestApplied(migrationIndex, appliedVersions);
  if (
    latestApplied &&
    migrationIndex.all.indexOf(target) <
      migrationIndex.all.indexOf(latestApplied)
  ) {
    throw new Error(
      `Migration target '${target.file}' is behind the latest applied ` +
        `migration '${latestApplied.file}'.`,
    );
  }
}

function validateDownPlan(
  applied: AppliedMigration[],
  target: DiskMigration | null,
): void {
  if (!target) {
    return;
  }

  const appliedVersions = getAppliedVersions(applied);
  if (!appliedVersions.has(target.version)) {
    throw new Error(`Migration target '${target.file}' is not applied.`);
  }
}

/** Plans migrations to apply without changing the database. */
export function planUp(
  migrationIndex: MigrationIndex,
  applied: AppliedMigration[],
  target: DiskMigration | null,
  log: LogSink = (): undefined => undefined,
): DiskMigration[] {
  log({ direction: "up", type: "plan-start" });
  validateUpPlan(migrationIndex, applied, target);
  const appliedVersions = getAppliedVersions(applied);
  const latestApplied = findLatestApplied(migrationIndex, appliedVersions);

  const start = latestApplied
    ? migrationIndex.all.indexOf(latestApplied) + 1
    : 0;
  const end = target
    ? migrationIndex.all.indexOf(target) + 1
    : migrationIndex.all.length;
  const plan = migrationIndex.all.slice(start, end);
  log({ count: plan.length, direction: "up", type: "plan-done" });
  return plan;
}

/** Plans migrations to revert without changing the database. */
export function planDown(
  migrationIndex: MigrationIndex,
  appliedHistory: AppliedMigration[],
  target: DiskMigration | null,
  log: LogSink = (): undefined => undefined,
): DiskMigration[] {
  log({ direction: "down", type: "plan-start" });
  validateDownPlan(appliedHistory, target);
  const appliedVersions = getAppliedVersions(appliedHistory);
  const applied = migrationIndex.all.filter((migration) =>
    appliedVersions.has(migration.version),
  );

  if (!target) {
    const latest = applied[applied.length - 1];
    const plan = latest ? [latest] : [];
    log({ count: plan.length, direction: "down", type: "plan-done" });
    return plan;
  }
  const plan = applied.slice(applied.indexOf(target) + 1).reverse();
  log({ count: plan.length, direction: "down", type: "plan-done" });
  return plan;
}
