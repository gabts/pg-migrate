import * as assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import * as pg from "pg";
import {
  migrate,
  rollback,
  status,
  validate,
  type DatabaseOptions,
  type LogEvent,
} from "./main.js";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const testUrl = process.env.PGM_TEST_URL ?? "";
const firstVersion = "20260811120000";
const secondVersion = "20260811130000";
const thirdVersion = "20260811140000";

let admin: pg.Client | undefined;
let directory: string;
let schema: string;
let table: string;

function getAdmin(): pg.Client {
  if (!admin) {
    throw new Error("PostgreSQL test client is not connected.");
  }
  return admin;
}

function commandOptions(): DatabaseOptions {
  return { directory, table, url: testUrl };
}

function unqualifiedCommandOptions(): DatabaseOptions {
  const url = new URL(testUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return { directory, table: "schema_migrations", url: url.toString() };
}

function qualifiedRelation(name: string): string {
  return `"${schema}"."${name}"`;
}

async function writeMigration(
  version: string,
  name: string,
  upSql: string,
  downSql: string,
): Promise<string> {
  const file = `${version}_${name}.sql`;
  await fs.writeFile(
    path.join(directory, file),
    `-- migrate:up\n${upSql}\n-- migrate:down\n${downSql}\n`,
  );
  return file;
}

async function relationExists(name: string): Promise<boolean> {
  const result = await getAdmin().query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists;",
    [qualifiedRelation(name)],
  );
  return result.rows[0]?.exists ?? false;
}

async function readHistoryVersions(): Promise<string[]> {
  const result = await getAdmin().query<{ version: string }>(
    `SELECT version FROM ${qualifiedRelation("schema_migrations")} ` +
      "ORDER BY version;",
  );
  return result.rows.map((row) => row.version);
}

describe("PostgreSQL test configuration", (): void => {
  it("has a test database URL", (): void => {
    if (testUrl === "") {
      throw new Error("Set PGM_TEST_URL to run the test suite.");
    }
  });
});

