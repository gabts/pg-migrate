import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

export async function pgup(
  pool: Pool,
  args: { directory?: string; table?: string } = {}
): Promise<void> {
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
        index integer PRIMARY KEY,
        file text UNIQUE NOT NULL,
        date timestamptz NOT NULL DEFAULT now()
      );
    `);

    console.log('pgup: Migrations table was created successfully.');
  }

  const lastMigrationQuery = await client.query(`
    SELECT index
    FROM ${table}
    ORDER BY index DESC
    LIMIT 1;
  `);

  const lastMigrationIndex: number = lastMigrationQuery.rows.length
    ? lastMigrationQuery.rows[0].index
    : -1;

  const dir = path.resolve(directory);

  const files = fs
    // Read files in migrations directory
    .readdirSync(dir)
    // Filter any files that does not start with a number, followed by either
    // a dash and some character or nothing, and ending with .sql
    .filter((file) => file.match(/^\d{1,}(\.\d{1,})?(-.*)?\.sql$/))
    // Add an object storing file index and name
    .map((file) => ({
      file,
      index: parseInt(file.split('-')[0], 10),
    }))
    // Filter files that are invalid
    .filter((migration) => migration.index > lastMigrationIndex)
    // Sort files by index ascending
    .sort((a, b) => {
      return a.index > b.index ? 1 : a.index < b.index ? -1 : 0;
    });

  for (const { index, file } of files) {
    console.log(`pgup: Found new migration "${file}". Upgrading...`);

    const sql = fs.readFileSync(`${dir}/${file}`, 'utf8');

    await client.query(sql);

    // Store migration in migrations table
    await client.query(`
      INSERT INTO ${table}
        ( index, file )
      VALUES
        ( ${index}, '${file}' );
    `);

    console.log(`pgup: "${file}" was upgraded successfully.`);
  }

  client.release();
}
