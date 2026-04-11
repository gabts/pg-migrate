import * as fs from "fs";
import * as pg from "pg";

interface MigrationFile {
  file: string;
  index: number;
  path: string;
}

interface TableNameParts {
  schema?: string;
  table: string;
}

interface MigrationSql {
  file: string;
  index: number;
  sql: string;
}

const conventionalTableNamePattern =
  /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;

function parseTableName(tableName: string): TableNameParts {
  if (!tableName.match(conventionalTableNamePattern)) {
    throw new Error(`Invalid migration table name: ${tableName}`);
  }

  const parts = tableName.split(".");
  const [firstPart, secondPart] = parts;

  if (!secondPart) {
    return {
      table: firstPart!,
    };
  }

  return {
    schema: firstPart!,
    table: secondPart,
  };
}

function qualifyTableName({ schema, table }: TableNameParts): string {
  return schema ? `${schema}.${table}` : table;
}

const migrationMarkers = {
  up: "-- % up-migration % --",
  down: "-- % down-migration % --",
};
const migrationFilePattern = /^\d+(?:[-_.][A-Za-z0-9_-]+)*\.sql$/;

function parseMigration(
  sql: string,
  direction: "up" | "down",
  file: string,
): string {
  const upMarker = migrationMarkers.up;
  const downMarker = migrationMarkers.down;
  const upMarkerIndex = sql.indexOf(upMarker);
  const downMarkerIndex = sql.indexOf(downMarker);

  if (upMarkerIndex === -1 || downMarkerIndex === -1) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (
    sql.indexOf(upMarker, upMarkerIndex + upMarker.length) !== -1 ||
    sql.indexOf(downMarker, downMarkerIndex + downMarker.length) !== -1
  ) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (upMarkerIndex > downMarkerIndex) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  const upSql = sql
    .slice(upMarkerIndex + upMarker.length, downMarkerIndex)
    .trim();
  const downSql = sql.slice(downMarkerIndex + downMarker.length).trim();

  if (!upSql || !downSql) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  return direction === "up" ? upSql : downSql;
}

function parseMigrationDetails(file: string, dir: string): MigrationFile {
  const parts = file.split("-");
  if (!parts[0] || !parts[0].match(/^\d+$/)) {
    throw new Error(`Invalid migration file name: ${file}`);
  }

  const index = parseInt(parts[0], 10);
  if (isNaN(index)) {
    throw new Error(`Invalid migration file name: ${file}`);
  }

  return {
    file,
    index,
    path: `${dir}/${file}`,
  };
}

function getMigrationFiles(dir: string): MigrationFile[] {
  const files = fs.readdirSync(dir);
  const migrationFiles = files.filter((file): boolean => file.endsWith(".sql"));
  const invalidMigrationFile = migrationFiles.find(
    (file): boolean => !file.match(migrationFilePattern),
  );

  if (invalidMigrationFile) {
    throw new Error(`Invalid migration file name: ${invalidMigrationFile}`);
  }

  const parsedMigrationFiles = migrationFiles.map(
    (file): MigrationFile => parseMigrationDetails(file, dir),
  );
  const seenIndices = new Map<number, string>();

  for (const { file, index } of parsedMigrationFiles) {
    const existingFile = seenIndices.get(index);
    if (existingFile) {
      throw new Error(
        `Duplicate migration index ${index}: ${existingFile} and ${file}`,
      );
    }
    seenIndices.set(index, file);
  }

  return parsedMigrationFiles;
}

