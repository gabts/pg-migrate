import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pg from "pg";
import { messages } from "./logging/messages.js";
import {
  down,
  up,
  validate,
  type Logger,
  type MigrationOptions,
  type ValidateOptions,
} from "./main.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run integration tests");
}

function normalizeMs(s: string): string {
  return s.replace(/\d+ms/, "<ms>");
}

const databaseConfig: string | pg.ClientConfig = process.env.DATABASE_URL;
const client = new pg.Client(databaseConfig);
const defaultMigrationHistoryTable = "migration_history";
const tempMigrationDirectories: string[] = [];
const standardCreateFile = "20260416090000_create.sql";
const standardInsertFile = "20260416090100_insert.sql";
const backfillFile = "20260416090100_backfill.sql";
const breakOnlyFile = "20260416090000_break.sql";
const breakAfterStandardFile = "20260416090200_break.sql";
const updateFile = "20260416090200_update.sql";

const createPersonMigration = `-- migrate:up
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- migrate:down
DROP TABLE person;
`;

const insertPeopleMigration = `-- migrate:up
INSERT INTO person (name)
VALUES ('gabriel'), ('david'), ('frasse');

-- migrate:down
DELETE FROM person
WHERE name IN ('gabriel', 'david', 'frasse');
`;

function createMigrationDirectory(files: Record<string, string> = {}): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "migratorosaurus-main-"),
  );
  tempMigrationDirectories.push(directory);

  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, file), content);
  }

  return directory;
}

function createStandardMigrationDirectory(): string {
  return createMigrationDirectory({
    [standardCreateFile]: createPersonMigration,
    [standardInsertFile]: insertPeopleMigration,
  });
}

function createMissingDirectory(prefix: string): string {
  const existing = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const missing = path.join(existing, "missing");
  fs.rmSync(existing, { force: true, recursive: true });
  return missing;
}

function removeTempMigrationDirectories(): void {
  while (tempMigrationDirectories.length > 0) {
    fs.rmSync(tempMigrationDirectories.pop()!, {
      recursive: true,
      force: true,
    });
  }
}

async function queryTableExists(tableName: string): Promise<boolean> {
  const [schema, table] = tableName.includes(".")
    ? tableName.split(".")
    : [undefined, tableName];
  const res = await client.query(
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

  return res.rows[0].exists;
}

async function queryHistory(tableName = "migration_history"): Promise<any[]> {
  const res = await client.query(
    `SELECT filename AS file, version, applied_at FROM ${tableName} ORDER BY filename;`,
  );
  return res.rows;
}

async function queryPersons(): Promise<any[]> {
  const res = await client.query("SELECT * FROM person;");
  return res.rows;
}

async function dropTables(): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS
      ${defaultMigrationHistoryTable},
      person;
  `);
}

async function createMigrationHistoryTable(
  tableName = defaultMigrationHistoryTable,
): Promise<void> {
  const [schema] = tableName.includes(".") ? tableName.split(".") : [undefined];
  if (schema) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
  }
  await client.query(`
    CREATE TABLE ${tableName}
    (
      filename text PRIMARY KEY,
      version text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function runUp(args: MigrationOptions): Promise<void> {
  const captured = await captureStderr(async (): Promise<void> => {
    await up(databaseConfig, { quiet: true, ...args });
  });
  assert.equal(captured.stderr, "");
}

async function runDown(args: MigrationOptions): Promise<void> {
  const captured = await captureStderr(async (): Promise<void> => {
    await down(databaseConfig, { quiet: true, ...args });
  });
  assert.equal(captured.stderr, "");
}

async function runValidate(args: ValidateOptions): Promise<void> {
  const captured = await captureStderr(async (): Promise<void> => {
    await validate(databaseConfig, { quiet: true, ...args });
  });
  assert.equal(captured.stderr, "");
}

async function assertMigration0(): Promise<void> {
  assert.ok(await queryTableExists(defaultMigrationHistoryTable));
  const historyRows = await queryHistory(defaultMigrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 1);
  assert.equal(historyRows[0].file, standardCreateFile);
  assert.equal(personRows.length, 0);
}

async function assertMigration1(): Promise<void> {
  assert.ok(await queryTableExists(defaultMigrationHistoryTable));
  const historyRows = await queryHistory(defaultMigrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 2);
  assert.equal(historyRows[0].file, standardCreateFile);
  assert.equal(historyRows[1].file, standardInsertFile);
  assert.equal(personRows.length, 3);
}

async function captureStderr<T>(run: () => Promise<T>): Promise<{
  result?: T;
  stderr: string;
}> {
  type StderrWriteArgs = Parameters<typeof process.stderr.write>;
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  const writeSpy = (...args: StderrWriteArgs): boolean => {
    const [chunk, encodingOrCallback, callback] = args;
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk).toString("utf8"));
    }

    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (typeof done === "function") {
      done();
    }
    return true;
  };

  Object.defineProperty(process.stderr, "write", {
    configurable: true,
    value: writeSpy as typeof process.stderr.write,
    writable: true,
  });

  try {
    const result = await run();
    return { result, stderr: chunks.join("") };
  } finally {
    Object.defineProperty(process.stderr, "write", {
      configurable: true,
      value: originalWrite,
      writable: true,
    });
  }
}

