import * as pg from "pg";
import { parseTableName, qualifyTableName } from "./table-name.js";
import type { AppliedRow, ClientConfig, LogFn } from "./types.js";
import { validateAppliedHistory } from "./validation.js";

async function initialize(
  client: pg.Client,
  log: LogFn,
  tableName: string,
): Promise<void> {
  const qualifiedTableName = qualifyTableName(parseTableName(tableName));

  const migrationTableQueryResult = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [qualifiedTableName],
  );

  if (!migrationTableQueryResult.rows[0].exists) {
    log("🥚 performing first time setup");
    await client.query(`
      CREATE TABLE ${qualifiedTableName}
      (
        index integer PRIMARY KEY,
        file text UNIQUE NOT NULL,
        date timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
}

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

export async function withMigrationSession<T>(args: {
  clientConfig: ClientConfig;
  log: LogFn;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
  table: string;
}): Promise<T> {
  const { clientConfig, log, run, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));
  const client = new pg.Client(clientConfig);
  let lockKey: string | null = null;

  try {
    await client.connect();

    // Session-level advisory lock serializes concurrent runners across the
    // whole run so we can use one transaction per migration while still
    // preventing interleaved writes to the history table. The key is the
    // unqualified table name so "migration_history" and
    // "public.migration_history" hash to the same lock — runners against
    // same-named tables in different schemas will serialize; use distinct
    // table names when that concurrency matters. Only mark lockKey after the
    // query succeeds so `finally` does not issue an unlock we never acquired.
    const computedLockKey = parseTableName(table).table;
    await client.query("SELECT pg_advisory_lock(hashtext($1));", [
      computedLockKey,
    ]);
    lockKey = computedLockKey;

    await runInTransaction(client, async (): Promise<void> => {
      await initialize(client, log, table);
    });

    const appliedRowsResult = await client.query<AppliedRow>(
      `SELECT index, file FROM ${qualifiedTableName} ORDER BY index DESC;`,
    );
    const appliedRows = appliedRowsResult.rows;
    validateAppliedHistory(appliedRows);

    return await run({ appliedRows, client });
  } catch (error) {
    log("☄️ migratorosaurus threw error!");
    throw error;
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
      // Ignore cleanup errors — committed work is durable and any failure
      // is already propagating.
    }
  }
}
