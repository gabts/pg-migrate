import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pg from "pg";
import { messages } from "./log-messages.js";
import { down, up } from "./main.js";

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

const createPersonMigration = `-- % up-migration % --
CREATE TABLE person (
  id SERIAL PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
DROP TABLE person;
`;

const insertPeopleMigration = `-- % up-migration % --
INSERT INTO person (name)
VALUES ('gabriel'), ('david'), ('frasse');

-- % down-migration % --
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
    "0-create.sql": createPersonMigration,
    "1-insert.sql": insertPeopleMigration,
  });
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
  const res = await client.query(`SELECT * FROM ${tableName} ORDER BY file;`);
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

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, ms);
  });
}

async function assertMigration0(): Promise<void> {
  assert.ok(await queryTableExists(defaultMigrationHistoryTable));
  const historyRows = await queryHistory(defaultMigrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 1);
  assert.equal(historyRows[0].file, "0-create.sql");
  assert.equal(personRows.length, 0);
}

async function assertMigration1(): Promise<void> {
  assert.ok(await queryTableExists(defaultMigrationHistoryTable));
  const historyRows = await queryHistory(defaultMigrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 2);
  assert.equal(historyRows[0].file, "0-create.sql");
  assert.equal(historyRows[1].file, "1-insert.sql");
  assert.equal(personRows.length, 3);
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
    await up(databaseConfig, {
      directory: createStandardMigrationDirectory(),
    });

    await assertMigration1();
  });

  it("up migrates through a target migration", async (): Promise<void> => {
    await up(databaseConfig, {
      directory: createStandardMigrationDirectory(),
      target: "0-create.sql",
    });

    await assertMigration0();
  });

  it("down migrates one migration by default", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await up(databaseConfig, { directory });
    await down(databaseConfig, { directory });

    await assertMigration0();
  });

  it("down migrates to a target while leaving target applied", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    await up(databaseConfig, { directory });
    await down(databaseConfig, {
      directory,
      target: "0-create.sql",
    });

    await assertMigration0();
  });

  it("logs lifecycle messages for up and down", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory, log });
    await down(databaseConfig, { directory, log });

    const normalized = logs.map(normalizeMs);
    assert.deepEqual(
      normalized,
      [
        messages.startedUp(),
        messages.creatingTable(),
        messages.pending(2),
        "",
        messages.applying("0-create.sql"),
        messages.applied("0-create.sql", 0),
        "",
        messages.applying("1-insert.sql"),
        messages.applied("1-insert.sql", 0),
        messages.completedUp(),
        messages.startedDown(),
        messages.pending(1),
        "",
        messages.reverting("1-insert.sql", true),
        messages.reverted("1-insert.sql", 0),
        messages.completedDown(),
      ].map(normalizeMs),
    );
  });

  it("serializes concurrent up runners against the same history table", async (): Promise<void> => {
    const lockClient = new pg.Client(databaseConfig);
    await lockClient.connect();

    let firstSettled = false;
    let secondSettled = false;
    let lockTransactionOpen = false;
    let firstMigration: Promise<void> | undefined;
    let secondMigration: Promise<void> | undefined;

    try {
      await lockClient.query("BEGIN;");
      lockTransactionOpen = true;
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1));", [
        defaultMigrationHistoryTable,
      ]);

      firstMigration = up(databaseConfig, {
        directory: createStandardMigrationDirectory(),
      }).finally((): void => {
        firstSettled = true;
      });
      secondMigration = up(databaseConfig, {
        directory: createStandardMigrationDirectory(),
      }).finally((): void => {
        secondSettled = true;
      });

      await delay(100);
      assert.equal(firstSettled, false);
      assert.equal(secondSettled, false);

      await lockClient.query("COMMIT;");
      lockTransactionOpen = false;

      const results = await Promise.allSettled([
        firstMigration,
        secondMigration,
      ]);

      assert.deepEqual(
        results.map((result): string => result.status),
        ["fulfilled", "fulfilled"],
      );
    } finally {
      if (lockTransactionOpen) {
        await lockClient.query("ROLLBACK;");
      }
      await lockClient.end();
      if (firstMigration && secondMigration) {
        await Promise.allSettled([firstMigration, secondMigration]);
      }
    }

    await assertMigration1();
  });

  it("down migrates past an irreversible migration", async (): Promise<void> => {
    const irreversibleMigration = `-- % up-migration % --
INSERT INTO person (name)
VALUES ('gabriel'), ('david'), ('frasse');

