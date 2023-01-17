import * as fs from 'fs';
import * as pg from 'pg';

interface MigrationFile {
  file: string;
  index: number;
  path: string;
}

const parseMatch = {
  up: /^--.*%.*up.*migration.*%.*--/,
  down: /^--.*%.*down.*migration.*%.*--/,
};

function parseMigration(sql: string, direction: 'up' | 'down') {
  return (
    sql
      .split(/(?=--.*%.*[(down|up)].*migration.*%.*--)/g)
      .find((str) => str.match(parseMatch[direction])) || ''
  );
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

async function initialize(
  client: pg.Client,
  log: (...args: any) => void,
  tableName: string
) {
  // Check if migrations table exists
  const migrationTableQueryResult = await client.query(`
    SELECT EXISTS (
      SELECT *
      FROM information_schema.tables
      WHERE table_name = '${tableName}'
    );
  `);

  // If migrations table does not exist, create it
  if (!migrationTableQueryResult.rows[0].exists) {
    log('🥚 performing first time setup');
    await client.query(`
      CREATE TABLE ${tableName}
      (
        index integer PRIMARY KEY,
        file text UNIQUE NOT NULL,
        date timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
}

async function downMigration(
  client: pg.Client,
  log: (...args: any) => void,
  table: string,
  files: MigrationFile[],
  lastIndex: number,
  targetFile: MigrationFile
) {
  const filesToDownMigrate = files
    .filter((migration) => {
      const isLastOrLower = migration.index <= lastIndex;
      const isTargetOrAbove = targetFile.index <= migration.index;
      return isTargetOrAbove && isLastOrLower;
    })
    .sort((a, b) => (a.index > b.index ? -1 : a.index < b.index ? 1 : 0))
    .map(({ file, index, path }) => {
      const sql = parseMigration(fs.readFileSync(path, 'utf8'), 'down');
      return { file, index, sql };
    });

  for (const { file, index, sql } of filesToDownMigrate) {
    log(`↓  downgrading > "${file}"`);
    await client.query(sql + `\nDELETE FROM ${table} WHERE index = ${index};`);
  }
}

async function upMigration(
  client: pg.Client,
  log: (...args: any) => void,
  table: string,
  files: MigrationFile[],
  lastIndex: number,
  targetFile?: MigrationFile
) {
  const filesToUpMigrate = files
    .filter((migration) => {
      const isAboveLast = migration.index > lastIndex;
      const hasTargetAndIsBelow = targetFile
        ? targetFile.index >= migration.index
        : true;
      return hasTargetAndIsBelow && isAboveLast;
    })
    .sort((a, b) => (a.index > b.index ? 1 : a.index < b.index ? -1 : 0))
    .map(({ file, index, path }) => {
      const sql = parseMigration(fs.readFileSync(path, 'utf8'), 'up');
      return { file, index, sql };
    });

  for (const { file, index, sql } of filesToUpMigrate) {
    log(`↑  upgrading > "${file}"`);
    await client.query(
      sql +
        `\nINSERT INTO ${table} ( index, file ) VALUES ( ${index}, '${file}' );`
    );
  }
}

export async function migratorosaurus(
  clientConfig: string | pg.ClientConfig,
  args: {
    directory?: string;
    log?: (...args: any) => void;
    table?: string;
    target?: string;
  } = {}
) {
  const {
    directory = 'migrations',
    log = () => undefined,
    table = 'migration_history',
    target,
  } = args;
  log('🦖 migratorosaurus initiated!');

  const files = getMigrationFiles(directory);
  if (!files.length) {
    log('🌋 migratorosaurus completed! no files found.');
    return;
  }

  const client = new pg.Client(clientConfig);

  try {
    await client.connect();
    await initialize(client, log, table);

    const lastMigrationQuery = await client.query(
      `SELECT index FROM ${table} ORDER BY index DESC LIMIT 1;`
    );

    const lastIndex = lastMigrationQuery.rowCount
      ? lastMigrationQuery.rows[0].index
      : -1;

    let targetFile: MigrationFile | undefined = undefined;
    if (target) {
      targetFile = files.find(({ file }) => file === target);
      if (!targetFile) {
        await client.end();
        throw new Error(`migratorosaurus: no such target file "${targetFile}"`);
      }
    }

    await client.query(`BEGIN; LOCK TABLE ${table} IN EXCLUSIVE MODE;`);
    targetFile && targetFile.index <= lastIndex
      ? await downMigration(client, log, table, files, lastIndex, targetFile)
      : await upMigration(client, log, table, files, lastIndex, targetFile);
    await client.query('COMMIT;');
  } catch(error) {
    log('☄️ migratorosaurus threw error!');
    await client.end();
    throw error;
  }

  await client.end();
  log('🌋 migratorosaurus completed!');
}
