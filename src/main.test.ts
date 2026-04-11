import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pg from "pg";
import { migratorosaurus } from "./main.js";

const databaseConfig: string | pg.ClientConfig = process.env.DATABASE_URL ?? {};
const client = new pg.Client(databaseConfig);

// The default migration history table name used by migratorosaurus
const defaultMigrationHistoryTable = "migration_history";

// Used as a custom migration history table name
const customMigrationHistoryTable = "custom_migration_history";
const schemaMigrationHistorySchema = "migratorosaurus_test";
const schemaMigrationHistoryTable = "migration_history";
const qualifiedMigrationHistoryTable = `${schemaMigrationHistorySchema}.${schemaMigrationHistoryTable}`;
const missingSchemaMigrationHistoryTable = `missing_migratorosaurus_schema.${schemaMigrationHistoryTable}`;
const tempMigrationDirectories: string[] = [];

const createPersonMigration = `-- % up-migration % --
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
DROP TABLE person;
`;

const insertPeopleMigration = `-- % up-migration % --
INSERT INTO person (name)
VALUES ('gabriel'), ('david'), ('frasse');

-- % down-migration % --
DELETE FROM person
WHERE name IN ('gabriel', 'david', 'frasse');
`;

function createMigrationDirectory(files: Record<string, string> = {}): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "migratorosaurus-migrations-"),
  );
  tempMigrationDirectories.push(directory);

  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, file), content);
  }

  return directory;
}

function createStandardMigrationDirectory(): string {
  return createMigrationDirectory({
    "0-create.sql": createPersonMigration,
    "1-insert.sql": insertPeopleMigration,
  });
}

function removeTempMigrationDirectories(): void {
  while (tempMigrationDirectories.length > 0) {
    fs.rmSync(tempMigrationDirectories.pop()!, {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Select table exists.
 */
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

/**
 * Select all rows in migration history table.
 */
async function queryHistory(tableName = "migration_history"): Promise<any[]> {
  const res = await client.query(`SELECT * FROM ${tableName};`);
  return res.rows;
}

/**
 * Select all rows in person table.
 */
async function queryPersons(): Promise<any[]> {
  const res = await client.query("SELECT * FROM person;");
  return res.rows;
}

/**
 * Drop all tables used by test scripts.
 */
async function dropTables(): Promise<void> {
  await client.query(
    `DROP SCHEMA IF EXISTS ${schemaMigrationHistorySchema} CASCADE;`,
  );
  await client.query(`
    DROP TABLE IF EXISTS
      ${customMigrationHistoryTable},
      ${defaultMigrationHistoryTable},
      person;
  `);
}

/**
 * Create an empty migration history table.
 */
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

/**
 * Assert function throws an error.
 */
async function assertError(fn: () => Promise<unknown>): Promise<void> {
  let result: unknown = null;

  try {
    await fn();
  } catch (error) {
    result = error;
  }

  assert.ok(result instanceof Error);
}

/**
 * Wait for a short period in async tests.
 */
async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, ms);
  });
}

/**
 * Assert person and migration history tables does not exist.
 */
async function queryAssertMigrationDoesntExist(
  migrationHistoryTable: string,
): Promise<void> {
  assert.ok(!(await queryTableExists("person")));
  assert.ok(!(await queryTableExists(migrationHistoryTable)));
}

/**
 * Assert migration history exists and is empty.
 */
async function queryAssertMigrationEmpty(
  migrationHistoryTable: string,
): Promise<void> {
  assert.ok(!(await queryTableExists("person")));
  assert.ok(await queryTableExists(migrationHistoryTable));
  const historyRows = await queryHistory(migrationHistoryTable);
  assert.equal(historyRows.length, 0);
}

/**
 * Assert database has successfully migrated up to and including migration 0.
 */
async function queryAssertMigration0(
  migrationHistoryTable: string,
): Promise<void> {
  assert.ok(await queryTableExists(migrationHistoryTable));
  const historyRows = await queryHistory(migrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 1);
  assert.equal(Object.keys(historyRows[0]).length, 3);
  assert.ok(historyRows[0].date instanceof Date);
  assert.equal(historyRows[0].index, 0);
  assert.equal(historyRows[0].file, "0-create.sql");
  assert.equal(personRows.length, 0);
}

/**
 * Assert database has successfully migrated up to and including migration 1.
 */
async function queryAssertMigration1(
  migrationHistoryTable: string,
): Promise<void> {
  assert.ok(await queryTableExists(migrationHistoryTable));
  const historyRows = await queryHistory(migrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 2);
  assert.equal(Object.keys(historyRows[0]).length, 3);
  assert.ok(historyRows[0].date instanceof Date);
  assert.equal(historyRows[0].index, 0);
  assert.equal(historyRows[1].index, 1);
  assert.equal(historyRows[0].file, "0-create.sql");
  assert.equal(historyRows[1].file, "1-insert.sql");
  assert.equal(personRows.length, 3);
}

