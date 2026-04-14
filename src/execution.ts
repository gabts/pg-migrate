import type * as pg from "pg";
import { parseTableName, qualifyTableName } from "./table-name.js";
import { runInTransaction } from "./transaction.js";
import type { LogFn, MigrationStep } from "./types.js";

export async function executeUpPlan(args: {
  client: pg.Client;
  log: LogFn;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, log, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, sql } of steps) {
    log(`↑  upgrading > "${file}"`);
    await runInTransaction(client, async (): Promise<void> => {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${qualifiedTableName} ( file, applied_at ) VALUES ( $1, clock_timestamp() );`,
        [file],
      );
    });
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
    if (sql) {
      log(`↓  downgrading > "${file}"`);
    } else {
      log(`↓  downgrading > "${file}" (no down section, skipping)`);
    }
    if (sql) {
      await runInTransaction(client, async (): Promise<void> => {
        await client.query(sql);
        await client.query(
          `DELETE FROM ${qualifiedTableName} WHERE file = $1;`,
          [file],
        );
      });
    } else {
      await client.query(`DELETE FROM ${qualifiedTableName} WHERE file = $1;`, [
        file,
      ]);
    }
  }
}
