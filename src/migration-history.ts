import type { Logger } from "./logger.js";
import type * as pg from "pg";
import { messages } from "./log-messages.js";
import type { AppliedRow } from "./types.js";
import { validateAppliedHistory } from "./validation.js";

/**
 * Returns whether the configured migration history table exists.
 */
export async function migrationHistoryExists(
  client: pg.Client,
  qualifiedTableName: string,
): Promise<boolean> {
  const migrationTableQueryResult = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [qualifiedTableName],
  );

  return migrationTableQueryResult.rows[0].exists;
}

/**
 * Creates the migration history table when it is missing.
 */
export async function ensureMigrationHistory(args: {
  client: pg.Client;
  logger: Logger;
  qualifiedTableName: string;
}): Promise<void> {
  const { client, logger, qualifiedTableName } = args;

  if (!(await migrationHistoryExists(client, qualifiedTableName))) {
    logger.info(messages.creatingTable());
    await client.query(`
      CREATE TABLE ${qualifiedTableName}
      (
        filename text PRIMARY KEY,
        version text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
}

/**
 * Verifies the migration history table exposes required columns.
 */
export async function assertMigrationHistoryTableShape(args: {
  client: pg.Client;
  qualifiedTableName: string;
  table: string;
}): Promise<void> {
  const { client, qualifiedTableName, table } = args;
  try {
    // This only verifies that the expected column identifiers resolve.
    // It does not validate the underlying column data types.
    await client.query(
      `SELECT filename, version, applied_at FROM ${qualifiedTableName} LIMIT 0;`,
    );
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === "42703") {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(
        `Invalid migration history table schema: ${table}. Expected columns filename, version, applied_at${detail}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Reads and validates applied migration rows from the history table.
 */
export async function readAppliedRows(
  client: pg.Client,
  qualifiedTableName: string,
): Promise<AppliedRow[]> {
  // Order is irrelevant: disk.all is the canonical migration order.
  const appliedRowsResult = await client.query<AppliedRow>(
    `SELECT filename, version FROM ${qualifiedTableName};`,
  );
  const appliedRows = appliedRowsResult.rows;
  validateAppliedHistory(appliedRows);
  return appliedRows;
}
