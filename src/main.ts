import * as fs from "fs";
import * as pg from "pg";

interface DiskMigration {
  file: string;
  index: number;
  path: string;
}

interface LoadedMigrations {
  all: DiskMigration[];
  byFile: Map<string, DiskMigration>;
}

interface AppliedRow {
  file: string;
  index: number;
}

interface TableNameParts {
  schema?: string;
  table: string;
}

interface MigrationOptions {
  directory?: string;
  log?: LogFn;
  table?: string;
  target?: string;
}

type LogFn = (...args: any[]) => void;

const conventionalTableNamePattern =
  /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;
const migrationFilePattern = /^\d+(?:-[A-Za-z0-9_.-]+)?\.sql$/;
const migrationMarkers = {
  up: "-- % up-migration % --",
  down: "-- % down-migration % --",
};

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

function parseMigrationIndex(file: string): number {
  const indexText = file.split(/[-_.]/)[0];
  if (!indexText || !indexText.match(/^\d+$/)) {
    throw new Error(`Invalid migration file name: ${file}`);
  }

  return Number.parseInt(indexText, 10);
}

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

function loadDiskMigrations(directory: string): LoadedMigrations {
  const files = fs.readdirSync(directory);
  const migrationFiles = files.filter((file): boolean => file.endsWith(".sql"));
  const invalidMigrationFile = migrationFiles.find(
    (file): boolean => !file.match(migrationFilePattern),
  );

  if (invalidMigrationFile) {
    throw new Error(`Invalid migration file name: ${invalidMigrationFile}`);
  }

  const all = migrationFiles.map(
    (file): DiskMigration => ({
      file,
      index: parseMigrationIndex(file),
      path: `${directory}/${file}`,
    }),
  );
  const byFile = new Map<string, DiskMigration>();
  const seenIndices = new Map<number, string>();

  for (const migration of all) {
    const existingFile = seenIndices.get(migration.index);
    if (existingFile) {
      throw new Error(
        `Duplicate migration index ${migration.index}: ${existingFile} and ${migration.file}`,
      );
    }

    seenIndices.set(migration.index, migration.file);
    byFile.set(migration.file, migration);
  }

  return { all, byFile };
}

function validateAppliedHistory(rows: AppliedRow[]): void {
  let previousIndex: number | null = null;

  for (const { file, index } of rows) {
    if (!file.match(migrationFilePattern)) {
      throw new Error(`Invalid applied migration file name: ${file}`);
    }

    const parsedIndex = parseMigrationIndex(file);
    if (index !== parsedIndex) {
      throw new Error(
        `Applied migration index mismatch for ${file}: expected ${parsedIndex}, found ${index}`,
      );
    }

    if (previousIndex !== null && index >= previousIndex) {
      throw new Error("Applied migration history is not strictly descending");
    }

    previousIndex = index;
  }
}

function validateAppliedFilesExistOnDisk(
  appliedRows: AppliedRow[],
  disk: LoadedMigrations,
): void {
  for (const { file } of appliedRows) {
    if (!disk.byFile.has(file)) {
      throw new Error(`Applied migration file is missing on disk: ${file}`);
    }
  }
}

function validateUpPreconditions(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): {
  latestApplied: AppliedRow | null;
  targetMigration: DiskMigration | null;
} {
  const { appliedRows, disk, target } = args;
  const appliedFiles = new Set(appliedRows.map(({ file }): string => file));
  const latestApplied = appliedRows[0] ?? null;
  const unappliedDiskMigrations = disk.all.filter(
    ({ file }): boolean => !appliedFiles.has(file),
  );
  const targetMigration = target ? disk.byFile.get(target) : undefined;

  if (target && !targetMigration) {
    throw new Error(`migratorosaurus: no such target file "${target}"`);
  }

  validateAppliedFilesExistOnDisk(appliedRows, disk);

  if (latestApplied) {
    if (targetMigration?.file === latestApplied.file) {
      return {
        latestApplied,
        targetMigration,
      };
    }

    for (const migration of unappliedDiskMigrations) {
      if (migration.index <= latestApplied.index) {
        throw new Error(
          `Out-of-order migration file "${migration.file}" has index ${migration.index}, which is not above latest applied index ${latestApplied.index}`,
        );
      }
    }

    if (
      targetMigration &&
      targetMigration.file !== latestApplied.file &&
      targetMigration.index < latestApplied.index
    ) {
      throw new Error(
        `Target migration "${targetMigration.file}" is behind latest applied migration "${latestApplied.file}"`,
      );
    }
  }

  return {
    latestApplied,
    targetMigration: targetMigration ?? null,
  };
}

function planUpExecution(args: {
  disk: LoadedMigrations;
  latestApplied: AppliedRow | null;
  targetMigration: DiskMigration | null;
}): DiskMigration[] {
  const latestAppliedIndex = args.latestApplied?.index ?? -1;
  const targetIndex = args.targetMigration?.index ?? Number.POSITIVE_INFINITY;

  return args.disk.all
    .filter(
      ({ index }): boolean =>
        index > latestAppliedIndex && index <= targetIndex,
    )
    .sort((a, b): number => a.index - b.index);
}

