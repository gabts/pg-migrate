import type { Logger } from "../logging/logger.js";
import type * as pg from "pg";
import { messages } from "../logging/messages.js";
import { getMigrationVersion } from "./naming.js";
import { parseTableName, qualifyTableName } from "../db/table-name.js";
import { runInTransaction } from "../db/transaction.js";
import type { MigrationStep } from "./types.js";

interface ExecutePlanArgs {
  client: pg.Client;
  logger: Logger;
  qualifiedTableName: string;
  steps: MigrationStep[];
}

async function executeUpPlanNormal(args: ExecutePlanArgs): Promise<void> {
  const { client, logger, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const version = getMigrationVersion(file);
    logger.info(messages.applying(file));
    const started = Date.now();

    try {
      await runInTransaction(client, async (): Promise<void> => {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${qualifiedTableName} ( filename, version, applied_at ) VALUES ( $1, $2, clock_timestamp() );`,
          [file, version],
        );
      });

      logger.info(messages.applied(file, Date.now() - started));
    } catch (error) {
      logger.error(messages.failed(file, Date.now() - started));
      logger.error(messages.errorDetails(error));
      logger.error(messages.failureRolledBack());
      throw error;
    }
  }
}

async function executeUpPlanDryRun(args: ExecutePlanArgs): Promise<void> {
  const { client, logger, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const version = getMigrationVersion(file);
    logger.info(messages.applying(file));
    const started = Date.now();

    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${qualifiedTableName} ( filename, version, applied_at ) VALUES ( $1, $2, clock_timestamp() );`,
        [file, version],
      );

      logger.info(messages.applied(file, Date.now() - started));
    } catch (error) {
      logger.error(messages.failed(file, Date.now() - started));
      logger.error(messages.errorDetails(error));
      logger.error(messages.failureRolledBack());
      throw error;
    }
  }
}

async function executeDownPlanNormal(args: ExecutePlanArgs): Promise<void> {
  const { client, logger, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const hasSql = sql !== "";
    logger.info(messages.reverting(file, hasSql));
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

      logger.info(messages.reverted(file, Date.now() - started));
    } catch (error) {
      logger.error(messages.failed(file, Date.now() - started));
      logger.error(messages.errorDetails(error));
      if (hasSql) {
        logger.error(messages.failureRolledBack());
      }
      throw error;
    }
  }
}

async function executeDownPlanDryRun(args: ExecutePlanArgs): Promise<void> {
  const { client, logger, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const hasSql = sql !== "";
    logger.info(messages.reverting(file, hasSql));
    const started = Date.now();

    try {
      if (hasSql) {
        await client.query(sql);
      }
      await client.query(
        `DELETE FROM ${qualifiedTableName} WHERE filename = $1;`,
        [file],
      );

      logger.info(messages.reverted(file, Date.now() - started));
    } catch (error) {
      logger.error(messages.failed(file, Date.now() - started));
      logger.error(messages.errorDetails(error));
      logger.error(messages.failureRolledBack());
      throw error;
    }
  }
}

/**
 * Executes planned `up` migration steps and records them in history.
 */
export async function executeUpPlan(args: {
  client: pg.Client;
  logger: Logger;
  dryRun?: boolean;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, logger, dryRun = false, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  if (dryRun) {
    await executeUpPlanDryRun({
      client,
      logger,
      qualifiedTableName,
      steps,
    });
    return;
  }

  await executeUpPlanNormal({ client, logger, qualifiedTableName, steps });
}

/**
 * Executes planned `down` migration steps and removes them from history.
 */
export async function executeDownPlan(args: {
  client: pg.Client;
  logger: Logger;
  dryRun?: boolean;
  steps: MigrationStep[];
  table: string;
}): Promise<void> {
  const { client, logger, dryRun = false, steps, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  if (dryRun) {
    await executeDownPlanDryRun({
      client,
      logger,
      qualifiedTableName,
      steps,
    });
    return;
  }

  await executeDownPlanNormal({
    client,
    logger,
    qualifiedTableName,
    steps,
  });
}
