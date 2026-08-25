import * as pg from "pg";
import { readMigrationChecksums } from "./migration/checksum.js";
import { validateMigrationConsistency } from "./migration/consistency.js";
import { executeMigrations } from "./migration/execute.js";
import {
  readMigrationIndex,
  type DiskMigration,
  type MigrationIndex,
} from "./migration/files.js";
import {
  lockMigrations,
  readAppliedMigrations,
  readValidatedHistoryDefinition,
  resolveHistoryTable,
  validateHistoryTableName,
  type AppliedMigration,
} from "./migration/history.js";
import type {
  DatabaseOptions,
  LogEvent,
  LogSink,
  MigrateOptions,
  MigrateResult,
  StatusResult,
  ValidationResult,
} from "./migration/model.js";
import { findMigrationTarget, planDown, planUp } from "./migration/plan.js";
import {
  parseMigrationSql,
  readValidatedMigrationSql,
  type MigrationSource,
} from "./migration/sql.js";

export type {
  DatabaseOptions,
  LogEvent,
  LogSink,
  MigrateOptions,
  MigrateResult,
  StatusResult,
  ValidationResult,
} from "./migration/model.js";

function withSafeLog<T extends { log?: LogSink }>(
  options: T,
): T & { log: LogSink } {
  const { log } = options;

  return {
    ...options,
    log(event: LogEvent): undefined {
      // Progress output must not change command behavior.
      try {
        void Promise.resolve(log?.(event)).catch(() => {});
      } catch {}
    },
  };
}

function validateDatabaseUrl(url: string): void {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error(`Invalid value '${String(url)}' for 'url'.`);
  }
}

function getDatabaseDetails(
  client: pg.Client,
): Extract<LogEvent, { type: "database-connect-start" }>["database"] {
  return {
    database: client.database ?? "default database",
    host: client.host,
    port: client.port,
    user: client.user ?? "default user",
  };
}

function createDatabaseClient(url: string): pg.Client {
  validateDatabaseUrl(url);
  return new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
  });
}

function getAppliedDiskMigrations(
  migrationIndex: MigrationIndex,
  applied: AppliedMigration[],
): DiskMigration[] {
  const appliedVersions = new Set(
    applied.map((migration) => migration.version),
  );
  return migrationIndex.all.filter((migration) =>
    appliedVersions.has(migration.version),
  );
}

function updateMigrationChecksums(
  checksums: Map<string, string>,
  sourceByFile: Map<string, MigrationSource>,
): void {
  for (const [file, source] of sourceByFile) {
    checksums.set(file, source.checksum);
  }
}

async function connectDatabase(client: pg.Client, log: LogSink): Promise<void> {
  const database = getDatabaseDetails(client);
  log({ database, type: "database-connect-start" });
  await client.connect();
  log({ database, type: "database-connect-done" });
}

async function disconnectDatabase(
  client: pg.Client,
  log: LogSink,
): Promise<void> {
  await client.end();
  log({
    database: getDatabaseDetails(client),
    type: "database-disconnect-done",
  });
}

