const assert = require("assert");
const pg = require("pg");
const { migratorosaurus } = require("../dist");

const client = new pg.Client(process.env.DATABASE_URL);

// The default migration history table name used by migratorosaurus
const defaultMigrationHistoryTable = "migration_history";

// Used as a custom migration history table name
const customMigrationHistoryTable = "custom_migration_history";
const schemaMigrationHistorySchema = "migratorosaurus_test";
const schemaMigrationHistoryTable = "migration_history";
const qualifiedMigrationHistoryTable = `${schemaMigrationHistorySchema}.${schemaMigrationHistoryTable}`;
const missingSchemaMigrationHistoryTable = `missing_migratorosaurus_schema.${schemaMigrationHistoryTable}`;

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
    await dropTables();
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
      directory: `${__dirname}/empty`,
    });
    await queryAssertMigrationDoesntExist(defaultMigrationHistoryTable);
  });

  it("initializes with custom table name", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/empty`,
      table: customMigrationHistoryTable,
    });
    await queryAssertMigrationDoesntExist(customMigrationHistoryTable);
  });

  it("initializes and up migrates all", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("initializes with custom table name and up migrates all", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      table: customMigrationHistoryTable,
    });
    await queryAssertMigration1(customMigrationHistoryTable);
  });

  it("supports schema-qualified table names", async () => {
    await createMigrationHistoryTable(qualifiedMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      table: qualifiedMigrationHistoryTable,
    });
    await queryAssertMigration1(qualifiedMigrationHistoryTable);
  });

  it("requires schema-qualified table names to use an existing schema", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/migrations`,
        table: missingSchemaMigrationHistoryTable,
      }),
    );
  });

  it("rejects unconventional migration table names", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/migrations`,
        table: `custom "migration" history`,
      }),
    );
  });

  it("rejects migration filenames with unexpected characters", async () => {
    await assertError(() =>
      migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/invalid-filenames`,
      }),
    );
  });

  it("throws error on invalid target", async () => {
    let result = null;
    try {
      await migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/migrations`,
        target: "0-crëâté.skl",
      });
    } catch (error) {
      result = error;
    }
    assert.ok(result instanceof Error);
  });

  it("initializes with migration target", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      target: "0-create.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it("down migrates one migration", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
    });
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      target: "1-insert.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it("up migrates all migrations then down migrates all", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      target: "0-create.sql",
    });
    await queryAssertMigrationEmpty(defaultMigrationHistoryTable);
  });

  it("down migrate one migration then up migrate same migration", async () => {
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      target: "1-insert.sql",
    });
    await queryAssertMigration0(defaultMigrationHistoryTable);
    await migratorosaurus(process.env.DATABASE_URL, {
      directory: `${__dirname}/migrations`,
      target: "1-insert.sql",
    });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("serializes concurrent runners against the same history table", async () => {
    await createMigrationHistoryTable();

    const results = await Promise.allSettled([
      migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/concurrent-migrations`,
      }),
      migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/concurrent-migrations`,
      }),
    ]);

    assert.deepEqual(
      results.map((result) => result.status),
      ["fulfilled", "fulfilled"],
    );
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it("ends connection and throws error on postgres error", async () => {
    try {
      await migratorosaurus(process.env.DATABASE_URL, {
        directory: `${__dirname}/broken-migrations`,
      });
    } catch (e) {
      // expected
      return;
    }
    throw new Error("Should not reach this");
  });
});
