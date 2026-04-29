import type { Logger } from "./logger.js";
import * as pg from "pg";
import {
  assertMigrationHistoryTableShape,
  ensureMigrationHistory,
  migrationHistoryExists,
  readAppliedRows,
} from "./migration-history.js";
import { parseTableName, qualifyTableName } from "./table-name.js";
import type { AppliedRow, ClientConfig } from "./types.js";

/**
 * Runs a callback inside a transaction with rollback-on-error semantics.
 */
export async function runInTransaction<T>(
  client: pg.Client,
  fn: () => Promise<T>,
): Promise<T> {
  let committed = false;
  await client.query("BEGIN;");
  try {
    const result = await fn();
    await client.query("COMMIT;");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Ignore rollback errors and surface the original failure.
      }
    }
  }
}

async function withMigrationSessionNormal<T>(args: {
  client: pg.Client;
  logger: Logger;
  qualifiedTableName: string;
  table: string;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
}): Promise<T> {
  const { client, logger, qualifiedTableName, run, table } = args;

  await runInTransaction(client, async (): Promise<void> => {
    await ensureMigrationHistory({
      client,
      logger,
      qualifiedTableName,
    });
    await assertMigrationHistoryTableShape({
      client,
      qualifiedTableName,
      table,
    });
  });

  const appliedRows = await readAppliedRows(client, qualifiedTableName);
  return await run({ appliedRows, client });
}

async function withMigrationSessionValidateOnly<T>(args: {
  client: pg.Client;
  qualifiedTableName: string;
  table: string;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
}): Promise<T> {
  const { client, qualifiedTableName, table, run } = args;
  const tableExists = await migrationHistoryExists(client, qualifiedTableName);
  if (!tableExists) {
    throw new Error(`Migration history table does not exist: ${table}`);
  }
  await assertMigrationHistoryTableShape({
    client,
    qualifiedTableName,
    table,
  });

  const appliedRows = await readAppliedRows(client, qualifiedTableName);
  return await run({ appliedRows, client });
}

async function withMigrationSessionDryRun<T>(args: {
  client: pg.Client;
  logger: Logger;
  qualifiedTableName: string;
  table: string;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
}): Promise<T> {
  const { client, logger, qualifiedTableName, run, table } = args;

  await client.query("BEGIN;");
  try {
    await ensureMigrationHistory({
      client,
      logger,
      qualifiedTableName,
    });
    await assertMigrationHistoryTableShape({
      client,
      qualifiedTableName,
      table,
    });
    const appliedRows = await readAppliedRows(client, qualifiedTableName);
    return await run({ appliedRows, client });
  } finally {
    try {
      // Always rollback; dry run must never commit.
      await client.query("ROLLBACK;");
    } catch {
      // Ignore rollback errors; session ending will release transaction state.
    }
  }
}

// Errors thrown from `run` (or from session setup) propagate unchanged.
// Callers are responsible for emitting aborted-run logs around the call.
/**
 * Opens a DB session, acquires the migration lock, and runs migration work.
 */
export async function withMigrationSession<T>(args: {
  clientConfig: ClientConfig;
  logger: Logger;
  dryRun?: boolean;
  initializeHistory?: boolean;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
  table: string;
}): Promise<T> {
  const {
    clientConfig,
    logger,
    dryRun = false,
    initializeHistory = true,
    run,
    table,
  } = args;
  const parsedTableName = parseTableName(table);
  const qualifiedTableName = qualifyTableName(parsedTableName);
  const client = new pg.Client(clientConfig);
  let lockKey: string | null = null;

  try {
    await client.connect();

    // Session-level advisory lock guards validation and execution for the
    // whole run so we can use one transaction per migration while still
    // preventing interleaved writes to the history table. The key is the
    // unqualified table name so "migration_history" and
    // "public.migration_history" hash to the same lock - runners against
    // same-named tables in different schemas will contend; use distinct table
    // names when that concurrency matters. Only mark lockKey after the lock
    // is acquired so `finally` does not issue an unlock we never acquired.
    const computedLockKey = parsedTableName.table;
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired;",
      [computedLockKey],
    );
    if (!lockResult.rows[0]?.acquired) {
      throw new Error(
        `Could not acquire advisory lock for migration table "${table}". Another migratorosaurus process may already be running.`,
      );
    }
    lockKey = computedLockKey;

    if (!initializeHistory) {
      return await withMigrationSessionValidateOnly({
        client,
        qualifiedTableName,
        run,
        table,
      });
    }

    if (dryRun) {
      return await withMigrationSessionDryRun({
        client,
        logger,
        qualifiedTableName,
        run,
        table,
      });
    }

    return await withMigrationSessionNormal({
      client,
      logger,
      qualifiedTableName,
      run,
      table,
    });
  } finally {
    if (lockKey !== null) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1));", [
          lockKey,
        ]);
      } catch {
        // Session ending will release the lock regardless; swallow so we
        // surface the original error instead of this cleanup failure.
      }
    }
    try {
      await client.end();
    } catch {
      // Ignore cleanup errors - committed work is durable and any failure
      // is already propagating.
    }
  }
}
