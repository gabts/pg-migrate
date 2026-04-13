import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pg from "pg";
import { down, up } from "./main.js";

const databaseConfig: string | pg.ClientConfig = process.env.DATABASE_URL ?? {};
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
  const res = await client.query(`SELECT * FROM ${tableName} ORDER BY index;`);
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
  assert.equal(historyRows[0].index, 0);
  assert.equal(historyRows[0].file, "0-create.sql");
  assert.equal(personRows.length, 0);
}

async function assertMigration1(): Promise<void> {
  assert.ok(await queryTableExists(defaultMigrationHistoryTable));
  const historyRows = await queryHistory(defaultMigrationHistoryTable);
  const personRows = await queryPersons();

  assert.equal(historyRows.length, 2);
  assert.equal(historyRows[0].index, 0);
  assert.equal(historyRows[1].index, 1);
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

    assert.deepEqual(logs, [
      "🦖 migratorosaurus up initiated!",
      "🥚 performing first time setup",
      '↑  upgrading > "0-create.sql"',
      '↑  upgrading > "1-insert.sql"',
      "🌋 migratorosaurus up completed!",
      "🦖 migratorosaurus down initiated!",
      '↓  downgrading > "1-insert.sql"',
      "🌋 migratorosaurus down completed!",
    ]);
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

  it("surfaces postgres errors and rolls back setup", async (): Promise<void> => {
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

    assert.equal(await queryTableExists("person"), false);
    assert.equal(await queryTableExists(defaultMigrationHistoryTable), false);
  });
});
