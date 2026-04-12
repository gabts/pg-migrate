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

export async function withMigrationTransaction<T>(args: {
  clientConfig: ClientConfig;
  log: LogFn;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
  table: string;
}): Promise<T> {
  const { clientConfig, log, run, table } = args;
  const client = new pg.Client(clientConfig);
  const qualifiedTableName = qualifyTableName(parseTableName(table));
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query("BEGIN;");
    transactionStarted = true;

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [table]);
    await initialize(client, log, table);
    await client.query(`LOCK TABLE ${qualifiedTableName} IN EXCLUSIVE MODE;`);

    const appliedRowsResult = await client.query<AppliedRow>(
      `SELECT index, file FROM ${qualifiedTableName} ORDER BY index DESC;`,
    );
    const appliedRows = appliedRowsResult.rows;
    validateAppliedHistory(appliedRows);

    const result = await run({ appliedRows, client });

    await client.query("COMMIT;");
    transactionStarted = false;
    return result;
  } catch (error) {
    log("☄️ migratorosaurus threw error!");
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Ignore rollback errors and surface the original failure.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}