-- % down-migration % --
`;

    const directory = createMigrationDirectory({
      "0-create.sql": createPersonMigration,
      "1-backfill.sql": irreversibleMigration,
    });

    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory });
    await down(databaseConfig, { directory, target: "0-create.sql", log });

    const historyRows = await queryHistory(defaultMigrationHistoryTable);
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].file, "0-create.sql");

    const personRows = await queryPersons();
    assert.equal(personRows.length, 3);

    assert.ok(
      logs.some(
        (l): boolean => l === messages.reverting("1-backfill.sql", false),
      ),
    );
  });

  it("surfaces postgres errors and rolls back the failing migration", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<void> =>
        up(databaseConfig, {
          directory: createMigrationDirectory({
            "0-break.sql": `-- % up-migration % --
CREATE TABLE person (
  id SERIALXXXXX PRIMARY KEY,
  name varchar(100) NOT NULL
);

-- % down-migration % --
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
      "0-create.sql": createPersonMigration,
      "1-insert.sql": insertPeopleMigration,
      "2-break.sql": `-- % up-migration % --
CREATE TABLE broken (
  id SERIALXXXXX PRIMARY KEY
);

-- % down-migration % --
DROP TABLE broken;
`,
    });

    await assert.rejects(
      (): Promise<void> => up(databaseConfig, { directory }),
      /type "serialxxxxx" does not exist/i,
    );

    // Migrations 0 and 1 committed in their own transactions; only
    // migration 2 rolled back.
    assert.ok(await queryTableExists("person"));
    assert.equal(await queryTableExists("broken"), false);

    const historyRows = await queryHistory(defaultMigrationHistoryTable);
    assert.equal(historyRows.length, 2);
    assert.equal(historyRows[0].file, "0-create.sql");
    assert.equal(historyRows[1].file, "1-insert.sql");

    const personRows = await queryPersons();
    assert.equal(personRows.length, 3);
  });

  it("down is a no-op when no migrations are applied", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await down(databaseConfig, { directory, log });

    assert.ok(logs.some((l): boolean => l === messages.pending(0)));
    assert.ok(logs.some((l): boolean => l === messages.nothingToRollback()));
  });

  it("down is a no-op when target is the latest applied migration", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory });
    await down(databaseConfig, { directory, target: "1-insert.sql", log });

    assert.ok(logs.some((l): boolean => l === messages.pending(0)));
    assert.ok(logs.some((l): boolean => l === messages.nothingToRollback()));
    await assertMigration1();
  });

  it("up dry run runs SQL but rolls back all changes", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory, dryRun: true, log });

    assert.ok(logs.some((l): boolean => l === messages.startedUp(true)));
    assert.ok(
      logs.some((l): boolean => l === messages.applying("0-create.sql")),
    );
    assert.ok(
      logs.some((l): boolean => l === messages.applying("1-insert.sql")),
    );
    assert.ok(logs.some((l): boolean => l === messages.completedUp()));
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
    assert.equal(await queryTableExists("person"), false);
  });

  it("up dry run keeps existing history table and rows unchanged", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory, target: "0-create.sql" });
    await up(databaseConfig, { directory, dryRun: true, log });

    assert.ok(logs.some((l): boolean => l === messages.startedUp(true)));
    assert.ok(
      logs.some((l): boolean => l === messages.applying("1-insert.sql")),
    );
    assert.ok(logs.some((l): boolean => l === messages.completedUp()));

    assert.ok(await queryTableExists(defaultMigrationHistoryTable));
    const historyRows = await queryHistory(defaultMigrationHistoryTable);
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].file, "0-create.sql");
    const personRows = await queryPersons();
    assert.equal(personRows.length, 0);
  });

  it("down dry run runs SQL but rolls back all changes", async (): Promise<void> => {
    const updateNamesMigration = `-- % up-migration % --
UPDATE person SET name = upper(name);

-- % down-migration % --
UPDATE person SET name = lower(name);
`;
    const directory = createMigrationDirectory({
      "0-create.sql": createPersonMigration,
      "1-insert.sql": insertPeopleMigration,
      "2-update.sql": updateNamesMigration,
    });
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory });
    await down(databaseConfig, {
      directory,
      dryRun: true,
      target: "0-create.sql",
      log,
    });

    assert.ok(logs.some((l): boolean => l === messages.startedDown(true)));
    assert.ok(logs.some((l): boolean => l === messages.pending(2)));
    assert.ok(
      logs.some((l): boolean => l === messages.reverting("2-update.sql", true)),
    );
    assert.ok(
      logs.some((l): boolean => l === messages.reverting("1-insert.sql", true)),
    );
    assert.ok(logs.some((l): boolean => l === messages.completedDown()));

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
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
    };

    await up(databaseConfig, { directory });
    await up(databaseConfig, { directory, target: "1-insert.sql", log });

    assert.ok(logs.some((l): boolean => l === messages.pending(0)));
    await assertMigration1();
  });

  it("up applies remaining migrations incrementally", async (): Promise<void> => {
    const directory = createStandardMigrationDirectory();

    await up(databaseConfig, { directory, target: "0-create.sql" });
    await assertMigration0();

    await up(databaseConfig, { directory });
    await assertMigration1();
  });

  it("up and down with a schema-qualified migration history table", async (): Promise<void> => {
    const schema = "migratorosaurus_main_test";
    const table = `${schema}.migration_history`;
    const directory = createStandardMigrationDirectory();

    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      await up(databaseConfig, { directory, table });

      assert.ok(await queryTableExists(table));
      const historyAfterUp = await queryHistory(`${schema}.migration_history`);
      assert.equal(historyAfterUp.length, 2);
      const personRows = await queryPersons();
      assert.equal(personRows.length, 3);

      await down(databaseConfig, { directory, table });

      const historyAfterDown = await queryHistory(
        `${schema}.migration_history`,
      );
      assert.equal(historyAfterDown.length, 1);
      assert.equal(historyAfterDown[0].file, "0-create.sql");
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
    }
  });

  describe("bulk migrations (100+)", (): void => {
    const MIGRATION_COUNT = 100;

    function createBulkMigrationDirectory(
      count: number,
      failAtIndex?: number,
    ): string {
      const files: Record<string, string> = {
        "000.sql": `-- % up-migration % --
CREATE TABLE bulk_test (value INTEGER PRIMARY KEY);

-- % down-migration % --
DROP TABLE bulk_test;
`,
      };

      for (let i = 1; i <= count; i++) {
        const file = `${String(i).padStart(3, "0")}.sql`;
        if (i === failAtIndex) {
          files[file] = `-- % up-migration % --
INSERT INTO bulk_test_nonexistent (value) VALUES (${i});

-- % down-migration % --
`;
        } else {
          files[file] = `-- % up-migration % --
INSERT INTO bulk_test (value) VALUES (${i});

-- % down-migration % --
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
      await up(databaseConfig, { directory });

      const historyRows = await queryHistory();
      assert.equal(historyRows.length, MIGRATION_COUNT + 1);
      assert.equal(historyRows[0].file, "000.sql");
      assert.equal(
        historyRows[MIGRATION_COUNT].file,
        `${String(MIGRATION_COUNT).padStart(3, "0")}.sql`,
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
        (): Promise<void> => up(databaseConfig, { directory }),
        /does not exist/i,
      );

      // 000.sql through 050.sql committed successfully (failAt entries)
      const historyRows = await queryHistory();
      assert.equal(historyRows.length, failAt);
      assert.equal(
        historyRows[failAt - 1].file,
        `${String(failAt - 1).padStart(3, "0")}.sql`,
      );

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), failAt - 1);
    });

    it("applies remaining migrations after partial completion", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);
      const midpoint = 50;
      const midpointFile = `${String(midpoint).padStart(3, "0")}.sql`;

      await up(databaseConfig, { directory, target: midpointFile });

      const historyAfterPartial = await queryHistory();
      assert.equal(historyAfterPartial.length, midpoint + 1);

      await up(databaseConfig, { directory });

      const historyAfterFull = await queryHistory();
      assert.equal(historyAfterFull.length, MIGRATION_COUNT + 1);

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), MIGRATION_COUNT);
    });

    it("down rolls back all applied migrations to target", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);

      await up(databaseConfig, { directory });
      await down(databaseConfig, { directory, target: "000.sql" });

      const historyRows = await queryHistory();
      assert.equal(historyRows.length, 1);
      assert.equal(historyRows[0].file, "000.sql");

      const { rows } = await client.query(
        "SELECT COUNT(*) AS n FROM bulk_test;",
      );
      assert.equal(Number(rows[0].n), 0);
    });

    it("up is a no-op when all migrations are already applied", async (): Promise<void> => {
      const directory = createBulkMigrationDirectory(MIGRATION_COUNT);

      await up(databaseConfig, { directory });
      await up(databaseConfig, { directory });

      const historyRows = await queryHistory();
      assert.equal(historyRows.length, MIGRATION_COUNT + 1);
    });
  });
});
