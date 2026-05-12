import * as pg from "pg";
import { parseTableName, qualifyTableName } from "../db/table-name.js";
import { runInTransaction } from "../db/transaction.js";
import type { ClientConfig } from "../db/types.js";
import type { Logger } from "../logging/logger.js";
import {
  assertMigrationHistoryTableShape,
  ensureMigrationHistory,
  migrationHistoryExists,
  readAppliedRows,
  readAppliedStatusRows,
} from "./history.js";
import type { AppliedRow, AppliedStatusRow } from "./types.js";

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
      table,
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
      table,
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

async function withMigrationSessionStatus<T>(args: {
  client: pg.Client;
  qualifiedTableName: string;
  table: string;
  run: (ctx: {
    appliedRows: AppliedStatusRow[];
    client: pg.Client;
    initialized: boolean;
  }) => Promise<T>;
}): Promise<T> {
  const { client, qualifiedTableName, table, run } = args;
  const tableExists = await migrationHistoryExists(client, qualifiedTableName);

  if (!tableExists) {
    return await run({ appliedRows: [], client, initialized: false });
  }

  await assertMigrationHistoryTableShape({
    client,
    qualifiedTableName,
    table,
  });

  const appliedRows = await readAppliedStatusRows(client, qualifiedTableName);
  return await run({ appliedRows, client, initialized: true });
}

async function withLockedMigrationClient<T>(args: {
  clientConfig: ClientConfig;
  run: (ctx: { client: pg.Client; qualifiedTableName: string }) => Promise<T>;
  table: string;
}): Promise<T> {
  const { clientConfig, run, table } = args;
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
        `Could not acquire advisory lock for migration table "${table}". Another pg-migrate process may already be running.`,
      );
    }
    lockKey = computedLockKey;

    return await run({ client, qualifiedTableName });
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
      // Ignore cleanup errors; any failure is already propagating.
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

  return await withLockedMigrationClient({
    clientConfig,
    table,
    run: async ({ client, qualifiedTableName }): Promise<T> => {
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
    },
  });
}

/**
 * Opens a DB session for read-only status inspection.
 */
export async function withMigrationStatusSession<T>(args: {
  clientConfig: ClientConfig;
  run: (ctx: {
    appliedRows: AppliedStatusRow[];
    client: pg.Client;
    initialized: boolean;
  }) => Promise<T>;
  table: string;
}): Promise<T> {
  const { clientConfig, run, table } = args;
  return await withLockedMigrationClient({
    clientConfig,
    table,
    run: async ({ client, qualifiedTableName }): Promise<T> => {
      return await withMigrationSessionStatus({
        client,
        qualifiedTableName,
        run,
        table,
      });
    },
  });
}
