const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pg = require("pg");
const { migratorosaurus } = require("../dist/main.js");

const client = new pg.Client(process.env.DATABASE_URL);

// The default migration history table name used by migratorosaurus
const defaultMigrationHistoryTable = "migration_history";

// Used as a custom migration history table name
const customMigrationHistoryTable = "custom_migration_history";
const schemaMigrationHistorySchema = "migratorosaurus_test";
const schemaMigrationHistoryTable = "migration_history";
const qualifiedMigrationHistoryTable = `${schemaMigrationHistorySchema}.${schemaMigrationHistoryTable}`;
const missingSchemaMigrationHistoryTable = `missing_migratorosaurus_schema.${schemaMigrationHistoryTable}`;
const tempMigrationDirectories = [];

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

function createMigrationDirectory(files = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "migratorosaurus-migrations-"),
  );
  tempMigrationDirectories.push(directory);

  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, file), content);
  }

  return directory;
}

function createStandardMigrationDirectory() {
  return createMigrationDirectory({
    "0-create.sql": createPersonMigration,
    "1-insert.sql": insertPeopleMigration,
  });
}

function removeTempMigrationDirectories() {
  while (tempMigrationDirectories.length > 0) {
    fs.rmSync(tempMigrationDirectories.pop(), { recursive: true, force: true });
  }
}

/**
 * Select table exists.
 */
async function queryTableExists(tableName) {
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
async function queryHistory(tableName = "migration_history") {
  const res = await client.query(`SELECT * FROM ${tableName};`);
  return res.rows;
}

/**
 * Select all rows in person table.
 */
async function queryPersons() {
  const res = await client.query("SELECT * FROM person;");
  return res.rows;
}

/**
 * Drop all tables used by test scripts.
 */
async function dropTables() {
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
) {
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
async function assertError(fn) {
  let result = null;

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
async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Assert person and migration history tables does not exist.
 */
async function queryAssertMigrationDoesntExist(migrationHistoryTable) {
  assert.ok(!(await queryTableExists("person")));
  assert.ok(!(await queryTableExists(migrationHistoryTable)));
}

/**
 * Assert migration history exists and is empty.
 */
async function queryAssertMigrationEmpty(migrationHistoryTable) {
  assert.ok(!(await queryTableExists("person")));
  assert.ok(await queryTableExists(migrationHistoryTable));
  const historyRows = await queryHistory(migrationHistoryTable);
  assert.equal(historyRows.length, 0);
}

/**
 * Assert database has successfully migrated up to and including migration 0.
 */
async function queryAssertMigration0(migrationHistoryTable) {
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
async function queryAssertMigration1(migrationHistoryTable) {
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

describe("migratorosaurus", () => {
  before(async () => {
    await client.connect();
    await dropTables();
  });

  after(async () => {
    await client.end();
  });

  afterEach(async () => {
    try {
      await dropTables();
    } finally {
      removeTempMigrationDirectories();
    }
  });

  it("throws error on invalid directory", async () => {
    await assertError(() => {
      return migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/iñvàlïd-dîr`,
      });
    });
  });

  it("initializes with empty directory", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createMigrationDirectory(),
    });
    await queryAssertMigrationDoesntExist(defaultMigrationHistoryTable);
  });

  it("initializes with custom table name", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createMigrationDirectory(),
      table: customMigrationHistoryTable,
    });
    await queryAssertMigrationDoesntExist(customMigrationHistoryTable);
  });

  it("initializes and up migrates all", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("initializes with custom table name and up migrates all", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      table: customMigrationHistoryTable,
    });
    await queryAssertMigration1(customMigrationHistoryTable);
  });

  it("supports schema-qualified table names", async () => {
    await createMigrationHistoryTable(qualifiedMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      table: qualifiedMigrationHistoryTable,
    });
    await queryAssertMigration1(qualifiedMigrationHistoryTable);
  });

  it("requires schema-qualified table names to use an existing schema", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
        directory: createStandardMigrationDirectory(),
        table: missingSchemaMigrationHistoryTable,
      }),
    );
  });

  it("rejects unconventional migration table names", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
        directory: createStandardMigrationDirectory(),
        table: `custom "migration" history`,
      }),
    );
  });

  it("rejects migration filenames with unexpected characters", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
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

  it("rejects migration filenames with decimal indices", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
        directory: createMigrationDirectory({
          "1.1-create.sql": createPersonMigration,
        }),
      }),
    );
  });

  it("rejects duplicate resolved migration indices", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
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

  it("rejects migration files without an up section", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
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

  it("rejects migration files without a down section", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
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

  it("throws error on invalid target", async () => {
    let result = null;
    try {
      await migratorosaurus(process.env.DATABASE_URL, {
        directory: createStandardMigrationDirectory(),
        target: "0-crëâté.skl",
      });
    } catch (error) {
      result = error;
    }
    assert.ok(result instanceof Error);
  });

  it("initializes with migration target", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      target: "0-create.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it("down migrates one migration", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
    });
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      target: "1-insert.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it("up migrates all migrations then down migrates all", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      target: "0-create.sql",
    });
    await queryAssertMigrationEmpty(defaultMigrationHistoryTable);
  });

  it("down migrate one migration then up migrate same migration", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      target: "1-insert.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: createStandardMigrationDirectory(),
      target: "1-insert.sql",
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("serializes concurrent runners against the same history table", async () => {
    await createMigrationHistoryTable();
    const lockClient = new pg.Client(process.env.DATABASE_URL);

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

      firstMigration = migratorosaurus(process.env.DATABASE_URL, {
        directory: createStandardMigrationDirectory(),
      }).finally(() => {
        firstSettled = true;
      });
      secondMigration = migratorosaurus(process.env.DATABASE_URL, {
        directory: createStandardMigrationDirectory(),
      }).finally(() => {
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
        results.map((result) => result.status),
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

  it("ends connection and throws error on postgres error", async () => {
    try {
      await migratorosaurus(process.env.DATABASE_URL, {
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
