import type * as pg from "pg";
import { messages } from "./log-messages.js";
import { parseTableName, qualifyTableName } from "./table-name.js";
import { runInTransaction } from "./transaction.js";
import type { LogFn, MigrationStep } from "./types.js";

interface ExecutePlanArgs {
  client: pg.Client;
  log: LogFn;
  qualifiedTableName: string;
  steps: MigrationStep[];
}

async function executeUpPlanNormal(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

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

async function executeUpPlanDryRun(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    log("");
    log(messages.applying(file));
    const started = Date.now();

    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${qualifiedTableName} ( file, applied_at ) VALUES ( $1, clock_timestamp() );`,
        [file],
      );

      log(messages.applied(file, Date.now() - started));
    } catch (error) {
      log(messages.failed(file, Date.now() - started));
      log(messages.errorDetails(error));
      log(messages.failureRolledBack());
      throw error;
    }
  }
}

async function executeDownPlanNormal(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

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

async function executeDownPlanDryRun(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const hasSql = sql !== "";
    log("");
    log(messages.reverting(file, hasSql));
    const started = Date.now();

    try {
      if (hasSql) {
        await client.query(sql);
      }
      await client.query(`DELETE FROM ${qualifiedTableName} WHERE file = $1;`, [
        file,
      ]);

      log(messages.reverted(file, Date.now() - started));
    } catch (error) {
      log(messages.failed(file, Date.now() - started));
      log(messages.errorDetails(error));
      log(messages.failureRolledBack());
      throw error;
    }
  }
}

export async function executeUpPlan(args: {
  client: pg.Client;
  dryRun?: boolean;
  log: LogFn;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, dryRun = false, log, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  if (dryRun) {
    await executeUpPlanDryRun({ client, log, qualifiedTableName, steps });
    return;
  }

  await executeUpPlanNormal({ client, log, qualifiedTableName, steps });
}

export async function executeDownPlan(args: {
  client: pg.Client;
  dryRun?: boolean;
  log: LogFn;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, dryRun = false, log, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  if (dryRun) {
    await executeDownPlanDryRun({ client, log, qualifiedTableName, steps });
    return;
  }

  await executeDownPlanNormal({ client, log, qualifiedTableName, steps });
}
