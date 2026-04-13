import * as pg from "pg";
import { parseTableName, qualifyTableName } from "./table-name.js";
import type { AppliedRow, ClientConfig, LogFn } from "./types.js";
import { validateAppliedHistory } from "./validation.js";

async function initialize(
  client: pg.Client,
  log: LogFn,
  tableName: string,
): Promise<void> {
  const tableNameParts = parseTableName(tableName);
  const qualifiedTableName = qualifyTableName(tableNameParts);
  const { schema, table } = tableNameParts;

  const migrationTableQueryResult = await client.query(
    `
    SELECT EXISTS (
      SELECT *
      FROM information_schema.tables
      WHERE table_name = $1
      ${schema ? "AND table_schema = $2" : ""}
    );
  `,
    schema ? [table, schema] : [table],
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

async function withClientTransaction<T>(
  clientConfig: ClientConfig,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client(clientConfig);
  let hasError = false;
  try {
    await client.connect();
    await client.query("BEGIN;");
    const result = await fn(client);
    await client.query("COMMIT;");
    return result;
  } catch (error) {
    hasError = true;
    try {
      await client.query("ROLLBACK;");
    } catch {
      // Ignore rollback errors and surface the original failure.
    }
    throw error;
  } finally {
    try {
      await client.end();
    } catch (endError) {
      if (!hasError) throw endError;
    }
  }
}

export async function withMigrationTransaction<T>(args: {
  clientConfig: ClientConfig;
  log: LogFn;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
  table: string;
}): Promise<T> {
  const { clientConfig, log, run, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  try {
    return await withClientTransaction(clientConfig, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        table,
      ]);
      await initialize(client, log, table);
      await client.query(
        `LOCK TABLE ${qualifiedTableName} IN EXCLUSIVE MODE;`,
      );

      const appliedRowsResult = await client.query<AppliedRow>(
        `SELECT index, file FROM ${qualifiedTableName} ORDER BY index DESC;`,
      );
      const appliedRows = appliedRowsResult.rows;
      validateAppliedHistory(appliedRows);

      return run({ appliedRows, client });
    });
  } catch (error) {
    log("☄️ migratorosaurus threw error!");
    throw error;
  }
}
