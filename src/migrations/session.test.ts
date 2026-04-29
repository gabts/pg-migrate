import * as assert from "assert";
import * as pg from "pg";
import { messages } from "../logging/messages.js";
import type { Logger } from "../logging/logger.js";
import { withMigrationSession } from "./session.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run integration tests");
}

const databaseConfig: string | pg.ClientConfig = process.env.DATABASE_URL;
const client = new pg.Client(databaseConfig);
const defaultMigrationHistoryTable = "migration_history";
const schemaMigrationHistorySchema = "migratorosaurus_test";
const qualifiedMigrationHistoryTable = `${schemaMigrationHistorySchema}.migration_history`;
const createFile = "20260416090000_create.sql";
const createVersion = "20260416090000";

const noopLogger: Logger = {
  debug: (): void => undefined,
  error: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
};

function createCapturedLogger(logs: string[]): Logger {
  const capture = (message: string): void => {
    logs.push(message);
  };
  const captureError = (input: unknown): void => {
    logs.push(String(input));
  };

  return {
    debug: capture,
    error: captureError,
    info: capture,
    warn: capture,
  };
}

async function queryTableExists(tableName: string): Promise<boolean> {
  const [schema, table] = tableName.includes(".")
    ? tableName.split(".")
    : [undefined, tableName];
  const res = await client.query(
    `
    SELECT EXISTS (
      SELECT *
      FROM information_schema.tables
      WHERE table_name = $1
      ${schema ? "AND table_schema = $2" : ""}
    );
  `,
    schema ? [table, schema] : [table],
  );

  return res.rows[0].exists;
}

async function queryHistory(
  tableName = defaultMigrationHistoryTable,
): Promise<any[]> {
  const res = await client.query(
    `SELECT filename AS file, version, applied_at FROM ${tableName} ORDER BY filename;`,
  );
  return res.rows;
}

async function dropTables(): Promise<void> {
  await client.query(
    `DROP SCHEMA IF EXISTS ${schemaMigrationHistorySchema} CASCADE;`,
  );
  await client.query(`
    DROP TABLE IF EXISTS
      ${defaultMigrationHistoryTable},
      person;
  `);
}

