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
    await dropTables;
  });

  it('initializes', async () => {
    await migratosaurus(pool, { directory: `${__dirname}/migrations-1` });

    const historyRows = await queryHistory();
    const personRows = await queryPersons();

    assert(historyRows.length === 2);
    assert(Object.keys(historyRows[0]).length === 3);
    assert(typeof historyRows[0].index === 'number');
    assert(historyRows[0].date instanceof Date);
    assert(historyRows[0].file === '0-create.sql');
    assert(historyRows[1].file === '1-insert.sql');
    assert(!historyRows.find(({ name }) => name === '3-ignore-me.txt'));
    assert(!historyRows.find(({ name }) => name === 'ignore-me.sql'));
    assert(personRows.length === 3);
  });

  it('migrates on top of existing', async () => {
    await migratosaurus(pool, { directory: `${__dirname}/migrations-2` });

    const historyRows = await queryHistory();
    const personRows = await queryPersons();

    assert(historyRows.length === 3);
    assert(personRows.find(({ name }) => name === 'lierbag'));
  });

  it('ignores numbers lower or equal to latest migration', async () => {
    await migratosaurus(pool, { directory: `${__dirname}/migrations-3` });

    const historyRows = await queryHistory();

    assert(historyRows.length === 3);
  });

  after(async () => {
    await dropTables();
    await pool.end();
  });
});