/** Reports the state of migration files and database history. */
export async function status(input: DatabaseOptions): Promise<StatusResult> {
  const options = withSafeLog(input);
  const client = createDatabaseClient(options.url);
  validateHistoryTableName(options.table);
  const migrationIndex = await readMigrationIndex(
    options.directory,
    options.log,
  );
  await connectDatabase(client, options.log);
  try {
    const historyTable = await resolveHistoryTable(client, options.table);
    const history = await readValidatedHistoryDefinition(
      client,
      historyTable.qualifiedName,
      options.table,
      options.log,
    );
    const applied = history.initialized
      ? await readAppliedMigrations(
          client,
          historyTable.qualifiedName,
          options.table,
          options.log,
        )
      : [];
    const checksums = await readMigrationChecksums(
      getAppliedDiskMigrations(migrationIndex, applied),
      options.log,
    );

    validateMigrationConsistency(
      migrationIndex,
      applied,
      checksums,
      options.log,
    );

    const appliedByVersion = new Map(
      applied.map((migration) => [migration.version, migration] as const),
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
  } finally {
    await disconnectDatabase(client, options.log);
  }
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
  await connectDatabase(client, options.log);
  try {
    const historyTable = await resolveHistoryTable(client, options.table);
    await lockMigrations(client, historyTable, options.log);
    const history = await readValidatedHistoryDefinition(
      client,
      historyTable.qualifiedName,
      options.table,
      options.log,
    );
    const applied = history.initialized
      ? await readAppliedMigrations(
          client,
          historyTable.qualifiedName,
          options.table,
          options.log,
        )
      : [];
    const checksums = await readMigrationChecksums(
      getAppliedDiskMigrations(migrationIndex, applied),
      options.log,
    );

    validateMigrationConsistency(
      migrationIndex,
      applied,
      checksums,
      options.log,
    );
    return {
      applied: applied.length,
      pending: migrationIndex.all.length - applied.length,
      total: migrationIndex.all.length,
    };
  } finally {
    await disconnectDatabase(client, options.log);
  }
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

  let target: DiskMigration | null = null;
  if (options.target !== undefined) {
    target = findMigrationTarget(options.target, migrationIndex, options.log);
  }
  await connectDatabase(client, options.log);
  try {
    const historyTable = await resolveHistoryTable(client, options.table);
    await lockMigrations(client, historyTable, options.log);
    const history = await readValidatedHistoryDefinition(
      client,
      historyTable.qualifiedName,
      options.table,
      options.log,
    );
    const applied = history.initialized
      ? await readAppliedMigrations(
          client,
          historyTable.qualifiedName,
          options.table,
          options.log,
        )
      : [];
    const checksums = await readMigrationChecksums(
      getAppliedDiskMigrations(migrationIndex, applied),
      options.log,
    );

    validateMigrationConsistency(
      migrationIndex,
      applied,
      checksums,
      options.log,
    );

    const plan = planUp(migrationIndex, applied, target, options.log);
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
  } finally {
    await disconnectDatabase(client, options.log);
  }
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

  let target: DiskMigration | null = null;
  if (options.target !== undefined) {
    target = findMigrationTarget(options.target, migrationIndex, options.log);
  }
  await connectDatabase(client, options.log);
  try {
    const historyTable = await resolveHistoryTable(client, options.table);
    await lockMigrations(client, historyTable, options.log);
    const history = await readValidatedHistoryDefinition(
      client,
      historyTable.qualifiedName,
      options.table,
      options.log,
    );
    const applied = history.initialized
      ? await readAppliedMigrations(
          client,
          historyTable.qualifiedName,
          options.table,
          options.log,
        )
      : [];
    const checksums = await readMigrationChecksums(
      getAppliedDiskMigrations(migrationIndex, applied),
      options.log,
    );

    validateMigrationConsistency(
      migrationIndex,
      applied,
      checksums,
      options.log,
    );

    const plan = planDown(migrationIndex, applied, target, options.log);
    if (plan.length === 0) {
      options.log({ type: target ? "target-current" : "no-applied" });
      return { files: [] };
    }

    const sourceByFile = await readValidatedMigrationSql(plan, options.log);
    // Use the bytes that supply rollback SQL for the final checksum check.
    updateMigrationChecksums(checksums, sourceByFile);
    validateMigrationConsistency(migrationIndex, applied, checksums);
    const sqlByFile = parseMigrationSql(sourceByFile);
    return await executeMigrations(client, plan, sqlByFile, {
      direction: "down",
      initialized: history.initialized,
      log: options.log,
      qualifiedTable: historyTable.qualifiedName,
      table: options.table,
    });
  } finally {
    await disconnectDatabase(client, options.log);
  }
}