function planDownExecution(args: {
  appliedRows: AppliedRow[];
  disk: LoadedMigrations;
  target?: string;
}): DiskMigration[] {
  const { appliedRows, disk, target } = args;
  let rowsToRollback: AppliedRow[];

  if (!target) {
    rowsToRollback = appliedRows[0] ? [appliedRows[0]] : [];
  } else {
    const targetMigration = disk.byFile.get(target);
    if (!targetMigration) {
      throw new Error(`migratorosaurus: no such target file "${target}"`);
    }

    const targetRow = appliedRows.find(({ file }): boolean => file === target);
    if (!targetRow) {
      throw new Error(`Target migration is not applied: ${target}`);
    }

    rowsToRollback = appliedRows.filter(
      ({ index }): boolean => index > targetMigration.index,
    );
  }

  validateAppliedFilesExistOnDisk(rowsToRollback, disk);
  return rowsToRollback.map(({ file }): DiskMigration => disk.byFile.get(file)!);
}

async function initialize(
  client: pg.Client,
  log: LogFn,
  tableName: string,
): Promise<void> {
  const tableNameParts = parseTableName(tableName);
  const qualifiedTableName = qualifyTableName(tableNameParts);
  const { schema, table } = tableNameParts;

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

  if (!migrationTableQueryResult.rows[0].exists) {
    log("🥚 performing first time setup");
    await client.query(`
      CREATE TABLE ${qualifiedTableName}
      (
        index integer PRIMARY KEY,
        file text UNIQUE NOT NULL,
        date timestamptz NOT NULL
      );
    `);
  }
}

async function withMigrationTransaction<T>(args: {
  clientConfig: string | pg.ClientConfig;
  log: LogFn;
  run: (ctx: { appliedRows: AppliedRow[]; client: pg.Client }) => Promise<T>;
  table: string;
}): Promise<T> {
  const { clientConfig, log, run, table } = args;
  const client = new pg.Client(clientConfig);
  const qualifiedTableName = qualifyTableName(parseTableName(table));
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query("BEGIN;");
    transactionStarted = true;

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [table]);
    await initialize(client, log, table);
    await client.query(`LOCK TABLE ${qualifiedTableName} IN EXCLUSIVE MODE;`);

    const appliedRowsResult = await client.query<AppliedRow>(
      `SELECT index, file FROM ${qualifiedTableName} ORDER BY index DESC;`,
    );
    const appliedRows = appliedRowsResult.rows;
    validateAppliedHistory(appliedRows);

    const result = await run({ appliedRows, client });

    await client.query("COMMIT;");
    transactionStarted = false;
    return result;
  } catch (error) {
    log("☄️ migratorosaurus threw error!");
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Ignore rollback errors and surface the original failure.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function executeUpPlan(args: {
  client: pg.Client;
  log: LogFn;
  migrations: DiskMigration[];
  table: string;
}): Promise<void> {
  const { client, log, migrations, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, index, path } of migrations) {
    const sql = parseMigration(fs.readFileSync(path, "utf8"), "up", file);
    log(`↑  upgrading > "${file}"`);
    await client.query(sql);
    await client.query(
      `INSERT INTO ${qualifiedTableName} ( index, file, date ) VALUES ( $1, $2, clock_timestamp() );`,
      [index, file],
    );
  }
}

async function executeDownPlan(args: {
  client: pg.Client;
  log: LogFn;
  migrations: DiskMigration[];
  table: string;
}): Promise<void> {
  const { client, log, migrations, table } = args;
  const qualifiedTableName = qualifyTableName(parseTableName(table));

  for (const { file, path } of migrations) {
    const sql = parseMigration(
      fs.readFileSync(path, "utf8"),
      "down",
      file,
    );
    log(`↓  downgrading > "${file}"`);
    await client.query(sql);
    await client.query(`DELETE FROM ${qualifiedTableName} WHERE file = $1;`, [
      file,
    ]);
  }
}

function normalizeOptions(args: MigrationOptions): {
  directory: string;
  log: LogFn;
  table: string;
  target?: string;
} {
  return {
    directory: args.directory ?? "migrations",
    log: args.log ?? ((): undefined => undefined),
    table: args.table ?? "migration_history",
    target: args.target,
  };
}

export async function up(
  clientConfig: string | pg.ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { directory, log, table, target } = normalizeOptions(args);
  log("🦖 migratorosaurus up initiated!");

  const disk = loadDiskMigrations(directory);
  if (!disk.all.length) {
    log("🌋 migratorosaurus completed! no files found.");
    return;
  }

  await withMigrationTransaction({
    clientConfig,
    log,
    table,
    run: async ({ appliedRows, client }): Promise<void> => {
      const { latestApplied, targetMigration } = validateUpPreconditions({
        appliedRows,
        disk,
        target,
      });
      const migrations = planUpExecution({
        disk,
        latestApplied,
        targetMigration,
      });

      await executeUpPlan({ client, log, migrations, table });
    },
  });

  log("🌋 migratorosaurus up completed!");
}

export async function down(
  clientConfig: string | pg.ClientConfig,
  args: MigrationOptions = {},
): Promise<void> {
  const { directory, log, table, target } = normalizeOptions(args);
  log("🦖 migratorosaurus down initiated!");

  const disk = loadDiskMigrations(directory);

  await withMigrationTransaction({
    clientConfig,
    log,
    table,
    run: async ({ appliedRows, client }): Promise<void> => {
      const migrations = planDownExecution({
        appliedRows,
        disk,
        target,
      });

      await executeDownPlan({ client, log, migrations, table });
    },
  });

  log("🌋 migratorosaurus down completed!");
}
