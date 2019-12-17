const assert = require('assert');
const { Pool } = require('pg');
const { migratosaurus } = require('../dist');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function queryHistory() {
  const client = await pool.connect();
  const res = await client.query('SELECT * FROM migration_history;');
  client.release();

  return res.rows;
}

async function queryPersons() {
  const client = await pool.connect();
  const res = await client.query('SELECT * FROM person;');
  client.release();

  return res.rows;
}

async function dropTables() {
  const client = await pool.connect();
  await client.query('DROP TABLE IF EXISTS migration_history, person;');
  client.release();
}

describe('migratosaurus', () => {
  before(async () => {
    await dropTables();
  });

  after(async () => {
    await dropTables();
    await pool.end();
  });

  it('initializes', async () => {
    await migratosaurus(pool, { directory: `${__dirname}/migrations` });

    const historyRows = await queryHistory();
    const personRows = await queryPersons();

    assert.equal(historyRows.length, 2);
    assert.equal(Object.keys(historyRows[0]).length, 3);
    assert.ok(historyRows[0].date instanceof Date);
    assert.equal(historyRows[0].index, 0);
    assert.equal(historyRows[1].index, 1);
    assert.equal(historyRows[0].file, '0-create.sql');
    assert.equal(historyRows[1].file, '1-insert.sql');
    assert.equal(personRows.length, 3);
  });

  it('down migrates', async () => {
    await migratosaurus(pool, {
      directory: `${__dirname}/migrations`,
      amountToDownMigrate: 1,
      shouldUpMigrate: false,
    });

    const historyRows = await queryHistory();
    const personRows = await queryPersons();

    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].index, 0);
    assert.equal(historyRows[0].file, '0-create.sql');
    assert.equal(personRows.length, 0);
  });

  it('up migrates', async () => {
    await migratosaurus(pool, { directory: `${__dirname}/migrations` });

    const historyRows = await queryHistory();
    const personRows = await queryPersons();

    assert.equal(historyRows.length, 2);
    assert.equal(historyRows[0].index, 0);
    assert.equal(historyRows[1].index, 1);
    assert.equal(historyRows[0].file, '0-create.sql');
    assert.equal(historyRows[1].file, '1-insert.sql');
    assert.equal(personRows.length, 3);
  });
});