async function initialize(
  client: pg.Client,
  log: (...args: any) => void,
  tableName: string,
): Promise<void> {
  const tableNameParts = parseTableName(tableName);
  const qualifiedTableName = qualifyTableName(tableNameParts);
  const { schema, table } = tableNameParts;

  // Check if migrations table exists
  const migrationTableQueryResult = await client.query(
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

  // If migrations table does not exist, create it
  if (!migrationTableQueryResult.rows[0].exists) {
    log("🥚 performing first time setup");
    await client.query(`
      CREATE TABLE ${qualifiedTableName}
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
  targetFile: MigrationFile,
): Promise<void> {
  const qualifiedTableName = qualifyTableName(parseTableName(table));
  const filesToDownMigrate = files
    .filter((migration): boolean => {
      const isLastOrLower = migration.index <= lastIndex;
      const isTargetOrAbove = targetFile.index <= migration.index;
      return isTargetOrAbove && isLastOrLower;
    })
    .sort((a, b): number =>
      a.index > b.index ? -1 : a.index < b.index ? 1 : 0,
    )
    .map(({ file, index, path }): MigrationSql => {
      const sql = parseMigration(fs.readFileSync(path, "utf8"), "down", file);
      return { file, index, sql };
    });

  for (const { file, index, sql } of filesToDownMigrate) {
    log(`↓  downgrading > "${file}"`);
    await client.query(sql);
    await client.query(`DELETE FROM ${qualifiedTableName} WHERE index = $1;`, [
      index,
    ]);
  }
}

async function upMigration(
  client: pg.Client,
  log: (...args: any) => void,
  table: string,
  files: MigrationFile[],
  lastIndex: number,
  targetFile?: MigrationFile,
): Promise<void> {
  const qualifiedTableName = qualifyTableName(parseTableName(table));
  const filesToUpMigrate = files
    .filter((migration): boolean => {
      const isAboveLast = migration.index > lastIndex;
      const hasTargetAndIsBelow = targetFile
        ? targetFile.index >= migration.index
        : true;
      return hasTargetAndIsBelow && isAboveLast;
    })
    .sort((a, b): number =>
      a.index > b.index ? 1 : a.index < b.index ? -1 : 0,
    )
    .map(({ file, index, path }): MigrationSql => {
      const sql = parseMigration(fs.readFileSync(path, "utf8"), "up", file);
      return { file, index, sql };
    });

  for (const { file, index, sql } of filesToUpMigrate) {
    log(`↑  upgrading > "${file}"`);
    await client.query(sql);
    await client.query(
      `INSERT INTO ${qualifiedTableName} ( index, file ) VALUES ( $1, $2 );`,
      [index, file],
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
  } = {},
): Promise<void> {
  const {
    directory = "migrations",
    log = (): undefined => undefined,
    table = "migration_history",
    target,
  } = args;
  log("🦖 migratorosaurus initiated!");

  const files = getMigrationFiles(directory);
  if (!files.length) {
    log("🌋 migratorosaurus completed! no files found.");
    return;
  }

  const client = new pg.Client(clientConfig);
  let transactionStarted = false;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  try {
    await client.connect();
    await client.query("BEGIN;");
    transactionStarted = true;

    // Serialize migration runners before table initialization so first-run setup
    // and subsequent migration state reads happen from a single transaction view.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [table]);
    await initialize(client, log, table);
    await client.query(`LOCK TABLE ${qualifiedTableName} IN EXCLUSIVE MODE;`);

    const lastMigrationQuery = await client.query(
      `SELECT index FROM ${qualifiedTableName} ORDER BY index DESC LIMIT 1;`,
    );

    const lastIndex = lastMigrationQuery.rowCount
      ? lastMigrationQuery.rows[0].index
      : -1;

    let targetFile: MigrationFile | undefined = undefined;
    if (target) {
      targetFile = files.find(({ file }): boolean => file === target);
      if (!targetFile) {
        throw new Error(`migratorosaurus: no such target file "${target}"`);
      }
    }

    targetFile && targetFile.index <= lastIndex
      ? await downMigration(client, log, table, files, lastIndex, targetFile)
      : await upMigration(client, log, table, files, lastIndex, targetFile);

    await client.query("COMMIT;");
    transactionStarted = false;
  } catch (error) {
    log("☄️ migratorosaurus threw error!");
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Ignore rollback errors and surface the original failure.
      }
    }
    await client.end();
    throw error;
  }

  await client.end();
  log("🌋 migratorosaurus completed!");
}