describe(
  "PostgreSQL commands",
  {
    concurrency: false,
    skip: testUrl === "" ? "PGM_TEST_URL is not set." : false,
  },
  (): void => {
    beforeEach(async (): Promise<void> => {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-pg-"));
      schema = `pgmigrate_${process.pid}_${randomUUID().replaceAll("-", "")}`;
      table = `${schema}.schema_migrations`;
      admin = new pg.Client({ connectionString: testUrl });
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schema}";`);
    });

    afterEach(async (): Promise<void> => {
      try {
        if (admin) {
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
        }
      } finally {
        if (admin) {
          await admin.end();
          admin = undefined;
        }
        await fs.rm(directory, { recursive: true, force: true });
      }
    });

    it("handles missing history without creating it", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );

      const result = await status(commandOptions());

      assert.equal(result.initialized, false);
      assert.equal(result.current, null);
      assert.equal(result.next?.file, file);
      assert.deepEqual(result.summary, { applied: 0, pending: 1, total: 1 });
      assert.equal(await relationExists("schema_migrations"), false);

      assert.deepEqual(await rollback(commandOptions()), { files: [] });
      assert.equal(await relationExists("schema_migrations"), false);

      assert.deepEqual(await validate(commandOptions()), {
        applied: 0,
        pending: 1,
        total: 1,
      });
      assert.equal(await relationExists("schema_migrations"), false);
    });

    it("accepts an empty migration directory", async (): Promise<void> => {
      const migrationStatus = await status(commandOptions());

      assert.deepEqual(migrationStatus.summary, {
        applied: 0,
        pending: 0,
        total: 0,
      });
      assert.deepEqual(await validate(commandOptions()), {
        applied: 0,
        pending: 0,
        total: 0,
      });
      assert.deepEqual(await migrate(commandOptions()), { files: [] });
      assert.deepEqual(await rollback(commandOptions()), { files: [] });
      assert.equal(await relationExists("schema_migrations"), false);
    });

    it("does not use the global timestamp parser for status", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await migrate(commandOptions());
      const timestampType = pg.types.builtins.TIMESTAMPTZ;
      const originalParser = pg.types.getTypeParser(timestampType, "text");
      pg.types.setTypeParser(
        timestampType,
        "text",
        (value: string): string => value,
      );

      try {
        const result = await status(commandOptions());

        assert.equal(result.current?.file, file);
        assert.match(
          result.current?.appliedAt ?? "",
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
      } finally {
        pg.types.setTypeParser(timestampType, "text", originalParser);
      }
    });

    it("reports empty migration plans", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await migrate(commandOptions());

      for (const options of [
        commandOptions(),
        { ...commandOptions(), target: file },
      ]) {
        const events: LogEvent[] = [];
        await migrate({
          ...options,
          log(event): undefined {
            events.push(event);
          },
        });
        assert.equal(
          events.at(-2)?.type,
          "target" in options ? "target-current" : "no-pending",
        );
        assert.equal(events.at(-1)?.type, "database-disconnect-done");
        assert.equal(
          events.some((event) => event.type === "sql-read-start"),
          false,
        );
      }

      const targetEvents: LogEvent[] = [];
      await rollback({
        ...commandOptions(),
        log(event): undefined {
          targetEvents.push(event);
        },
        target: file,
      });
      assert.equal(targetEvents.at(-2)?.type, "target-current");
      assert.equal(targetEvents.at(-1)?.type, "database-disconnect-done");
      assert.equal(
        targetEvents.some((event) => event.type === "sql-read-start"),
        false,
      );

      await rollback(commandOptions());
      const events: LogEvent[] = [];
      await rollback({
        ...commandOptions(),
        log(event): undefined {
          events.push(event);
        },
      });
      assert.equal(events.at(-2)?.type, "no-applied");
      assert.equal(events.at(-1)?.type, "database-disconnect-done");
      assert.equal(
        events.some((event) => event.type === "sql-read-start"),
        false,
      );
    });

    it("applies, reports, validates, and reverts migrations", async (): Promise<void> => {
      const firstFile = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const secondFile = await writeMigration(
        secondVersion,
        "add_email",
        `ALTER TABLE ${qualifiedRelation("users")} ADD COLUMN email text;`,
        `ALTER TABLE ${qualifiedRelation("users")} DROP COLUMN email;`,
      );
      const thirdFile = await writeMigration(
        thirdVersion,
        "add_posts",
        `CREATE TABLE ${qualifiedRelation("posts")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("posts")};`,
      );

      const firstUp = await migrate({
        ...commandOptions(),
        target: secondVersion,
      });
      assert.deepEqual(firstUp, { files: [firstFile, secondFile] });
      assert.deepEqual(await readHistoryVersions(), [
        firstVersion,
        secondVersion,
      ]);

      assert.deepEqual(await validate(commandOptions()), {
        applied: 2,
        pending: 1,
        total: 3,
      });
      const firstStatus = await status(commandOptions());
      assert.equal(firstStatus.current?.file, secondFile);
      assert.ok(firstStatus.current?.appliedAt);
      assert.equal(firstStatus.next?.file, thirdFile);

      assert.deepEqual(await migrate(commandOptions()), { files: [thirdFile] });
      assert.equal(await relationExists("posts"), true);

      const targetedDown = await rollback({
        ...commandOptions(),
        target: firstFile,
      });
      assert.deepEqual(targetedDown, { files: [thirdFile, secondFile] });
      assert.deepEqual(await readHistoryVersions(), [firstVersion]);
      assert.equal(await relationExists("posts"), false);
      assert.equal(await relationExists("users"), true);

      assert.deepEqual(await rollback(commandOptions()), {
        files: [firstFile],
      });
      assert.deepEqual(await readHistoryVersions(), []);
      assert.equal(await relationExists("users"), false);
    });

    it("stores file identity and rejects content changes", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const filePath = path.join(directory, file);
      const contents = await fs.readFile(filePath);
      const checksum = createHash("sha256").update(contents).digest("hex");

      await migrate(commandOptions());

      const history = await getAdmin().query<{
        checksum: string;
        file: string;
      }>(
        `SELECT file, checksum FROM ${qualifiedRelation("schema_migrations")};`,
      );
      assert.deepEqual(history.rows, [{ checksum, file }]);

      await fs.appendFile(filePath, "-- changed\n");
      const error = new Error(
        `Applied migration file '${file}' does not match its recorded ` +
          "checksum.",
      );
      for (const command of [status, validate, migrate, rollback]) {
        await assert.rejects(command(commandOptions()), error);
      }
    });

    it("rejects a renamed applied migration", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await migrate(commandOptions());
      const renamedFile = `${firstVersion}_create_users.sql`;
      await fs.rename(
        path.join(directory, file),
        path.join(directory, renamedFile),
      );

      const error = new Error(
        `Applied migration version '${firstVersion}' was recorded with file ` +
          `'${file}', not '${renamedFile}'.`,
      );
      for (const command of [status, validate, migrate, rollback]) {
        await assert.rejects(command(commandOptions()), error);
      }
    });

    it("keeps an unqualified history table in one schema", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        "SET search_path TO pg_catalog;\n" +
          `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        "SET search_path TO pg_catalog;\n" +
          `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const options = unqualifiedCommandOptions();

      assert.deepEqual(await migrate(options), { files: [file] });
      assert.deepEqual(await readHistoryVersions(), [firstVersion]);
      assert.equal((await status(options)).current?.file, file);

      assert.deepEqual(await rollback(options), { files: [file] });
      assert.deepEqual(await readHistoryVersions(), []);
      assert.equal(await relationExists("users"), false);
    });

    it("validates SQL only for migrations in the plan", async (): Promise<void> => {
      const firstFile = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const secondFile = await writeMigration(
        secondVersion,
        "add_email",
        `ALTER TABLE ${qualifiedRelation("users")} ADD COLUMN email text;`,
        `ALTER TABLE ${qualifiedRelation("users")} DROP COLUMN email;`,
      );
      const thirdFile = `${thirdVersion}_add_posts.sql`;
      await fs.writeFile(path.join(directory, thirdFile), "SELECT 1;\n");

      assert.deepEqual(
        await migrate({ ...commandOptions(), target: firstFile }),
        {
          files: [firstFile],
        },
      );

      const currentStatus = await status(commandOptions());
      assert.equal(currentStatus.current?.file, firstFile);
      assert.equal(currentStatus.next?.file, secondFile);

      assert.deepEqual(
        await migrate({ ...commandOptions(), target: secondFile }),
        {
          files: [secondFile],
        },
      );
      assert.deepEqual(await rollback(commandOptions()), {
        files: [secondFile],
      });

      const sqlError = new Error(
        `Missing 'migrate:up' marker in '${thirdFile}'.`,
      );
      await assert.rejects(validate(commandOptions()), sqlError);
      assert.deepEqual(await rollback(commandOptions()), {
        files: [firstFile],
      });
      assert.deepEqual(await readHistoryVersions(), []);
    });

    it("reverts a migration with an empty down section", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        "-- Keep the table.",
      );
      await migrate(commandOptions());

      const result = await rollback(commandOptions());

      assert.deepEqual(result, { files: [file] });
      assert.equal(await relationExists("users"), true);
      assert.deepEqual(await readHistoryVersions(), []);
    });

    it("keeps committed migrations when a later migration fails", async (): Promise<void> => {
      await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await writeMigration(
        secondVersion,
        "add_posts",
        `CREATE TABLE ${qualifiedRelation("posts")} (id integer);\n` +
          `SELECT * FROM ${qualifiedRelation("missing")};`,
        `DROP TABLE ${qualifiedRelation("posts")};`,
      );

      await assert.rejects(migrate(commandOptions()));

      assert.equal(await relationExists("users"), true);
      assert.equal(await relationExists("posts"), false);
      assert.deepEqual(await readHistoryVersions(), [firstVersion]);
    });

    it("ignores log sink failures", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );

      const result = await migrate({
        ...commandOptions(),
        log(): undefined {
          throw new Error("Log sink failed.");
        },
      });

      assert.deepEqual(result, { files: [file] });
      assert.equal(await relationExists("users"), true);
      assert.deepEqual(await readHistoryVersions(), [firstVersion]);
    });

    it("refreshes applied checksums after waiting for the lock", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const filePath = path.join(directory, file);
      const original = await fs.readFile(filePath);
      await migrate(commandOptions());
      const lockClient = new pg.Client({ connectionString: testUrl });
      await lockClient.connect();

      try {
        for (const command of [migrate, rollback, validate]) {
          await fs.writeFile(filePath, original);
          await lockClient.query(
            "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
            [schema, "schema_migrations"],
          );

          let reportLockStart = (): void => {};
          const lockStarted = new Promise<void>((resolve) => {
            reportLockStart = resolve;
          });
          const result = command({
            ...commandOptions(),
            log(event): void {
              if (event.type === "lock-acquire-start") {
                reportLockStart();
              }
            },
          });
          await lockStarted;
          await fs.appendFile(filePath, "-- changed\n");
          await lockClient.query(
            "SELECT pg_advisory_unlock(hashtext($1), hashtext($2));",
            [schema, "schema_migrations"],
          );

          await assert.rejects(
            result,
            new Error(
              `Applied migration file '${file}' does not match its recorded ` +
                "checksum.",
            ),
          );
        }
      } finally {
        await lockClient.query(
          "SELECT pg_advisory_unlock(hashtext($1), hashtext($2));",
          [schema, "schema_migrations"],
        );
        await lockClient.end();
      }

      assert.deepEqual(await readHistoryVersions(), [firstVersion]);
      assert.equal(await relationExists("users"), true);
    });

    it("waits when another connection holds the migration lock", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const lockClient = new pg.Client({ connectionString: testUrl });
      await lockClient.connect();

      try {
        await lockClient.query(
          "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
          [schema, "schema_migrations"],
        );

        let reportLockStart = (): void => {};
        const lockStarted = new Promise<void>((resolve) => {
          reportLockStart = resolve;
        });
        const migration = migrate({
          ...commandOptions(),
          log(event): void {
            if (event.type === "lock-acquire-start") {
              reportLockStart();
            }
          },
        });
        await lockStarted;
        // Give PostgreSQL time to put the migration session in the wait queue.
        await setTimeout(50);
        await lockClient.query(
          "SELECT pg_advisory_unlock(hashtext($1), hashtext($2));",
          [schema, "schema_migrations"],
        );

        assert.deepEqual(await migration, { files: [file] });
      } finally {
        await lockClient.end();
      }

      assert.equal(await relationExists("schema_migrations"), true);
      assert.equal(await relationExists("users"), true);
    });

    it("uses independent locks for tables in different schemas", async (): Promise<void> => {
      const otherSchema = `${schema}_other`;
      await getAdmin().query(`CREATE SCHEMA "${otherSchema}";`);
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE "${otherSchema}"."users" (id integer);`,
        `DROP TABLE "${otherSchema}"."users";`,
      );
      const lockClient = new pg.Client({ connectionString: testUrl });
      await lockClient.connect();

      try {
        await lockClient.query(
          "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
          [schema, "schema_migrations"],
        );

        const result = await migrate({
          ...commandOptions(),
          table: `${otherSchema}.schema_migrations`,
        });

        assert.deepEqual(result, { files: [file] });
      } finally {
        await lockClient.end();
        await getAdmin().query(`DROP SCHEMA "${otherSchema}" CASCADE;`);
      }
    });

    it("rejects an invalid history table shape", async (): Promise<void> => {
      await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await getAdmin().query(`
        CREATE TABLE ${qualifiedRelation("schema_migrations")}
        (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      await assert.rejects(
        status(commandOptions()),
        new Error(
          `Migration history table '${table}' column 'version' must be ` +
            "'text', not 'integer'.",
        ),
      );
    });

    it("rejects a null applied timestamp", async (): Promise<void> => {
      await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await getAdmin().query(`
        CREATE TABLE ${qualifiedRelation("schema_migrations")}
        (
          version text PRIMARY KEY,
          file text NOT NULL,
          checksum text NOT NULL,
          applied_at timestamptz
        );
      `);
      await getAdmin().query(
        `INSERT INTO ${qualifiedRelation("schema_migrations")} ` +
          "(version, file, checksum, applied_at) VALUES ($1, $2, $3, NULL);",
        [firstVersion, `${firstVersion}_add_users.sql`, "checksum"],
      );

      await assert.rejects(
        status(commandOptions()),
        new Error(
          `Migration history table '${table}' column 'applied_at' must be ` +
            "NOT NULL.",
        ),
      );
    });
  },
);
