const assert = require('assert');
const { Pool } = require('pg');
const { migratorosaurus } = require('../dist');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The default migration history table name used by migratorosaurus
const defaultMigrationHistoryTable = 'migration_history';

// Used as a custom migration history table name
const customMigrationHistoryTable = 'custom_migration_history';

/**
 * Select table exists.
 */
async function queryTableExists(client, tableName) {
  const res = await client.query(`
    SELECT EXISTS (
      SELECT *
      FROM information_schema.tables
      WHERE table_name = '${tableName}'
    );
  `);

  return res.rows[0].exists;
}

/**
 * Select all rows in migration history table.
 */
async function queryHistory(client, tableName = 'migration_history') {
  const res = await client.query(`SELECT * FROM ${tableName};`);
  return res.rows;
}

/**
 * Select all rows in person table.
 */
async function queryPersons(client) {
  const res = await client.query('SELECT * FROM person;');
  return res.rows;
}

/**
 * Drop all tables used by test scripts.
 */
async function dropTables(client) {
  await client.query(`
    DROP TABLE IF EXISTS
      ${customMigrationHistoryTable},
      ${defaultMigrationHistoryTable},
      person;
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
 * Assert migration history exists and is empty.
 */
async function queryAssertMigrationEmpty(migrationHistoryTable) {
  const client = await pool.connect();
  assert.ok(!(await queryTableExists(client, 'person')));
  assert.ok(await queryTableExists(client, migrationHistoryTable));
  const historyRows = await queryHistory(client, migrationHistoryTable);
  client.release();
  assert.equal(historyRows.length, 0);
}

/**
 * Assert database has successfully migrated up to and including migration 0.
 */
async function queryAssertMigration0(migrationHistoryTable) {
  const client = await pool.connect();
  assert.ok(await queryTableExists(client, migrationHistoryTable));
  const historyRows = await queryHistory(client, migrationHistoryTable);
  const personRows = await queryPersons(client);
  client.release();

  assert.equal(historyRows.length, 1);
  assert.equal(Object.keys(historyRows[0]).length, 3);
  assert.ok(historyRows[0].date instanceof Date);
  assert.equal(historyRows[0].index, 0);
  assert.equal(historyRows[0].file, '0-create.sql');
  assert.equal(personRows.length, 0);
}

/**
 * Assert database has successfully migrated up to and including migration 1.
 */
async function queryAssertMigration1(migrationHistoryTable) {
  const client = await pool.connect();
  assert.ok(await queryTableExists(client, migrationHistoryTable));
  const historyRows = await queryHistory(client, migrationHistoryTable);
  const personRows = await queryPersons(client);
  client.release();

  assert.equal(historyRows.length, 2);
  assert.equal(Object.keys(historyRows[0]).length, 3);
  assert.ok(historyRows[0].date instanceof Date);
  assert.equal(historyRows[0].index, 0);
  assert.equal(historyRows[1].index, 1);
  assert.equal(historyRows[0].file, '0-create.sql');
  assert.equal(historyRows[1].file, '1-insert.sql');
  assert.equal(personRows.length, 3);
}

describe('migratorosaurus', () => {
  before(async () => {
    const client = await pool.connect();
    await dropTables(client);
    client.release();
  });

  after(async () => {
    await pool.end();
  });

  afterEach(async () => {
    const client = await pool.connect();
    await dropTables(client);
    client.release();
  });

  it('throws error on invalid directory', async () => {
    await assertError(() => {
      return migratorosaurus(pool, { directory: `${__dirname}/iñvàlïd-dîr` });
    });
  });

  it('initializes with empty directory', async () => {
    await migratorosaurus(pool, { directory: `${__dirname}/empty` });
    await queryAssertMigrationEmpty(defaultMigrationHistoryTable);
  });

  it('initializes with custom table name', async () => {
    await migratorosaurus(pool, {
      directory: `${__dirname}/empty`,
      table: customMigrationHistoryTable,
    });

    await queryAssertMigrationEmpty(customMigrationHistoryTable);
  });

  it('initializes and up migrates all', async () => {
    await migratorosaurus(pool, { directory: `${__dirname}/migrations` });
    await queryAssertMigration1(defaultMigrationHistoryTable);
  });

  it('initializes with custom table name and up migrates all', async () => {
    await migratorosaurus(pool, {
      directory: `${__dirname}/migrations`,
      table: customMigrationHistoryTable,
    });

    await queryAssertMigration1(customMigrationHistoryTable);
  });

  it('throws error on invalid target', async () => {
    let result = null;

    try {
      await migratorosaurus(pool, {
        directory: `${__dirname}/migrations`,
        target: '0-crëâté.skl',
      });
    } catch (error) {
      result = error;
    }

    assert.ok(result instanceof Error);
  });

  it('initializes with migration target', async () => {
    await migratorosaurus(pool, {
      directory: `${__dirname}/migrations`,
      target: '0-create.sql',
    });

    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it('down migrates one migration', async () => {
    await migratorosaurus(pool, { directory: `${__dirname}/migrations` });

    await migratorosaurus(pool, {
      directory: `${__dirname}/migrations`,
      target: '1-insert.sql',
    });

    await queryAssertMigration0(defaultMigrationHistoryTable);
  });

  it('up migrates all migrations then down migrates all', async () => {
    await migratorosaurus(pool, { directory: `${__dirname}/migrations` });

    await queryAssertMigration1(defaultMigrationHistoryTable);

    await migratorosaurus(pool, {
      directory: `${__dirname}/migrations`,
      target: '0-create.sql',
    });

    await queryAssertMigrationEmpty(defaultMigrationHistoryTable);
  });

  it('down migrate one migration then up migrate same migration', async () => {
    await migratorosaurus(pool, { directory: `${__dirname}/migrations` });

    await queryAssertMigration1(defaultMigrationHistoryTable);

    await migratorosaurus(pool, {
      directory: `${__dirname}/migrations`,
      target: '1-insert.sql',
    });

    await queryAssertMigration0(defaultMigrationHistoryTable);

    await migratorosaurus(pool, {
      directory: `${__dirname}/migrations`,
      target: '1-insert.sql',
    });

    await queryAssertMigration1(defaultMigrationHistoryTable);
  });
});
