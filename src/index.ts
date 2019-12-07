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
        file VARCHAR (100) UNIQUE NOT NULL,
        date TIMESTAMPTZ NOT NULL
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

  const files = fs
    // Read files in migrations directory
    .readdirSync(dir)
    // Filter any files that does not start with a number, followed by either
    // a dash and some character or nothing, and ending with .sql
    .filter((file) => file.match(/^\d{1,}(\.\d{1,})?(-.*)?\.sql$/))
    // Sort files by index ascending
    .sort((fileA, fileB) => {
      const a = parseInt(fileA.split('-')[0], 10);
      const b = parseInt(fileB.split('-')[0], 10);

      return a > b ? 1 : a < b ? -1 : 0;
    })
    // Add an object storing whether file has been migrated
    .map((file) => ({
      file,
      migrated: migrationHistoryFiles.includes(file),
    }));

  const latestMigratedIndex = migrationHistoryFiles.reduce((acc, file) => {
    const index = parseInt(file.split('-')[0], 10);
    return index > acc ? index : acc;
  }, -1);

  for (const { file, migrated } of files) {
    if (migrated || parseInt(file.split('-')[0], 10) <= latestMigratedIndex) {
      continue;
    }

    console.log(`pgup: Found new migration "${file}". Upgrading...`);

    const sql = fs.readFileSync(`${dir}/${file}`, 'utf8');

    await client.query(sql);

    // Store migration in migrations table
    await client.query(`
      INSERT INTO ${table} (
        file,
        date
      ) VALUES (
        '${file}',
        NOW()
      );
    `);

    console.log(`pgup: "${file}" was upgraded successfully.`);
  }

  client.release();
}
