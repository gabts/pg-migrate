import type * as pg from "pg";
import { events } from "../logging/events.js";
import type { Logger } from "../logging/logger.js";
import type { AppliedRow, AppliedStatusRow } from "./types.js";
import { validateAppliedHistory } from "./validation.js";

interface HistoryColumn {
  name: string;
  type: string;
}

const requiredHistoryColumns = new Map<string, string>([
  ["version", "text"],
  ["applied_at", "timestamp with time zone"],
]);

/**
 * Returns whether the configured migration history table exists.
 */
export async function migrationsTableExists(
  client: pg.Client,
  qualifiedTableName: string,
): Promise<boolean> {
  const migrationsTableQueryResult = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [qualifiedTableName],
  );

  return migrationsTableQueryResult.rows[0]?.exists ?? false;
}

/**
 * Ensures migration history is stored by version only.
 */
export async function ensureMigrationsTable(args: {
  client: pg.Client;
  logger: Logger;
  qualifiedTableName: string;
  table: string;
}): Promise<void> {
  const { client, logger, qualifiedTableName, table } = args;

  if (!(await migrationsTableExists(client, qualifiedTableName))) {
    logger.emit(events.migrationsTableCreating(table));
    await client.query(`
      CREATE TABLE ${qualifiedTableName}
      (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
}

/**
 * Verifies the migration history table exposes required columns and types.
 */
export async function assertMigrationsTableShape(args: {
  client: pg.Client;
  qualifiedTableName: string;
  table: string;
}): Promise<void> {
  const { client, qualifiedTableName, table } = args;

  const columnsResult = await client.query<HistoryColumn>(
    `
      SELECT
        attname AS name,
        format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = $1::regclass
        AND attname IN ('version', 'applied_at')
        AND NOT attisdropped;
    `,
    [qualifiedTableName],
  );
  const actualTypes = new Map(
    columnsResult.rows.map((column): [string, string] => [
      column.name,
      column.type,
    ]),
  );

  for (const [name, expectedType] of requiredHistoryColumns.entries()) {
    const actualType = actualTypes.get(name);
    if (actualType === undefined) {
      throw new Error(
        `Invalid migration history table schema: ${table}. Missing column ${name}`,
      );
    }
    if (actualType !== expectedType) {
      throw new Error(
        `Invalid migration history table schema: ${table}. Column ${name} must be ${expectedType}, got ${actualType}`,
      );
    }
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
    `SELECT version FROM ${qualifiedTableName};`,
  );
  const appliedRows = appliedRowsResult.rows;
  validateAppliedHistory(appliedRows);
  return appliedRows;
}

function isValidAppliedAt(
  value: unknown,
): value is AppliedStatusRow["appliedAt"] {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

/**
 * Reads applied migration rows with timestamps for status output.
 */
export async function readAppliedStatusRows(
  client: pg.Client,
  qualifiedTableName: string,
): Promise<AppliedStatusRow[]> {
  // Order is irrelevant: disk.all is the canonical migration order.
  const appliedRowsResult = await client.query<AppliedStatusRow>(
    `SELECT version, applied_at AS "appliedAt" FROM ${qualifiedTableName};`,
  );
  const appliedRows = appliedRowsResult.rows;
  validateAppliedHistory(appliedRows);
  for (const row of appliedRows) {
    if (!isValidAppliedAt(row.appliedAt)) {
      throw new Error(
        `Invalid applied migration timestamp for version "${row.version}": ${row.appliedAt}`,
      );
    }
  }
  return appliedRows;
}
