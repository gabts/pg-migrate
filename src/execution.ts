import type * as pg from "pg";
import { parseTableName, qualifyTableName } from "./table-name.js";
import type { LogFn, MigrationStep } from "./types.js";

export async function executeUpPlan(args: {
  client: pg.Client;
  log: LogFn;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, log, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, index, sql } of steps) {
    log(`↑  upgrading > "${file}"`);
    await client.query(sql);
    await client.query(
      `INSERT INTO ${qualifiedTableName} ( index, file, date ) VALUES ( $1, $2, clock_timestamp() );`,
      [index, file],
    );
  }
}

export async function executeDownPlan(args: {
  client: pg.Client;
  log: LogFn;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, log, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, sql } of steps) {
    log(`↓  downgrading > "${file}"`);
    await client.query(sql);
    await client.query(`DELETE FROM ${qualifiedTableName} WHERE file = $1;`, [
      file,
    ]);
  }
}
