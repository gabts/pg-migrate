import type * as pg from "pg";
import { parseTableName, qualifyTableName } from "../db/table-name.js";
import { runInTransaction } from "../db/transaction.js";
import { events } from "../logging/events.js";
import type { Logger } from "../logging/logger.js";
import { getMigrationVersion } from "./naming.js";
import type { MigrationStep } from "./types.js";

interface ExecutePlanArgs {
  client: pg.Client;
  dryRun: boolean;
  logger: Logger;
  qualifiedTableName: string;
  steps: MigrationStep[];
}

async function executeStep(args: {
  client: pg.Client;
  usesTransaction: boolean;
  work: () => Promise<void>;
}): Promise<void> {
  const { client, usesTransaction, work } = args;

  if (usesTransaction) {
    await runInTransaction(client, work);
    return;
  }

  await work();
}

async function executeUpPlanSteps(args: ExecutePlanArgs): Promise<void> {
  const { client, dryRun, logger, qualifiedTableName, steps } = args;
  const usesTransaction = !dryRun;

  for (const { file, sql } of steps) {
    const version = getMigrationVersion(file);
    logger.emit(events.migrationApplying(file));
    const started = Date.now();

    try {
      await executeStep({
        client,
        usesTransaction,
        work: async (): Promise<void> => {
          await client.query(sql);
          await client.query(
            `INSERT INTO ${qualifiedTableName} ( version, applied_at ) VALUES ( $1, clock_timestamp() );`,
            [version],
          );
        },
      });

      logger.emit(
        events.migrationApplied({
          durationMs: Date.now() - started,
          file,
        }),
      );
    } catch (error) {
      logger.emit(
        events.migrationFailed({
          direction: "up",
          durationMs: Date.now() - started,
          error,
          file,
        }),
      );
      if (usesTransaction) {
        logger.emit(
          events.migrationTransactionRolledBack({
            direction: "up",
            file,
          }),
        );
      }
      throw error;
    }
  }
}

async function executeDownPlanSteps(args: ExecutePlanArgs): Promise<void> {
  const { client, dryRun, logger, qualifiedTableName, steps } = args;

  for (const { file, sql } of steps) {
    const hasSql = sql !== "";
    const version = getMigrationVersion(file);
    const usesTransaction = !dryRun && hasSql;
    logger.emit(events.migrationReverting({ file, hasSql }));
    const started = Date.now();

    try {
      await executeStep({
        client,
        usesTransaction,
        work: async (): Promise<void> => {
          if (hasSql) {
            await client.query(sql);
          }
          await client.query(
            `DELETE FROM ${qualifiedTableName} WHERE version = $1;`,
            [version],
          );
        },
      });

      logger.emit(
        events.migrationReverted({
          durationMs: Date.now() - started,
          file,
          hasSql,
        }),
      );
    } catch (error) {
      logger.emit(
        events.migrationFailed({
          direction: "down",
          durationMs: Date.now() - started,
          error,
          file,
        }),
      );
      if (usesTransaction) {
        logger.emit(
          events.migrationTransactionRolledBack({
            direction: "down",
            file,
          }),
        );
      }
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

  await executeUpPlanSteps({
    client,
    dryRun,
    logger,
    qualifiedTableName,
    steps,
  });
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

  await executeDownPlanSteps({
    client,
    dryRun,
    logger,
    qualifiedTableName,
    steps,
  });
}
