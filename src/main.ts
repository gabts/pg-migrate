import {
  validateAppliedFiles,
  validateMigrationConsistency,
} from "./migration/consistency.js";
import {
  createDatabaseClient,
  withHistoryTable,
} from "./migration/database.js";
import { executeMigrations } from "./migration/execute.js";
import { readMigrationIndex } from "./migration/files.js";
import {
  lockMigrations,
  readHistory,
  recordMigrationEvent,
  validateHistoryTableName,
} from "./migration/history.js";
import { withSafeLog } from "./migration/log.js";
import type {
  DatabaseOptions,
  MigrateOptions,
  MigrateResult,
  RepairOptions,
  RepairResult,
  StatusResult,
  ValidationResult,
} from "./migration/model.js";
import { findMigrationTarget, planDown, planUp } from "./migration/plan.js";
import {
  parseMigrationSql,
  readValidatedMigrationSql,
} from "./migration/sql.js";

export type {
  DatabaseOptions,
  LogEvent,
  LogSink,
  MigrateOptions,
  MigrateResult,
  RepairOptions,
  RepairResult,
  StatusResult,
  ValidationResult,
} from "./migration/model.js";

/** Reports the state of migration files and database history. */
export async function status(input: DatabaseOptions): Promise<StatusResult> {
  const options = withSafeLog(input);
  const client = createDatabaseClient(options.url);
  validateHistoryTableName(options.table);
  const migrationIndex = await readMigrationIndex(
    options.directory,
    options.log,
  );

  return withHistoryTable(
    client,
    options.table,
    options.log,
    async (historyTable): Promise<StatusResult> => {
      const history = await readHistory(client, historyTable, options.log);
      await validateAppliedFiles(migrationIndex, history.applied, options.log);

      const appliedByVersion = new Map(
        history.applied.map(
          (migration) => [migration.version, migration] as const,
        ),
      );
      const migrations = migrationIndex.all.map(
        (migration): StatusResult["migrations"][number] => {
          const appliedMigration = appliedByVersion.get(migration.version);
          return {
            appliedAt: appliedMigration?.appliedAt ?? null,
            file: migration.file,
            name: migration.name,
            state: appliedMigration ? "applied" : "pending",
            version: migration.version,
          };
        },
      );
      const appliedMigrations = migrations.filter(
        (migration) => migration.state === "applied",
      );
      const pendingMigrations = migrations.filter(
        (migration) => migration.state === "pending",
      );
      return {
        current: appliedMigrations[appliedMigrations.length - 1] ?? null,
        directory: options.directory,
        initialized: history.initialized,
        migrations,
        next: pendingMigrations[0] ?? null,
        summary: {
          applied: appliedMigrations.length,
          pending: pendingMigrations.length,
          total: migrations.length,
        },
        table: options.table,
      };
    },
  );
}

/** Validates migration file structure and database history. */
export async function validate(
  input: DatabaseOptions,
): Promise<ValidationResult> {
  const options = withSafeLog(input);
  const client = createDatabaseClient(options.url);
  validateHistoryTableName(options.table);
  const migrationIndex = await readMigrationIndex(
    options.directory,
    options.log,
  );
  await readValidatedMigrationSql(migrationIndex.all, options.log);

  return withHistoryTable(
    client,
    options.table,
    options.log,
    async (historyTable): Promise<ValidationResult> => {
      await lockMigrations(client, historyTable, options.log);
      const history = await readHistory(client, historyTable, options.log);
      await validateAppliedFiles(migrationIndex, history.applied, options.log);
      return {
        applied: history.applied.length,
        pending: migrationIndex.all.length - history.applied.length,
        total: migrationIndex.all.length,
      };
    },
  );
}

