import type * as pg from "pg";
import type { LogSink } from "./model.js";

/** One column of the migration history table definition. */
export interface HistoryColumn {
  identity: boolean;
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
  ["id", "bigint"],
  ["version", "text"],
  ["file", "text"],
  ["checksum", "text"],
  ["action", "text"],
  ["executed_at", "timestamp with time zone"],
  ["executed_by", "text"],
]);

/** One applied migration read from the history table. */
export interface AppliedMigration {
  appliedAt: string;
  checksum: string;
  file: string;
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
  let result: pg.QueryResult<{ schema: string | null }>;
  try {
    result = await client.query<{ schema: string | null }>(
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
  } catch (error) {
    throw new Error(
      `Failed to look up schema for migration table '${table}'.`,
      { cause: error },
    );
  }
  const schema = result.rows[0]?.schema;
  if (!schema) {
    throw new Error(`No schema found for migration table '${table}'.`);
  }
  return schema;
}

// A missing table counts as uninitialized history, so a typo in the schema
// would otherwise report every migration as pending.
async function assertSchemaExists(
  client: pg.Client,
  schema: string,
  table: string,
): Promise<void> {
  let result: pg.QueryResult<{ exists: boolean }>;
  try {
    result = await client.query<{ exists: boolean }>(
      "SELECT to_regnamespace($1) IS NOT NULL AS exists;",
      [schema],
    );
  } catch (error) {
    throw new Error(
      `Failed to look up schema for migration table '${table}'.`,
      { cause: error },
    );
  }
  if (!result.rows[0]?.exists) {
    throw new Error(`Schema '${schema}' does not exist.`);
  }
}

/** Validates and resolves a migration history table to one fixed schema. */
export async function resolveHistoryTable(
  client: pg.Client,
  name: string,
): Promise<ResolvedHistoryTable> {
  validateHistoryTableName(name);
  const separator = name.indexOf(".");
  let schema: string;
  if (separator === -1) {
    schema = await resolveHistoryTableSchema(client, name);
  } else {
    schema = name.slice(0, separator);
    await assertSchemaExists(client, schema, name);
  }
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
  log: LogSink,
): Promise<void> {
  log({ table: table.name, type: "lock-acquire-start" });
  try {
    // The session lock is released when the caller closes this client.
    await client.query("SELECT pg_advisory_lock(hashtext($1), hashtext($2));", [
      table.schema,
      table.table,
    ]);
  } catch (error) {
    throw new Error(`Failed to acquire migration lock for '${table.name}'.`, {
      cause: error,
    });
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
        attidentity <> '' AS identity,
        attnotnull AS "notNull",
        format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = $1::regclass
        AND attname = ANY($2)
        AND NOT attisdropped;
    `,
    [qualifiedTable, [...requiredColumns.keys()]],
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
    // Events are read in id order, so the database must assign each id.
    if (name === "id" && !column.identity) {
      throw new Error(
        `Migration history table '${table}' column 'id' must be an ` +
          "identity column.",
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
  let definition: HistoryDefinition;
  try {
    definition = await readHistoryDefinition(client, qualifiedTable);
  } catch (error) {
    throw new Error(`Failed to read migration history table '${table}'.`, {
      cause: error,
    });
  }
  log({ table, type: "history-definition-read-done" });

  log({ table, type: "history-definition-validation-start" });
  validateHistoryDefinition(definition, table);
  log({ table, type: "history-definition-validation-done" });
  return definition;
}

/** Reads applied migrations, one per version, in version order. */
export async function readAppliedMigrations(
  client: pg.Client,
  qualifiedTable: string,
  table: string,
  log: LogSink,
): Promise<AppliedMigration[]> {
  log({ table, type: "applied-read-start" });
  let result: pg.QueryResult<AppliedMigration>;
  try {
    // The latest event of a version holds its current file and checksum.
    // Events are ordered by id because clock times can tie or go backwards.
    // Format in SQL so global pg timestamp parsers cannot change the result.
    result = await client.query<AppliedMigration>(
      `
        WITH latest AS (
          SELECT DISTINCT ON (version) version, file, checksum, action
          FROM ${qualifiedTable}
          ORDER BY version, id DESC
        ),
        applied AS (
          SELECT DISTINCT ON (version) version, executed_at
          FROM ${qualifiedTable}
          WHERE action = 'apply'
          ORDER BY version, id DESC
        )
        SELECT
          version,
          latest.file,
          latest.checksum,
          to_char(
            applied.executed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) AS "appliedAt"
        FROM latest
        JOIN applied USING (version)
        WHERE latest.action <> 'revert'
        ORDER BY version;
      `,
    );
  } catch (error) {
    throw new Error(`Failed to read migration history table '${table}'.`, {
      cause: error,
    });
  }
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
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      version text NOT NULL,
      file text NOT NULL,
      checksum text NOT NULL,
      action text NOT NULL CHECK (action IN ('apply', 'revert', 'repair')),
      executed_at timestamptz NOT NULL,
      executed_by text NOT NULL
    );
  `);
}

/** Adds a migration event to the history table. */
export async function recordMigrationEvent(
  client: pg.Client,
  qualifiedTable: string,
  action: "apply" | "repair" | "revert",
  version: string,
  file: string,
  checksum: string,
): Promise<void> {
  // clock_timestamp() is the time of the write. now() would be the start of
  // the transaction, which a slow migration can push far into the past. The
  // session user is the login role, which SET ROLE does not change.
  await client.query(
    `INSERT INTO ${qualifiedTable} ` +
      "(version, file, checksum, action, executed_at, executed_by) " +
      "VALUES ($1, $2, $3, $4, clock_timestamp(), session_user);",
    [version, file, checksum, action],
  );
}