async function createMigrationHistoryTable(
  tableName = defaultMigrationHistoryTable,
): Promise<void> {
  const [schema] = tableName.includes(".") ? tableName.split(".") : [undefined];
  if (schema) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
  }
  await client.query(`
    CREATE TABLE ${tableName}
    (
      filename text PRIMARY KEY,
      version text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function createMalformedMigrationHistoryTable(): Promise<void> {
  await client.query(`
    CREATE TABLE ${defaultMigrationHistoryTable}
    (
      filename text NOT NULL,
      version text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function createMissingVersionMigrationHistoryTable(): Promise<void> {
  await client.query(`
    CREATE TABLE ${defaultMigrationHistoryTable}
    (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

describe("session", (): void => {
  before(async (): Promise<void> => {
    await client.connect();
    await dropTables();
  });

  after(async (): Promise<void> => {
    await client.end();
  });

  afterEach(async (): Promise<void> => {
    await dropTables();
  });

  it("creates a migration history table and returns the runner result", async (): Promise<void> => {
    const logs: string[] = [];

    const result = await withMigrationSession({
      clientConfig: databaseConfig,
      logger: createCapturedLogger(logs),
      table: defaultMigrationHistoryTable,
      run: async ({ appliedRows }): Promise<string> => {
        assert.deepEqual(appliedRows, []);
        return "done";
      },
    });

    assert.equal(result, "done");
    assert.deepEqual(logs, [messages.creatingTable()]);
    assert.ok(await queryTableExists(defaultMigrationHistoryTable));
    assert.deepEqual(await queryHistory(), []);
  });

  it("uses existing schema-qualified migration history tables", async (): Promise<void> => {
    await createMigrationHistoryTable(qualifiedMigrationHistoryTable);

    await withMigrationSession({
      clientConfig: databaseConfig,
      logger: noopLogger,
      table: qualifiedMigrationHistoryTable,
      run: async ({ client: sessionClient }): Promise<void> => {
        await sessionClient.query(
          `INSERT INTO ${qualifiedMigrationHistoryTable} (filename, version) VALUES ($1, $2);`,
          [createFile, createVersion],
        );
      },
    });

    const rows = await queryHistory(qualifiedMigrationHistoryTable);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].file, createFile);
  });

  it("requires missing schema-qualified migration history schemas to exist", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<void> =>
        withMigrationSession({
          clientConfig: databaseConfig,
          logger: noopLogger,
          table: "missing_migratorosaurus_schema.migration_history",
          run: async (): Promise<void> => undefined,
        }),
    );
  });

  it("throws a clear schema error when version column is missing", async (): Promise<void> => {
    await createMissingVersionMigrationHistoryTable();

    await assert.rejects(
      (): Promise<void> =>
        withMigrationSession({
          clientConfig: databaseConfig,
          logger: noopLogger,
          table: defaultMigrationHistoryTable,
          run: async (): Promise<void> => undefined,
        }),
      /Invalid migration history table schema: migration_history\. Expected columns filename, version, applied_at: column "version" does not exist/,
    );
  });

  it("validates applied migration history before running", async (): Promise<void> => {
    await createMalformedMigrationHistoryTable();
    await client.query(
      `
      INSERT INTO ${defaultMigrationHistoryTable} (filename, version)
      VALUES
        ('${createFile}', '${createVersion}'),
        ('${createFile}', '20260416090001');
    `,
    );

    let didRun = false;
    await assert.rejects(
      (): Promise<void> =>
        withMigrationSession({
          clientConfig: databaseConfig,
          logger: noopLogger,
          table: defaultMigrationHistoryTable,
          run: async (): Promise<void> => {
            didRun = true;
          },
        }),
      /Duplicate applied migration file: 20260416090000_create\.sql/,
    );
    assert.equal(didRun, false);
  });

  it("propagates runner errors and keeps setup committed", async (): Promise<void> => {
    const logs: string[] = [];

    await assert.rejects(
      (): Promise<void> =>
        withMigrationSession({
          clientConfig: databaseConfig,
          logger: createCapturedLogger(logs),
          table: defaultMigrationHistoryTable,
          run: async (): Promise<void> => {
            throw new Error("runner failed");
          },
        }),
      /runner failed/,
    );

    assert.deepEqual(logs, [messages.creatingTable()]);
    // The history table is created in its own transaction and survives
    // runner failures — only the failing migration's transaction is rolled
    // back, not the session setup.
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), true);
    assert.deepEqual(await queryHistory(), []);
  });

  it("fails fast when the advisory lock is already held", async (): Promise<void> => {
    await createMigrationHistoryTable();
    const lockClient = new pg.Client(databaseConfig);

    await lockClient.connect();

    let lockTransactionOpen = false;

    try {
      await lockClient.query("BEGIN;");
      lockTransactionOpen = true;
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        defaultMigrationHistoryTable,
      ]);

      await assert.rejects(
        (): Promise<void> =>
          withMigrationSession({
            clientConfig: databaseConfig,
            logger: noopLogger,
            table: defaultMigrationHistoryTable,
            run: async (): Promise<void> => undefined,
          }),
        /Could not acquire advisory lock for migration table "migration_history"/,
      );
    } finally {
      if (lockTransactionOpen) {
        await lockClient.query("ROLLBACK;");
      }
      await lockClient.end();
    }
  });

  it("fails fast for schema-qualified aliases when the same lock key is held", async (): Promise<void> => {
    // The bare unqualified table name is used as the lock key, so
    // "migration_history" and "public.migration_history" (or any
    // <schema>.migration_history) all hash to the same advisory lock.
    await createMigrationHistoryTable();

    const currentSchemaResult = await client.query<{ schema: string }>(
      "SELECT current_schema() AS schema;",
    );
    const qualifiedAlias = `${currentSchemaResult.rows[0]!.schema}.${defaultMigrationHistoryTable}`;

    const lockClient = new pg.Client(databaseConfig);
    await lockClient.connect();

    let lockTransactionOpen = false;

    try {
      await lockClient.query("BEGIN;");
      lockTransactionOpen = true;
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        defaultMigrationHistoryTable,
      ]);

      await assert.rejects(
        (): Promise<void> =>
          withMigrationSession({
            clientConfig: databaseConfig,
            logger: noopLogger,
            table: qualifiedAlias,
            run: async (): Promise<void> => undefined,
          }),
        (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          return error.message.includes(
            `Could not acquire advisory lock for migration table "${qualifiedAlias}"`,
          );
        },
      );
    } finally {
      if (lockTransactionOpen) {
        await lockClient.query("ROLLBACK;");
      }
      await lockClient.end();
    }
  });
});