describe("migratorosaurus", (): void => {
  before(async (): Promise<void> => {
    await client.connect();
    await dropTables();
  });

  after(async (): Promise<void> => {
    await client.end();
  });

  afterEach(async (): Promise<void> => {
    try {
      await dropTables();
    } finally {
      removeTempMigrationDirectories();
    }
  });

  it("throws error on invalid directory", async (): Promise<void> => {
    await assertError((): Promise<void> => {
      return migratorosaurus(databaseConfig, {
        directory: `${__dirname}/iñvàlïd-dîr`,
      });
    });
  });

  it("initializes with empty directory", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createMigrationDirectory(),
    });
    await queryAssertMigrationDoesntExist(defaultMigrationHistoryTable);
  });

  it("initializes with custom table name", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createMigrationDirectory(),
      table: customMigrationHistoryTable,
    });
    await queryAssertMigrationDoesntExist(customMigrationHistoryTable);
  });

  it("initializes and up migrates all", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("initializes with custom table name and up migrates all", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      table: customMigrationHistoryTable,
    });
    await queryAssertMigration1(customMigrationHistoryTable);
  });

  it("supports schema-qualified table names", async (): Promise<void> => {
    await createMigrationHistoryTable(qualifiedMigrationHistoryTable);
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      table: qualifiedMigrationHistoryTable,
    });
    await queryAssertMigration1(qualifiedMigrationHistoryTable);
  });

  it("requires schema-qualified table names to use an existing schema", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createStandardMigrationDirectory(),
          table: missingSchemaMigrationHistoryTable,
        }),
    );
  });

  it("rejects unconventional migration table names", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createStandardMigrationDirectory(),
          table: `custom "migration" history`,
        }),
    );
  });

  it("rejects migration filenames with unexpected characters", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createMigrationDirectory({
            "0-create.sql": createPersonMigration,
            "1-o'hara.sql": `-- % up-migration % --
INSERT INTO person (name)
VALUES ('o''hara');

-- % down-migration % --
DELETE FROM person
WHERE name = 'o''hara';
`,
          }),
        }),
    );
  });

  it("rejects migration filenames with decimal indices", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createMigrationDirectory({
            "1.1-create.sql": createPersonMigration,
          }),
        }),
    );
  });

  it("rejects duplicate resolved migration indices", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createMigrationDirectory({
            "001-create_again.sql": `-- % up-migration % --
CREATE TABLE company (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
DROP TABLE company;
`,
            "1-create.sql": createPersonMigration,
          }),
        }),
    );
  });

  it("rejects migration files without an up section", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createMigrationDirectory({
            "0-create.sql": `CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
DROP TABLE person;
`,
          }),
        }),
    );
  });

  it("rejects migration files without a down section", async (): Promise<void> => {
    await assertError(
      (): Promise<void> =>
        migratorosaurus(databaseConfig, {
          directory: createMigrationDirectory({
            "0-create.sql": `-- % up-migration % --
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);
`,
          }),
        }),
    );
  });

  it("throws error on invalid target", async (): Promise<void> => {
    let result = null;
    try {
      await migratorosaurus(databaseConfig, {
        directory: createStandardMigrationDirectory(),
        target: "0-crëâté.skl",
      });
    } catch (error) {
      result = error;
    }
    assert.ok(result instanceof Error);
  });

  it("initializes with migration target", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      target: "0-create.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it("down migrates one migration", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
    });
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      target: "1-insert.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it("up migrates all migrations then down migrates all", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      target: "0-create.sql",
    });
    await queryAssertMigrationEmpty(defaultMigrationHistoryTable);
  });

  it("down migrate one migration then up migrate same migration", async (): Promise<void> => {
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      target: "1-insert.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
    await migratorosaurus(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      target: "1-insert.sql",
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("serializes concurrent runners against the same history table", async (): Promise<void> => {
    await createMigrationHistoryTable();
    const lockClient = new pg.Client(databaseConfig);

    await lockClient.connect();

    let firstSettled = false;
    let secondSettled = false;
    let lockTransactionOpen = false;
    let firstMigration;
    let secondMigration;

    try {
      await lockClient.query("BEGIN;");
      lockTransactionOpen = true;
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        defaultMigrationHistoryTable,
      ]);

      firstMigration = migratorosaurus(databaseConfig, {
        directory: createStandardMigrationDirectory(),
      }).finally((): void => {
        firstSettled = true;
      });
      secondMigration = migratorosaurus(databaseConfig, {
        directory: createStandardMigrationDirectory(),
      }).finally((): void => {
        secondSettled = true;
      });

      await delay(100);
      assert.equal(firstSettled, false);
      assert.equal(secondSettled, false);

      await lockClient.query("COMMIT;");
      lockTransactionOpen = false;

      const results = await Promise.allSettled([
        firstMigration,
        secondMigration,
      ]);

      assert.deepEqual(
        results.map((result): string => result.status),
        ["fulfilled", "fulfilled"],
      );
    } finally {
      if (lockTransactionOpen) {
        await lockClient.query("ROLLBACK;");
      }
      await lockClient.end();
      if (firstMigration && secondMigration) {
        await Promise.allSettled([firstMigration, secondMigration]);
      }
    }

    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("ends connection and throws error on postgres error", async (): Promise<void> => {
    try {
      await migratorosaurus(databaseConfig, {
        directory: createMigrationDirectory({
          "0-break.sql": `-- % up-migration % --
CREATE TABLE person (
  id SERIALXXXXX PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
DROP TABLE person;
`,
        }),
      });
    } catch (e) {
      // expected
      return;
    }
    throw new Error("Should not reach this");
  });
});
