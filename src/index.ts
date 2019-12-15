import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

interface MigrationFile {
  file: string;
  index: number;
  path: string;
}

const parseMatch = {
  up: /^--.*up-migration/,
  down: /^--.*down-migration/,
};

function parseMigration(sql: string, direction: 'up' | 'down') {
  return sql
    .split(/(?=--.*[(down|up)]-migration)/g)
    .find((str) => str.match(parseMatch[direction]));
}

function getMigrationFiles(dir: string) {
  return (
    fs
      // Read files in migrations directory
      .readdirSync(dir)
      // Filter any files that does not start with a number, followed by either
      // a dash and some character or nothing, and ending with .sql
      .filter((file) => file.match(/^\d{1,}(\.\d{1,})?(-.*)?\.sql$/))
      // Add an object storing file index, name and path
      .map<MigrationFile>((file) => ({
        file,
        index: parseInt(file.split('-')[0], 10),
        path: `${dir}/${file}`,
      }))
  );
}

async function initialize(pool: Pool, table: string) {
  const client = await pool.connect();

  // Check if migrations table exists
  const migrationTableQueryResult = await client.query(`
    SELECT COUNT (*)
    FROM information_schema.tables
    WHERE table_name = '${table}';
  `);

  // If migrations table does not exist, create it
  if (migrationTableQueryResult.rows[0].count !== '1') {
    console.log('🚧  performing first time setup');

    await client.query(`
      CREATE TABLE ${table}
      (
        index integer PRIMARY KEY,
        file text UNIQUE NOT NULL,
        date timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  client.release();
}

async function migrateDown(
  pool: Pool,
  table: string,
  files: MigrationFile[],
  limit: number
) {
  const client = await pool.connect();

  const migrationsToDowngrade = await client.query(`
    SELECT file FROM ${table} ORDER BY index DESC LIMIT ${limit};
  `);

  const checkFiles = migrationsToDowngrade.rows.map<string>(({ file }) => file);

  files
    .filter((migration) => checkFiles.includes(migration.file))
    .sort((a, b) => (a.index > b.index ? -1 : a.index < b.index ? 1 : 0))
    .filter((_, index) => index < limit)
    .forEach(async ({ file, index, path }) => {
      const sql = parseMigration(fs.readFileSync(path, 'utf8'), 'down');

      if (!sql) {
        console.log(`🌋  "${file}" is invalid!`);
        return;
      }

      console.log(`⬇️  downgrading > "${file}"`);

      await client.query(
        sql + `\nDELETE FROM ${table} WHERE index = ${index};`
      );
    });

  client.release();
}

async function migrateUp(pool: Pool, table: string, files: MigrationFile[]) {
  const client = await pool.connect();

  const lastMigrationQuery = await client.query(`
    SELECT index FROM ${table} ORDER BY index DESC LIMIT 1;
  `);

  const lastMigrationIndex: number = lastMigrationQuery.rows.length
    ? lastMigrationQuery.rows[0].index
    : -1;

  files
    .filter((migration) => migration.index > lastMigrationIndex)
    .sort((a, b) => (a.index > b.index ? 1 : a.index < b.index ? -1 : 0))
    .forEach(async ({ file, index, path }) => {
      const sql = parseMigration(fs.readFileSync(path, 'utf8'), 'up');

      if (!sql) {
        console.log(`🌋  "${file}" is invalid!`);
        return;
      }

      console.log(`⬆️  upgrading   > "${file}"`);

      await client.query(
        sql +
          `\nINSERT INTO ${table} ( index, file ) VALUES ( ${index}, '${file}' );`
      );
    });

  client.release();
}

export async function migratosaurus(
  pool: Pool,
  args: {
    amountToDownMigrate?: number;
    directory?: string;
    shouldUpMigrate?: boolean;
    table?: string;
  } = {}
) {
  const {
    directory = 'sql',
    amountToDownMigrate = 0,
    shouldUpMigrate = true,
    table = 'migration_history',
  } = args;

  console.log('🦖  migratosaurus initiated!');

  await initialize(pool, table);

  const files = getMigrationFiles(path.resolve(directory));

  if (amountToDownMigrate) {
    await migrateDown(pool, table, files, amountToDownMigrate);
  }

  if (shouldUpMigrate) {
    await migrateUp(pool, table, files);
  }

  console.log('🍾  migratosaurus completed!');
}