function stderrLogMessages(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((line): boolean => line !== "")
    .map((line): string => {
      const event = JSON.parse(line) as { message?: unknown };
      return typeof event.message === "string" ? event.message : "";
    });
}

describe("main", (): void => {
  before(async (): Promise<void> => {
    await client.connect();
    await dropTables();
  });

  after(async (): Promise<void> => {
    await client.end();
  });

  afterEach(async (): Promise<void> => {
    try {
      await dropTables();
    } finally {
      removeTempMigrationDirectories();
    }
  });

  it("up migrates all pending migrations", async (): Promise<void> => {
    await runUp({
      directory: createStandardMigrationDirectory(),
    });

    await assertMigration1();
  });

  it("up migrates through a target migration", async (): Promise<void> => {
    await runUp({
      directory: createStandardMigrationDirectory(),
      target: standardCreateFile,
    });

    await assertMigration0();
  });

  it("down migrates one migration by default", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await runUp({ directory });
    await runDown({ directory });

    await assertMigration0();
  });

  it("down migrates to a target while leaving target applied", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await runUp({ directory });
    await runDown({
      directory,
      target: standardCreateFile,
    });

    await assertMigration0();
  });

  it("fails fast when concurrent up cannot acquire advisory lock", async (): Promise<void> => {
    const lockClient = new pg.Client(databaseConfig);
    await lockClient.connect();

    let lockTransactionOpen = false;

    try {
      await lockClient.query("BEGIN;");
      lockTransactionOpen = true;
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        defaultMigrationHistoryTable,
      ]);

      await assert.rejects(
        (): Promise<void> =>
          runUp({
            directory: createStandardMigrationDirectory(),
          }),
        /Could not acquire advisory lock for migration table "migration_history"/,
      );
    } finally {
      if (lockTransactionOpen) {
        await lockClient.query("ROLLBACK;");
      }
      await lockClient.end();
    }
  });

  it("down migrates past an irreversible migration", async (): Promise<void> => {
    const irreversibleMigration = `-- migrate:up
INSERT INTO person (name)
VALUES ('gabriel'), ('david'), ('frasse');

-- migrate:down
`;

    const directory = createMigrationDirectory({
      [standardCreateFile]: createPersonMigration,
      [backfillFile]: irreversibleMigration,
    });

    await runUp({ directory });
    await runDown({
      directory,
      target: standardCreateFile,
    });

    const historyRows = await queryHistory(defaultMigrationHistoryTable);
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].file, standardCreateFile);

    const personRows = await queryPersons();
    assert.equal(personRows.length, 3);
  });

  it("validates the full migration set before running any SQL for up", async (): Promise<void> => {
    const invalidFile = "20260416090200_invalid.sql";
    const directory = createMigrationDirectory({
      [standardCreateFile]: createPersonMigration,
      [standardInsertFile]: insertPeopleMigration,
      [invalidFile]: "SELECT 1;",
    });

    await assert.rejects(
      (): Promise<void> => runUp({ directory }),
      /Invalid migration file contents: 20260416090200_invalid\.sql/,
    );

    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
    assert.equal(await queryTableExists("person"), false);
  });

  it("validates the full migration set before running any SQL for down", async (): Promise<void> => {
    const invalidFile = "20260416090200_invalid.sql";
    const directory = createStandardMigrationDirectory();
    await runUp({ directory });
    fs.writeFileSync(path.join(directory, invalidFile), "SELECT 1;");

    await assert.rejects(
      (): Promise<void> => runDown({ directory }),
      /Invalid migration file contents: 20260416090200_invalid\.sql/,
    );

    await assertMigration1();
  });

  it("surfaces postgres errors and rolls back the failing migration", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<void> =>
        runUp({
          directory: createMigrationDirectory({
            [breakOnlyFile]: `-- migrate:up
CREATE TABLE person (
  id SERIALXXXXX PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- migrate:down
DROP TABLE person;
`,
          }),
        }),
      /type "serialxxxxx" does not exist/i,
    );

    // The failing migration's transaction rolls back, so person is not
    // created. The history table is set up in its own transaction and
    // survives the failure with no rows recorded.
    assert.equal(await queryTableExists("person"), false);
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), true);
    assert.deepEqual(await queryHistory(), []);
  });

  it("commits earlier migrations and rolls back only the failing one", async (): Promise<void> => {
    const directory = createMigrationDirectory({
      [standardCreateFile]: createPersonMigration,
      [standardInsertFile]: insertPeopleMigration,
      [breakAfterStandardFile]: `-- migrate:up
CREATE TABLE broken (
  id SERIALXXXXX PRIMARY KEY
);

-- migrate:down
DROP TABLE broken;
`,
    });

    await assert.rejects(
      (): Promise<void> => runUp({ directory }),
      /type "serialxxxxx" does not exist/i,
    );

    // Migrations 0 and 1 committed in their own transactions; only
    // migration 2 rolled back.
    assert.ok(await queryTableExists("person"));
    assert.equal(await queryTableExists("broken"), false);

    const historyRows = await queryHistory(defaultMigrationHistoryTable);
    assert.equal(historyRows.length, 2);
    assert.equal(historyRows[0].file, standardCreateFile);
    assert.equal(historyRows[1].file, standardInsertFile);

    const personRows = await queryPersons();
    assert.equal(personRows.length, 3);
  });

  it("down is a no-op when no migrations are applied", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await runDown({ directory });
    assert.ok(await queryTableExists(defaultMigrationHistoryTable));
    assert.deepEqual(await queryHistory(defaultMigrationHistoryTable), []);
  });

  it("down is a no-op when target is the latest applied migration", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();

    await runUp({ directory });
    await runDown({ directory, target: standardInsertFile });
    await assertMigration1();
  });

  it("up dry run runs SQL but rolls back all changes", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await runUp({ directory, dryRun: true });
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
    assert.equal(await queryTableExists("person"), false);
  });

  it("up dry run keeps existing history table and rows unchanged", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();

    await runUp({ directory, target: standardCreateFile });
    await runUp({ directory, dryRun: true });

    assert.ok(await queryTableExists(defaultMigrationHistoryTable));
    const historyRows = await queryHistory(defaultMigrationHistoryTable);
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].file, standardCreateFile);
    const personRows = await queryPersons();
    assert.equal(personRows.length, 0);
  });

  it("down dry run runs SQL but rolls back all changes", async (): Promise<void> => {
    const updateNamesMigration = `-- migrate:up
UPDATE person SET name = upper(name);

-- migrate:down
UPDATE person SET name = lower(name);
`;
    const directory = createMigrationDirectory({
      [standardCreateFile]: createPersonMigration,
      [standardInsertFile]: insertPeopleMigration,
      [updateFile]: updateNamesMigration,
    });

    await runUp({ directory });
    await runDown({
      directory,
      dryRun: true,
      target: standardCreateFile,
    });

    const historyRows = await queryHistory();
    assert.equal(historyRows.length, 3);
    const personRows = await queryPersons();
    assert.deepEqual(
      personRows.map((r): string => r.name),
      ["GABRIEL", "DAVID", "FRASSE"],
    );
  });

  it("up is a no-op when target equals latest applied migration", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();

    await runUp({ directory });
    await runUp({ directory, target: standardInsertFile });
    await assertMigration1();
  });

  it("up applies remaining migrations incrementally", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();

    await runUp({ directory, target: standardCreateFile });
    await assertMigration0();

    await runUp({ directory });
    await assertMigration1();
  });

  it("up and down with a schema-qualified migration history table", async (): Promise<void> => {
    const schema = "migratorosaurus_main_test";
    const table = `${schema}.migration_history`;
    const directory = createStandardMigrationDirectory();

    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      await runUp({ directory, table });

      assert.ok(await queryTableExists(table));
      const historyAfterUp = await queryHistory(`${schema}.migration_history`);
      assert.equal(historyAfterUp.length, 2);
      const personRows = await queryPersons();
      assert.equal(personRows.length, 3);

      await runDown({ directory, table });

      const historyAfterDown = await queryHistory(
        `${schema}.migration_history`,
      );
      assert.equal(historyAfterDown.length, 1);
      assert.equal(historyAfterDown[0].file, standardCreateFile);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
    }
  });

  it("validate succeeds without mutating applied migration state", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await runUp({ directory, target: standardCreateFile });

    await runValidate({ directory });

    await assertMigration0();
  });

  it("validate does not create a missing history table", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();

    await assert.rejects(
      (): Promise<void> => runValidate({ directory }),
      /Migration history table does not exist: migration_history/,
    );

    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
    assert.equal(await queryTableExists("person"), false);
  });

  it("validate rejects history gaps without mutating state", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await createMigrationHistoryTable();
    await client.query(
      `INSERT INTO ${defaultMigrationHistoryTable} (filename, version) VALUES ($1, $2);`,
      [standardInsertFile, "20260416090100"],
    );

    await assert.rejects(
      (): Promise<void> => runValidate({ directory }),
      new RegExp(
        `Gap in applied migration history: "${standardCreateFile}" is not applied`,
      ),
    );

    const historyRows = await queryHistory();
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].file, standardInsertFile);
    assert.equal(historyRows[0].version, "20260416090100");
    assert.equal(await queryTableExists("person"), false);
  });

  it("validate rejects version mismatches without mutating state", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await createMigrationHistoryTable();
    await client.query(
      `INSERT INTO ${defaultMigrationHistoryTable} (filename, version) VALUES ($1, $2);`,
      [standardCreateFile, "20260416090001"],
    );

    await assert.rejects(
      (): Promise<void> => runValidate({ directory }),
      new RegExp(
        `Applied migration version mismatch for file "${standardCreateFile}": expected "20260416090000", got "20260416090001"`,
      ),
    );

    const historyRows = await queryHistory();
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].file, standardCreateFile);
    assert.equal(historyRows[0].version, "20260416090001");
    assert.equal(await queryTableExists("person"), false);
  });

  it("validate supports schema-qualified migration history tables", async (): Promise<void> => {
    const schema = "migratorosaurus_validate_test";
    const table = `${schema}.migration_history`;
    const directory = createStandardMigrationDirectory();

    try {
      await createMigrationHistoryTable(table);
      await runValidate({ directory, table });

      assert.ok(await queryTableExists(table));
      assert.deepEqual(await queryHistory(table), []);
      assert.equal(await queryTableExists("person"), false);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
    }
  });

  describe("bulk migrations (100+)", function (this: Mocha.Suite): void {
    this.timeout(30000);

    const MIGRATION_COUNT = 100;
    const bulkBaseVersion = 20260416090000;

    function bulkFileForIndex(index: number): string {
      return `${String(bulkBaseVersion + index)}_bulk_${String(index).padStart(3, "0")}.sql`;
    }

    function createBulkMigrationDirectory(
      count: number,
      failAtIndex?: number,
    ): string {
      const files: Record<string, string> = {
        [bulkFileForIndex(0)]: `-- migrate:up
CREATE TABLE bulk_test (value INTEGER PRIMARY KEY);

-- migrate:down
DROP TABLE bulk_test;
`,
      };

      for (let i = 1; i <= count; i++) {
        const file = bulkFileForIndex(i);
        if (i === failAtIndex) {
          files[file] = `-- migrate:up
INSERT INTO bulk_test_nonexistent (value) VALUES (${i});

-- migrate:down
`;
        } else {
          files[file] = `-- migrate:up
INSERT INTO bulk_test (value) VALUES (${i});

-- migrate:down
DELETE FROM bulk_test WHERE value = ${i};
`;
        }
      }

      return createMigrationDirectory(files);
    }

    afterEach(async (): Promise<void> => {
      await client.query("DROP TABLE IF EXISTS bulk_test;");
    });

    it("up applies all migrations successfully", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);
      await runUp({ directory });

      const historyRows = await queryHistory();
      assert.equal(historyRows.length, MIGRATION_COUNT + 1);
      assert.equal(historyRows[0].file, bulkFileForIndex(0));
      assert.equal(
        historyRows[MIGRATION_COUNT].file,
        bulkFileForIndex(MIGRATION_COUNT),
      );

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), MIGRATION_COUNT);
    });

    it("commits earlier migrations when a later one fails", async (): Promise<void> => {
      const failAt = 51;
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT, failAt);

      await assert.rejects(
        (): Promise<void> => runUp({ directory }),
        /does not exist/i,
      );

      // Migration 0 through 50 committed successfully (failAt entries)
      const historyRows = await queryHistory();
      assert.equal(historyRows.length, failAt);
      assert.equal(historyRows[failAt - 1].file, bulkFileForIndex(failAt - 1));

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), failAt - 1);
    });

    it("applies remaining migrations after partial completion", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);
      const midpoint = 50;
      const midpointFile = bulkFileForIndex(midpoint);

      await runUp({ directory, target: midpointFile });

      const historyAfterPartial = await queryHistory();
      assert.equal(historyAfterPartial.length, midpoint + 1);

      await runUp({ directory });

      const historyAfterFull = await queryHistory();
      assert.equal(historyAfterFull.length, MIGRATION_COUNT + 1);

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), MIGRATION_COUNT);
    });

    it("down rolls back all applied migrations to target", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);

      await runUp({ directory });
      await runDown({ directory, target: bulkFileForIndex(0) });

      const historyRows = await queryHistory();
      assert.equal(historyRows.length, 1);
      assert.equal(historyRows[0].file, bulkFileForIndex(0));

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), 0);
    });

    it("up is a no-op when all migrations are already applied", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);

      await runUp({ directory });
      await runUp({ directory });

      const historyRows = await queryHistory();
      assert.equal(historyRows.length, MIGRATION_COUNT + 1);
    });
  });

  describe("logging", (): void => {
    it("logs lifecycle messages for up and down in order", async (): Promise<void> => {
      const directory = createStandardMigrationDirectory();
      const captured = await captureStderr(async (): Promise<void> => {
        await up(databaseConfig, { directory });
        await down(databaseConfig, { directory });
      });

      const observed = stderrLogMessages(captured.stderr);

      assert.deepEqual(
        observed.map(normalizeMs),
        [
          messages.startedUp(),
          messages.creatingTable(),
          messages.pending(2),
          messages.applying(standardCreateFile),
          messages.applied(standardCreateFile, 0),
          messages.applying(standardInsertFile),
          messages.applied(standardInsertFile, 0),
          messages.completedUp(),
          messages.startedDown(),
          messages.pending(1),
          messages.reverting(standardInsertFile, true),
          messages.reverted(standardInsertFile, 0),
          messages.completedDown(),
        ].map(normalizeMs),
      );
    });

    it("writes logs to stderr by default for up failures", async (): Promise<void> => {
      const missingDirectory = createMissingDirectory("migratorosaurus-up-");
      const captured = await captureStderr(async (): Promise<void> => {
        await assert.rejects(
          (): Promise<void> =>
            up("postgres://localhost:5432/example", {
              directory: missingDirectory,
            }),
        );
      });

      assert.match(captured.stderr, /started migration run/);
      assert.match(captured.stderr, /migration run aborted/);
    });

    it("logs lifecycle messages for validate in order", async (): Promise<void> => {
      const directory = createStandardMigrationDirectory();
      await runUp({ directory, target: standardCreateFile });

      const captured = await captureStderr(async (): Promise<void> => {
        await validate(databaseConfig, { directory });
      });

      const observed = stderrLogMessages(captured.stderr);

      assert.deepEqual(observed, [
        messages.startedValidate(),
        messages.validationSummary(1, 1, 1),
        messages.completedValidate(),
      ]);
    });

    it("logs abort message for validate failures", async (): Promise<void> => {
      const missingDirectory = createMissingDirectory(
        "migratorosaurus-validate-",
      );
      const captured = await captureStderr(async (): Promise<void> => {
        await assert.rejects(
          (): Promise<void> =>
            validate("postgres://localhost:5432/example", {
              directory: missingDirectory,
            }),
        );
      });

      assert.match(captured.stderr, /started validation/);
      assert.match(captured.stderr, /validation aborted/);
    });

    it("keeps abort logs in quiet mode while suppressing non-errors", async (): Promise<void> => {
      const missingDirectory = createMissingDirectory("migratorosaurus-down-");
      const captured = await captureStderr(async (): Promise<void> => {
        await assert.rejects(
          (): Promise<void> =>
            down("postgres://localhost:5432/example", {
              directory: missingDirectory,
              quiet: true,
            }),
        );
      });

      assert.doesNotMatch(captured.stderr, /started rollback/);
      assert.match(captured.stderr, /rollback aborted/);
    });

    it("applies quiet and verbose filtering to custom loggers", async (): Promise<void> => {
      const missingDirectory = createMissingDirectory(
        "migratorosaurus-custom-logger-",
      );
      const logs: string[] = [];
      const logger: Logger = {
        debug(message: string): void {
          logs.push(`debug:${message}`);
        },
        error(message: string): void {
          logs.push(`error:${message}`);
        },
        info(message: string): void {
          logs.push(`info:${message}`);
        },
        warn(message: string): void {
          logs.push(`warn:${message}`);
        },
      };

      await assert.rejects(
        (): Promise<void> =>
          validate("postgres://localhost:5432/example", {
            directory: missingDirectory,
            logger,
            quiet: true,
            verbose: true,
          }),
      );

      assert.deepEqual(logs, [`error:${messages.abortedValidate()}`]);
    });

    it("suppresses custom logger debug messages unless verbose is enabled", async (): Promise<void> => {
      const missingDirectory = createMissingDirectory(
        "migratorosaurus-custom-logger-debug-",
      );
      const logs: string[] = [];
      const logger: Logger = {
        debug(message: string): void {
          logs.push(`debug:${message}`);
        },
        error(message: string): void {
          logs.push(`error:${message}`);
        },
        info(message: string): void {
          logs.push(`info:${message}`);
        },
        warn(message: string): void {
          logs.push(`warn:${message}`);
        },
      };

      await assert.rejects(
        (): Promise<void> =>
          validate("postgres://localhost:5432/example", {
            directory: missingDirectory,
            logger,
          }),
      );

      assert.deepEqual(logs, [
        `info:${messages.startedValidate()}`,
        `error:${messages.abortedValidate()}`,
      ]);
    });
  });
});
