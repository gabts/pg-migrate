import * as assert from "assert";
import * as pg from "pg";
import { withMigrationTransaction } from "./transaction.js";

const databaseConfig: string | pg.ClientConfig = process.env.DATABASE_URL ?? {};
const client = new pg.Client(databaseConfig);
const defaultMigrationHistoryTable = "migration_history";
const schemaMigrationHistorySchema = "migratorosaurus_test";
const qualifiedMigrationHistoryTable = `${schemaMigrationHistorySchema}.migration_history`;

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
  const res = await client.query(`SELECT * FROM ${tableName} ORDER BY index;`);
  return res.rows;
}

async function queryColumnDefault(
  tableName: string,
  columnName: string,
): Promise<string | null> {
  const res = await client.query(
    `
    SELECT column_default
    FROM information_schema.columns
    WHERE table_name = $1
      AND column_name = $2;
  `,
    [tableName, columnName],
  );

  return res.rows[0]?.column_default ?? null;
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
      index integer PRIMARY KEY,
      file text UNIQUE NOT NULL,
      date timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function createMalformedMigrationHistoryTable(): Promise<void> {
  await client.query(`
    CREATE TABLE ${defaultMigrationHistoryTable}
    (
      index integer NOT NULL,
      file text NOT NULL,
      date timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, ms);
  });
}

describe("transaction", (): void => {
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

    const result = await withMigrationTransaction({
      clientConfig: databaseConfig,
      log: (message: string): void => {
        logs.push(message);
      },
      table: defaultMigrationHistoryTable,
      run: async ({ appliedRows }): Promise<string> => {
        assert.deepEqual(appliedRows, []);
        return "done";
      },
    });

    assert.equal(result, "done");
    assert.deepEqual(logs, ["🥚 performing first time setup"]);
    assert.ok(await queryTableExists(defaultMigrationHistoryTable));
    assert.deepEqual(await queryHistory(), []);
    assert.ok(
      (
        await queryColumnDefault(defaultMigrationHistoryTable, "date")
      )?.includes("now()"),
    );
  });

  it("uses existing schema-qualified migration history tables", async (): Promise<void> => {
    await createMigrationHistoryTable(qualifiedMigrationHistoryTable);

    await withMigrationTransaction({
      clientConfig: databaseConfig,
      log: (): void => undefined,
      table: qualifiedMigrationHistoryTable,
      run: async ({ client: transactionClient }): Promise<void> => {
        await transactionClient.query(
          `INSERT INTO ${qualifiedMigrationHistoryTable} (index, file) VALUES ($1, $2);`,
          [0, "0-create.sql"],
        );
      },
    });

    const rows = await queryHistory(qualifiedMigrationHistoryTable);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].file, "0-create.sql");
  });

  it("requires missing schema-qualified migration history schemas to exist", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<void> =>
        withMigrationTransaction({
          clientConfig: databaseConfig,
          log: (): void => undefined,
          table: "missing_migratorosaurus_schema.migration_history",
          run: async (): Promise<void> => undefined,
        }),
    );
  });

  it("validates applied migration history before running", async (): Promise<void> => {
    await createMalformedMigrationHistoryTable();
    await client.query(
      `
      INSERT INTO ${defaultMigrationHistoryTable} (index, file)
      VALUES
        (0, '0-create.sql'),
        (0, '0-create.sql');
    `,
    );

    let didRun = false;
    await assert.rejects(
      (): Promise<void> =>
        withMigrationTransaction({
          clientConfig: databaseConfig,
          log: (): void => undefined,
          table: defaultMigrationHistoryTable,
          run: async (): Promise<void> => {
            didRun = true;
          },
        }),
      /Duplicate applied migration file: 0-create\.sql/,
    );
    assert.equal(didRun, false);
  });

  it("rolls back runner changes and logs when the runner fails", async (): Promise<void> => {
    const logs: string[] = [];

    await assert.rejects(
      (): Promise<void> =>
        withMigrationTransaction({
          clientConfig: databaseConfig,
          log: (message: string): void => {
            logs.push(message);
          },
          table: defaultMigrationHistoryTable,
          run: async ({ client: transactionClient }): Promise<void> => {
            await transactionClient.query("CREATE TABLE person (id integer);");
            throw new Error("runner failed");
          },
        }),
      /runner failed/,
    );

    assert.deepEqual(logs, [
      "🥚 performing first time setup",
      "☄️ migratorosaurus threw error!",
    ]);
    assert.equal(await queryTableExists("person"), false);
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
  });

  it("rolls back runner changes and logs when postgres rejects a query", async (): Promise<void> => {
    const logs: string[] = [];

    await assert.rejects(
      (): Promise<void> =>
        withMigrationTransaction({
          clientConfig: databaseConfig,
          log: (message: string): void => {
            logs.push(message);
          },
          table: defaultMigrationHistoryTable,
          run: async ({ client: transactionClient }): Promise<void> => {
            await transactionClient.query("CREATE TABLE person (id integer);");
            await transactionClient.query(`
              CREATE TABLE broken_person (
                id SERIALXXXXX PRIMARY KEY
              );
            `);
          },
        }),
      /type "serialxxxxx" does not exist/i,
    );

    assert.deepEqual(logs, [
      "🥚 performing first time setup",
      "☄️ migratorosaurus threw error!",
    ]);
    assert.equal(await queryTableExists("person"), false);
    assert.equal(await queryTableExists("broken_person"), false);
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
  });

  it("serializes concurrent runners against the same history table", async (): Promise<void> => {
    await createMigrationHistoryTable();
    const lockClient = new pg.Client(databaseConfig);

    await lockClient.connect();

    let firstSettled = false;
    let secondSettled = false;
    let lockTransactionOpen = false;
    let firstRun;
    let secondRun;

    try {
      await lockClient.query("BEGIN;");
      lockTransactionOpen = true;
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        defaultMigrationHistoryTable,
      ]);

      firstRun = withMigrationTransaction({
        clientConfig: databaseConfig,
        log: (): void => undefined,
        table: defaultMigrationHistoryTable,
        run: async (): Promise<void> => undefined,
      }).finally((): void => {
        firstSettled = true;
      });
      secondRun = withMigrationTransaction({
        clientConfig: databaseConfig,
        log: (): void => undefined,
        table: defaultMigrationHistoryTable,
        run: async (): Promise<void> => undefined,
      }).finally((): void => {
        secondSettled = true;
      });

      await delay(100);
      assert.equal(firstSettled, false);
      assert.equal(secondSettled, false);

      await lockClient.query("COMMIT;");
      lockTransactionOpen = false;

      const results = await Promise.allSettled([firstRun, secondRun]);

      assert.deepEqual(
        results.map((result): string => result.status),
        ["fulfilled", "fulfilled"],
      );
    } finally {
      if (lockTransactionOpen) {
        await lockClient.query("ROLLBACK;");
      }
      await lockClient.end();
      if (firstRun && secondRun) {
        await Promise.allSettled([firstRun, secondRun]);
      }
    }
  });
});
