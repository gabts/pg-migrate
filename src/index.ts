import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

interface Args {
  directory?: string;
  table?: string;
}

export async function pgup(pool: Pool, args: Args = {}): Promise<void> {
  const { directory = 'sql', table = 'pgup_history' } = args;

  const client = await pool.connect();

  // Check if migrations table exists
  const migrationTableQueryResult = await client.query(`
    SELECT COUNT (*)
    FROM information_schema.tables
    WHERE table_name = '${table}';
  `);

  // If a migrations table does not exist
  if (migrationTableQueryResult.rows[0].count !== '1') {
    console.log('pgup: No migrations table found. Creating one...');

    await client.query(`
      CREATE TABLE ${table} (
        id serial PRIMARY KEY,
        file VARCHAR (100) UNIQUE NOT NULL
      );
    `);

    console.log('pgup: Migrations table was created successfully.');
  }

  const migrationsQueryResult = await client.query(`
    SELECT file
    FROM ${table}
    ORDER BY file ASC;
  `);

  const migrationHistoryFiles = migrationsQueryResult.rows.map((row) => {
    return row.file;
  });

  const dir = path.resolve(directory);

  // Read files inside migrations directory, filter any non .sql files and sort
  // them according to their index prefix in ascending order. Lastly add a
  // property whether the they have already been migrated.
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.match(/\.sql$/))
    .sort((fileA, fileB) => {
      const a = parseInt(fileA.split('-')[0], 10);
      const b = parseInt(fileB.split('-')[0], 10);

      return a > b ? 1 : a < b ? -1 : 0;
    })
    .map((file) => ({ file, migrated: migrationHistoryFiles.includes(file) }));

  for (const { file, migrated } of files) {
    // End loop if file has already been migrated. NOTE: Since migration files
    // are in descending order any unmigrated files that are after a migrated
    // file will be ignored.
    if (migrated) {
      return;
    }

    console.log(`pgup: Found new migration "${file}". Upgrading...`);

    const sql = fs.readFileSync(`${dir}/${file}`, 'utf8');

    await client.query(sql);

    // Store migration in migrations table
    await client.query(`
      INSERT INTO ${table} (
        file
      ) VALUES (
        '${file}'
      );
    `);

    console.log(`pgup: "${file}" was upgraded successfully.`);
  }

  client.release();
}
