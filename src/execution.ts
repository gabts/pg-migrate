import type * as pg from "pg";
import { messages } from "./log-messages.js";
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
    log("");
    log(messages.applying(file));
    const started = Date.now();
    try {
      await runInTransaction(client, async (): Promise<void> => {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${qualifiedTableName} ( file, applied_at ) VALUES ( $1, clock_timestamp() );`,
          [file],
        );
      });
      log(messages.applied(file, Date.now() - started));
    } catch (error) {
      log(messages.failed(file, Date.now() - started));
      log(messages.errorDetails(error));
      log(messages.failureRolledBack());
      throw error;
    }
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
    const hasSql = sql !== "";
    log("");
    log(messages.reverting(file, hasSql));
    const started = Date.now();
    try {
      if (hasSql) {
        await runInTransaction(client, async (): Promise<void> => {
          await client.query(sql);
          await client.query(
            `DELETE FROM ${qualifiedTableName} WHERE file = $1;`,
            [file],
          );
        });
      } else {
        await client.query(
          `DELETE FROM ${qualifiedTableName} WHERE file = $1;`,
          [file],
        );
      }
      log(messages.reverted(file, Date.now() - started));
    } catch (error) {
      log(messages.failed(file, Date.now() - started));
      log(messages.errorDetails(error));
      if (hasSql) {
        log(messages.failureRolledBack());
      }
      throw error;
    }
  }
}
