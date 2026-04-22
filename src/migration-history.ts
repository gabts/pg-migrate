import type { Logger } from "./logger.js";
import type * as pg from "pg";
import { messages } from "./log-messages.js";
import type { AppliedRow } from "./types.js";
import { validateAppliedHistory } from "./validation.js";

export async function ensureMigrationHistory(args: {
  client: pg.Client;
  log: Logger;
  qualifiedTableName: string;
}): Promise<void> {
  const { client, log, qualifiedTableName } = args;

  const migrationTableQueryResult = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [qualifiedTableName],
  );

  if (!migrationTableQueryResult.rows[0].exists) {
    log.info(messages.creatingTable());
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
