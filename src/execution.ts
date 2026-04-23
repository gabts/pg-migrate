import type { Logger } from "./logger.js";
import type * as pg from "pg";
import { messages } from "./log-messages.js";
import { getMigrationVersion } from "./migration-naming.js";
import { parseTableName, qualifyTableName } from "./table-name.js";
import { runInTransaction } from "./transaction.js";
import type { MigrationStep } from "./types.js";

interface ExecutePlanArgs {
  client: pg.Client;
  log: Logger;
  qualifiedTableName: string;
  steps: MigrationStep[];
}

async function executeUpPlanNormal(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const version = getMigrationVersion(file);
    log.info("");
    log.info(messages.applying(file));
    const started = Date.now();

    try {
      await runInTransaction(client, async (): Promise<void> => {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${qualifiedTableName} ( filename, version, applied_at ) VALUES ( $1, $2, clock_timestamp() );`,
          [file, version],
        );
      });

      log.info(messages.applied(file, Date.now() - started));
    } catch (error) {
      log.error(messages.failed(file, Date.now() - started));
      log.error(messages.errorDetails(error));
      log.error(messages.failureRolledBack());
      throw error;
    }
  }
}

async function executeUpPlanDryRun(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const version = getMigrationVersion(file);
    log.info("");
    log.info(messages.applying(file));
    const started = Date.now();

    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${qualifiedTableName} ( filename, version, applied_at ) VALUES ( $1, $2, clock_timestamp() );`,
        [file, version],
      );

      log.info(messages.applied(file, Date.now() - started));
    } catch (error) {
      log.error(messages.failed(file, Date.now() - started));
      log.error(messages.errorDetails(error));
      log.error(messages.failureRolledBack());
      throw error;
    }
  }
}

async function executeDownPlanNormal(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const hasSql = sql !== "";
    log.info("");
    log.info(messages.reverting(file, hasSql));
    const started = Date.now();

    try {
      if (hasSql) {
        await runInTransaction(client, async (): Promise<void> => {
          await client.query(sql);
          await client.query(
            `DELETE FROM ${qualifiedTableName} WHERE filename = $1;`,
            [file],
          );
        });
      } else {
        await client.query(
          `DELETE FROM ${qualifiedTableName} WHERE filename = $1;`,
          [file],
        );
      }

      log.info(messages.reverted(file, Date.now() - started));
    } catch (error) {
      log.error(messages.failed(file, Date.now() - started));
      log.error(messages.errorDetails(error));
      if (hasSql) {
        log.error(messages.failureRolledBack());
      }
      throw error;
    }
  }
}

async function executeDownPlanDryRun(args: ExecutePlanArgs): Promise<void> {
  const { client, log, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const hasSql = sql !== "";
    log.info("");
    log.info(messages.reverting(file, hasSql));
    const started = Date.now();

    try {
      if (hasSql) {
        await client.query(sql);
      }
      await client.query(
        `DELETE FROM ${qualifiedTableName} WHERE filename = $1;`,
        [file],
      );

      log.info(messages.reverted(file, Date.now() - started));
    } catch (error) {
      log.error(messages.failed(file, Date.now() - started));
      log.error(messages.errorDetails(error));
      log.error(messages.failureRolledBack());
      throw error;
    }
  }
}

/**
 * Executes planned `up` migration steps and records them in history.
 */
export async function executeUpPlan(args: {
  client: pg.Client;
  log: Logger;
  dryRun?: boolean;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, log, dryRun = false, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  if (dryRun) {
    await executeUpPlanDryRun({
      client,
      log,
      qualifiedTableName,
      steps,
    });
    return;
  }

  await executeUpPlanNormal({ client, log, qualifiedTableName, steps });
}

/**
 * Executes planned `down` migration steps and removes them from history.
 */
export async function executeDownPlan(args: {
  client: pg.Client;
  log: Logger;
  dryRun?: boolean;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, log, dryRun = false, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  if (dryRun) {
    await executeDownPlanDryRun({
      client,
      log,
      qualifiedTableName,
      steps,
    });
    return;
  }

  await executeDownPlanNormal({
    client,
    log,
    qualifiedTableName,
    steps,
  });
}