/** Applies pending migrations through an optional target. */
export async function migrate(input: MigrateOptions): Promise<MigrateResult> {
  const options = withSafeLog(input);
  const client = createDatabaseClient(options.url);
  validateHistoryTableName(options.table);
  const migrationIndex = await readMigrationIndex(
    options.directory,
    options.log,
  );
  const target =
    options.target === undefined
      ? null
      : findMigrationTarget(options.target, migrationIndex, options.log);

  return withHistoryTable(
    client,
    options.table,
    options.log,
    async (historyTable): Promise<MigrateResult> => {
      await lockMigrations(client, historyTable, options.log);
      const history = await readHistory(client, historyTable, options.log);
      await validateAppliedFiles(migrationIndex, history.applied, options.log);

      const plan = planUp(migrationIndex, history.applied, target, options.log);
      if (plan.length === 0) {
        options.log({ type: target ? "target-current" : "no-pending" });
        return { files: [] };
      }

      const sourceByFile = await readValidatedMigrationSql(plan, options.log);
      const sqlByFile = parseMigrationSql(sourceByFile);
      return await executeMigrations(client, plan, sqlByFile, {
        direction: "up",
        initialized: history.initialized,
        log: options.log,
        qualifiedTable: historyTable.qualifiedName,
        table: options.table,
      });
    },
  );
}

/** Reverts one migration or migrations after an optional target. */
export async function rollback(input: MigrateOptions): Promise<MigrateResult> {
  const options = withSafeLog(input);
  const client = createDatabaseClient(options.url);
  validateHistoryTableName(options.table);
  const migrationIndex = await readMigrationIndex(
    options.directory,
    options.log,
  );
  const target =
    options.target === undefined
      ? null
      : findMigrationTarget(options.target, migrationIndex, options.log);

  return withHistoryTable(
    client,
    options.table,
    options.log,
    async (historyTable): Promise<MigrateResult> => {
      await lockMigrations(client, historyTable, options.log);
      const history = await readHistory(client, historyTable, options.log);
      const checksums = await validateAppliedFiles(
        migrationIndex,
        history.applied,
        options.log,
      );

      const plan = planDown(
        migrationIndex,
        history.applied,
        target,
        options.log,
      );
      if (plan.length === 0) {
        options.log({ type: target ? "target-current" : "no-applied" });
        return { files: [] };
      }

      const sourceByFile = await readValidatedMigrationSql(plan, options.log);
      // Use the bytes that supply rollback SQL for the final checksum check.
      for (const [file, source] of sourceByFile) {
        checksums.set(file, source.checksum);
      }
      validateMigrationConsistency(migrationIndex, history.applied, checksums);
      const sqlByFile = parseMigrationSql(sourceByFile);
      return await executeMigrations(client, plan, sqlByFile, {
        direction: "down",
        initialized: history.initialized,
        log: options.log,
        qualifiedTable: historyTable.qualifiedName,
        table: options.table,
      });
    },
  );
}

/** Records the current file and checksum of one applied migration. */
export async function repair(input: RepairOptions): Promise<RepairResult> {
  const options = withSafeLog(input);
  const client = createDatabaseClient(options.url);
  validateHistoryTableName(options.table);
  const migrationIndex = await readMigrationIndex(
    options.directory,
    options.log,
  );
  const target = findMigrationTarget(
    options.target,
    migrationIndex,
    options.log,
  );

  return withHistoryTable(
    client,
    options.table,
    options.log,
    async (historyTable): Promise<RepairResult> => {
      await lockMigrations(client, historyTable, options.log);
      const history = await readHistory(client, historyTable, options.log);

      // Other applied migrations are not checked, so that several edited
      // files can be repaired one at a time.
      const record = history.applied.find(
        (migration) => migration.version === target.version,
      );
      if (!record) {
        throw new Error(`Migration target '${target.file}' is not applied.`);
      }
      const sourceByFile = await readValidatedMigrationSql(
        [target],
        options.log,
      );
      const checksum = sourceByFile.get(target.file)!.checksum;
      if (record.file === target.file && record.checksum === checksum) {
        throw new Error(
          `Applied migration file '${target.file}' already matches its ` +
            "history.",
        );
      }

      options.log({ file: target.file, type: "repair-start" });
      try {
        await recordMigrationEvent(
          client,
          historyTable.qualifiedName,
          "repair",
          target.version,
          target.file,
          checksum,
        );
      } catch (error) {
        throw new Error(`Failed to repair migration '${target.file}'.`, {
          cause: error,
        });
      }
      options.log({ file: target.file, type: "repair-done" });
      return { file: target.file };
    },
  );
}
