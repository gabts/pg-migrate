import type * as pg from "pg";
import type { LogSink } from "./model.js";

interface HistoryColumn {
  name: string;
  notNull: boolean;
  type: string;
}

interface HistoryDefinition {
  columns: HistoryColumn[];
  initialized: boolean;
}

interface ResolvedHistoryTable {
  name: string;
  qualifiedName: string;
  schema: string;
  table: string;
}

const maxIdentifierLength = 63;
const tableNamePattern = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;

const requiredColumns = new Map<string, string>([
  ["version", "text"],
  ["applied_at", "timestamp with time zone"],
]);

/** One applied migration read from the history table. */
export interface AppliedMigration {
  appliedAt: string;
  version: string;
}

/** Validates a migration history table name. */
export function validateHistoryTableName(tableName: string): void {
  const hasLongIdentifier = tableName
    .split(".")
    .some((identifier) => identifier.length > maxIdentifierLength);

  if (!tableNamePattern.test(tableName) || hasLongIdentifier) {
    throw new Error(`Invalid migration table name '${tableName}'.`);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function resolveHistoryTableSchema(
  client: pg.Client,
  table: string,
): Promise<string> {
  const result = await client.query<{ schema: string | null }>(
    `
      SELECT COALESCE(
        (
          SELECT n.nspname
          FROM pg_class AS c
          JOIN pg_namespace AS n ON n.oid = c.relnamespace
          WHERE c.oid = to_regclass($1)
        ),
        current_schema()
      ) AS schema;
    `,
    [table],
  );
  const schema = result.rows[0]?.schema;
  if (!schema) {
    throw new Error(`Cannot resolve schema for migration table '${table}'.`);
  }
  return schema;
}

/** Validates and resolves a migration history table to one fixed schema. */
export async function resolveHistoryTable(
  client: pg.Client,
  name: string,
): Promise<ResolvedHistoryTable> {
  validateHistoryTableName(name);
  const separator = name.indexOf(".");
  const schema =
    separator === -1
      ? await resolveHistoryTableSchema(client, name)
      : name.slice(0, separator);
  const table = name.slice(separator + 1);
  return {
    name,
    qualifiedName: `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
    schema,
    table,
  };
}

/** Acquires the advisory lock for a migration history table. */
export async function lockMigrations(
  client: pg.Client,
  table: ResolvedHistoryTable,
  log: LogSink = (): undefined => undefined,
): Promise<void> {
  log({ table: table.name, type: "lock-acquire-start" });
  // The session lock is released when the caller closes this client.
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired;",
    [table.schema, table.table],
  );
  if (!result.rows[0]?.acquired) {
    throw new Error(
      `Migration lock for table '${table.name}' is already held.`,
    );
  }
  log({ table: table.name, type: "lock-acquire-done" });
}

/** Reads the migration history table definition. */
export async function readHistoryDefinition(
  client: pg.Client,
  qualifiedTable: string,
): Promise<HistoryDefinition> {
  const existsResult = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists;",
    [qualifiedTable],
  );
  if (!existsResult.rows[0]?.exists) {
    return { columns: [], initialized: false };
  }

  const columnsResult = await client.query<HistoryColumn>(
    `
      SELECT
        attname AS name,
        attnotnull AS "notNull",
        format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = $1::regclass
        AND attname IN ('version', 'applied_at')
        AND NOT attisdropped;
    `,
    [qualifiedTable],
  );
  return { columns: columnsResult.rows, initialized: true };
}

/** Validates the migration history table definition. */
export function validateHistoryDefinition(
  definition: HistoryDefinition,
  table: string,
): void {
  if (!definition.initialized) {
    return;
  }

  for (const [name, expectedType] of requiredColumns) {
    const column = definition.columns.find((column) => column.name === name);
    if (!column) {
      throw new Error(
        `Migration history table '${table}' is missing column ` + `'${name}'.`,
      );
    }
    if (column.type !== expectedType) {
      throw new Error(
        `Migration history table '${table}' column '${name}' must ` +
          `be '${expectedType}', not '${column.type}'.`,
      );
    }
    if (!column.notNull) {
      throw new Error(
        `Migration history table '${table}' column '${name}' must ` +
          "be NOT NULL.",
      );
    }
  }
}

/** Reads and validates one migration history table definition. */
export async function readValidatedHistoryDefinition(
  client: pg.Client,
  qualifiedTable: string,
  table: string,
  log: LogSink,
): Promise<HistoryDefinition> {
  log({ table, type: "history-definition-read-start" });
  const definition = await readHistoryDefinition(client, qualifiedTable);
  log({ table, type: "history-definition-read-done" });

  log({ table, type: "history-definition-validation-start" });
  validateHistoryDefinition(definition, table);
  log({ table, type: "history-definition-validation-done" });
  return definition;
}

/** Reads applied migrations from the history table. */
export async function readAppliedMigrations(
  client: pg.Client,
  qualifiedTable: string,
  table: string = qualifiedTable,
  log: LogSink = (): undefined => undefined,
): Promise<AppliedMigration[]> {
  log({ table, type: "applied-read-start" });
  // Format in SQL so global pg timestamp parsers cannot change the result.
  const result = await client.query<AppliedMigration>(
    `
      SELECT
        version,
        to_char(
          applied_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS "appliedAt"
      FROM ${qualifiedTable};
    `,
  );
  log({ count: result.rows.length, table, type: "applied-read-done" });
  return result.rows;
}

/** Creates the migration history table. */
export async function createHistoryTable(
  client: pg.Client,
  qualifiedTable: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE ${qualifiedTable}
    (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/** Adds an applied migration to the history table. */
export async function recordAppliedMigration(
  client: pg.Client,
  qualifiedTable: string,
  version: string,
): Promise<void> {
  // Supply database time so existing history tables do not need a default.
  await client.query(
    `INSERT INTO ${qualifiedTable} ` +
      `(version, applied_at) VALUES ($1, clock_timestamp());`,
    [version],
  );
}

/** Removes an applied migration from the history table. */
export async function removeAppliedMigration(
  client: pg.Client,
  qualifiedTable: string,
  version: string,
): Promise<void> {
  await client.query(`DELETE FROM ${qualifiedTable} WHERE version = $1;`, [
    version,
  ]);
}
