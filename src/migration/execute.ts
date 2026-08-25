import type * as pg from "pg";
import type { DiskMigration } from "./files.js";
import {
  createHistoryTable,
  recordAppliedMigration,
  removeAppliedMigration,
} from "./history.js";
import type { LogSink, MigrateResult } from "./model.js";
import type { MigrationSql } from "./sql.js";

interface ExecuteOptions {
  direction: "down" | "up";
  initialized: boolean;
  log?: LogSink;
  qualifiedTable: string;
  table: string;
}

async function rollbackAfterError(client: pg.Client): Promise<boolean> {
  try {
    await client.query("ROLLBACK;");
    return true;
  } catch {
    // Preserve the database error that caused the rollback.
    return false;
  }
}

async function initializeHistory(
  client: pg.Client,
  qualifiedTable: string,
): Promise<void> {
  await client.query("BEGIN;");
  try {
    await createHistoryTable(client, qualifiedTable);
    await client.query("COMMIT;");
  } catch (error) {
    await rollbackAfterError(client);
    throw error;
  }
}

async function executeMigration(
  client: pg.Client,
  migration: DiskMigration,
  migrationSql: MigrationSql,
  direction: "down" | "up",
  qualifiedTable: string,
): Promise<void> {
  const sql = migrationSql[direction];
  await client.query("BEGIN;");
  if (sql !== "") {
    await client.query(sql);
  }
  if (direction === "up") {
    await recordAppliedMigration(
      client,
      qualifiedTable,
      migration.version,
      migration.file,
      migrationSql.checksum,
    );
  } else {
    await removeAppliedMigration(client, qualifiedTable, migration.version);
  }
  await client.query("COMMIT;");
}

/** Executes a migration plan and updates migration history. */
export async function executeMigrations(
  client: pg.Client,
  plan: DiskMigration[],
  sqlByFile: Map<string, MigrationSql>,
  options: ExecuteOptions,
): Promise<MigrateResult> {
  if (options.direction === "up" && !options.initialized) {
    options.log?.({ table: options.table, type: "history-initialize-start" });
    await initializeHistory(client, options.qualifiedTable);
    options.log?.({ table: options.table, type: "history-initialize-done" });
  }
  for (const migration of plan) {
    const migrationSql = sqlByFile.get(migration.file)!;
    const startedAt = Date.now();
    options.log?.({
      direction: options.direction,
      file: migration.file,
      type: "migration-start",
    });
    try {
      await executeMigration(
        client,
        migration,
        migrationSql,
        options.direction,
        options.qualifiedTable,
      );
    } catch (error) {
      options.log?.({
        direction: options.direction,
        durationMs: Date.now() - startedAt,
        file: migration.file,
        type: "migration-failed",
      });
      if (await rollbackAfterError(client)) {
        options.log?.({ type: "failed-migration-rollback-done" });
      }
      const action = options.direction === "up" ? "apply" : "revert";
      throw new Error(`Failed to ${action} migration '${migration.file}'.`, {
        cause: error,
      });
    }
    options.log?.({
      direction: options.direction,
      durationMs: Date.now() - startedAt,
      file: migration.file,
      type: "migration-done",
    });
  }

  return { files: plan.map((migration) => migration.file) };
}
