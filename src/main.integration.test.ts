import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as pg from "pg";
import {
  migrate,
  repair,
  rollback,
  status,
  validate,
  type DatabaseOptions,
  type LogEvent,
  type RepairResult,
} from "./main.js";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const testUrl = process.env.PGM_TEST_URL ?? "";
const firstVersion = "20260811120000";
const secondVersion = "20260811130000";
const thirdVersion = "20260811140000";
const cliPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bin/cli.js",
);

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

async function readHistoryEvents(): Promise<string[]> {
  const result = await getAdmin().query<{ action: string; version: string }>(
    "SELECT action, version " +
      `FROM ${qualifiedRelation("schema_migrations")} ORDER BY id;`,
  );
  return result.rows.map((row) => `${row.action} ${row.version}`);
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

    it("rejects a history table in a missing schema", async (): Promise<void> => {
      const options = {
        ...commandOptions(),
        table: `${schema}_missing.schema_migrations`,
      };

      await assert.rejects(
        validate(options),
        new Error(`Schema '${schema}_missing' does not exist.`),
      );
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
      assert.deepEqual(await readHistoryEvents(), [
        `apply ${firstVersion}`,
        `apply ${secondVersion}`,
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
      assert.deepEqual(await readHistoryEvents(), [
        `apply ${firstVersion}`,
        `apply ${secondVersion}`,
        `apply ${thirdVersion}`,
        `revert ${thirdVersion}`,
        `revert ${secondVersion}`,
      ]);
      assert.equal(await relationExists("posts"), false);
      assert.equal(await relationExists("users"), true);

      assert.deepEqual(await rollback(commandOptions()), {
        files: [firstFile],
      });
      assert.deepEqual(await readHistoryEvents(), [
        `apply ${firstVersion}`,
        `apply ${secondVersion}`,
        `apply ${thirdVersion}`,
        `revert ${thirdVersion}`,
        `revert ${secondVersion}`,
        `revert ${firstVersion}`,
      ]);
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

    it("records every history change as an event", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      const contents = await fs.readFile(path.join(directory, file));
      const checksum = createHash("sha256").update(contents).digest("hex");
      await migrate(commandOptions());
      await rollback(commandOptions());
      await migrate(commandOptions());
      const renamedFile = `${firstVersion}_create_users.sql`;
      await fs.rename(
        path.join(directory, file),
        path.join(directory, renamedFile),
      );
      await repair({ ...commandOptions(), target: firstVersion });

      const events = await getAdmin().query(
        "SELECT action, version, file, checksum, " +
          "executed_by = session_user AS by_session_user, " +
          "to_char(executed_at AT TIME ZONE 'UTC', " +
          `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS executed_at ` +
          `FROM ${qualifiedRelation("schema_migrations")} ORDER BY id;`,
      );
      const event = {
        by_session_user: true,
        checksum,
        file,
        version: firstVersion,
      };
      assert.deepEqual(
        events.rows.map(({ executed_at: _, ...row }) => row),
        [
          { ...event, action: "apply" },
          { ...event, action: "revert" },
          { ...event, action: "apply" },
          { ...event, action: "repair", file: renamedFile },
        ],
      );

      // The applied time stays at the latest apply event after a repair.
      const migrationStatus = await status(commandOptions());
      assert.deepEqual(migrationStatus.summary, {
        applied: 1,
        pending: 0,
        total: 1,
      });
      assert.equal(migrationStatus.current?.file, renamedFile);
      assert.equal(
        migrationStatus.current?.appliedAt,
        events.rows[2]?.executed_at,
      );
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

    it("repairs a renamed applied migration", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      await migrate(commandOptions());
      // Repair reads only its target, so this invalid pending file is skipped.
      await fs.writeFile(
        path.join(directory, `${secondVersion}_add_posts.sql`),
        "SELECT 2;\n",
      );
      const renamedFile = `${firstVersion}_create_users.sql`;
      await fs.rename(
        path.join(directory, file),
        path.join(directory, renamedFile),
      );

      const events: string[] = [];

      assert.deepEqual(
        await repair({
          ...commandOptions(),
          log(event): void {
            events.push(event.type);
          },
          target: renamedFile,
        }),
        { file: renamedFile },
      );
      assert.deepEqual(
        events.filter((type) => /^(lock|applied-read|repair)-/.test(type)),
        [
          "lock-acquire-start",
          "lock-acquire-done",
          "applied-read-start",
          "applied-read-done",
          "repair-start",
          "repair-done",
        ],
      );
      const history = await getAdmin().query<{ action: string; file: string }>(
        "SELECT action, file " +
          `FROM ${qualifiedRelation("schema_migrations")} ORDER BY id;`,
      );
      assert.deepEqual(history.rows, [
        { action: "apply", file },
        { action: "repair", file: renamedFile },
      ]);
      assert.deepEqual(await rollback(commandOptions()), {
        files: [renamedFile],
      });
      assert.equal(await relationExists("users"), false);
    });

    it("repairs one applied migration at a time", async (): Promise<void> => {
      const firstFile = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      const secondFile = await writeMigration(
        secondVersion,
        "add_posts",
        "SELECT 2;",
        "",
      );
      await migrate(commandOptions());
      await fs.appendFile(path.join(directory, firstFile), "-- changed\n");
      await fs.appendFile(path.join(directory, secondFile), "-- changed\n");

      await repair({ ...commandOptions(), target: firstVersion });
      await assert.rejects(
        validate(commandOptions()),
        new Error(
          `Applied migration file '${secondFile}' does not match its ` +
            "recorded checksum.",
        ),
      );
      await repair({ ...commandOptions(), target: secondVersion });
      assert.deepEqual(await validate(commandOptions()), {
        applied: 2,
        pending: 0,
        total: 2,
      });
    });

    it("rejects a repair of an unchanged or unapplied migration", async (): Promise<void> => {
      const firstFile = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      const secondFile = await writeMigration(
        secondVersion,
        "add_posts",
        "SELECT 2;",
        "",
      );
      await assert.rejects(
        repair({ ...commandOptions(), target: firstVersion }),
        new Error(`Migration target '${firstFile}' is not applied.`),
      );
      assert.equal(await relationExists("schema_migrations"), false);
      await migrate({ ...commandOptions(), target: firstVersion });

      await assert.rejects(
        repair({ ...commandOptions(), target: firstVersion }),
        new Error(
          `Applied migration file '${firstFile}' already matches its history.`,
        ),
      );
      await assert.rejects(
        repair({ ...commandOptions(), target: secondVersion }),
        new Error(`Migration target '${secondFile}' is not applied.`),
      );
    });

    it("wraps a failed repair write", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      await migrate(commandOptions());
      await getAdmin().query(
        `ALTER TABLE ${qualifiedRelation("schema_migrations")} ` +
          "ADD CHECK (file NOT LIKE '%renamed%');",
      );
      const renamedFile = `${firstVersion}_renamed_users.sql`;
      await fs.rename(
        path.join(directory, file),
        path.join(directory, renamedFile),
      );

      await assert.rejects(
        repair({ ...commandOptions(), target: firstVersion }),
        (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            `Failed to repair migration '${renamedFile}'.`,
          );
          assert.ok(error.cause instanceof pg.DatabaseError);
          return true;
        },
      );
    });

    it("writes the repaired file to stdout", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      await migrate(commandOptions());
      await fs.appendFile(path.join(directory, file), "-- changed\n");

      const { stdout, stderr } = await promisify(execFile)(process.execPath, [
        ...[cliPath, "repair", firstVersion, "--url", testUrl],
        ...["--directory", directory, "--table", table],
      ]);
      assert.equal(stdout, `Repaired migration '${file}'.\n`);
      assert.equal(stderr, "Running pg-migrate repair...\n");
    });

    it("exits 2 from status with pending migrations", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      const args = [
        ...[cliPath, "status", "--url", testUrl],
        ...["--directory", directory, "--table", table],
      ];
      const failArgs = [...args, "--fail-on-pending"];
      const quietArgs = [...failArgs, "--quiet"];

      // execFile rejects when the exit code is not zero. The error contains
      // the exit code and output streams.
      await assert.rejects(
        promisify(execFile)(process.execPath, failArgs),
        (error: { code: number; stdout: string }): boolean => {
          assert.equal(error.code, 2);
          assert.equal(
            error.stdout,
            "History table is not initialized.\n" +
              `○ Pending  ${file}\n` +
              "0 applied, 1 pending, 1 total.\n",
          );
          return true;
        },
      );
      await assert.rejects(
        promisify(execFile)(process.execPath, quietArgs),
        (error: { code: number; stderr: string; stdout: string }): boolean => {
          assert.equal(error.code, 2);
          assert.equal(error.stdout, "");
          assert.equal(error.stderr, "");
          return true;
        },
      );
      // Without the flag, pending migrations exit 0.
      await promisify(execFile)(process.execPath, [...args, "--quiet"]);
      await migrate(commandOptions());
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        quietArgs,
      );
      assert.equal(stdout, "");
      assert.equal(stderr, "");
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
      assert.deepEqual(await readHistoryEvents(), [`apply ${firstVersion}`]);
      assert.equal((await status(options)).current?.file, file);

      assert.deepEqual(await rollback(options), { files: [file] });
      assert.deepEqual(await readHistoryEvents(), [
        `apply ${firstVersion}`,
        `revert ${firstVersion}`,
      ]);
      assert.equal(await relationExists("users"), false);
    });

    it("resets session settings after each migration", async (): Promise<void> => {
      // An empty search_path rejects an unqualified CREATE TABLE.
      const first = await writeMigration(
        firstVersion,
        "set_session",
        "SET search_path TO '';\nSET lock_timeout TO '1min';",
        "",
      );
      const second = await writeMigration(
        secondVersion,
        "add_settings",
        "CREATE TABLE settings AS SELECT " +
          "current_setting('search_path') AS search_path, " +
          "current_setting('lock_timeout') AS lock_timeout;",
        "DROP TABLE settings;",
      );

      // The admin connection has the same server and role defaults.
      const defaults = await getAdmin().query<{ lock_timeout: string }>(
        "SELECT current_setting('lock_timeout') AS lock_timeout;",
      );

      assert.deepEqual(await migrate(unqualifiedCommandOptions()), {
        files: [first, second],
      });
      const result = await getAdmin().query(
        `SELECT * FROM ${qualifiedRelation("settings")};`,
      );
      assert.deepEqual(result.rows, [
        { lock_timeout: defaults.rows[0]?.lock_timeout, search_path: schema },
      ]);
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
      assert.deepEqual(await readHistoryEvents(), [
        `apply ${firstVersion}`,
        `apply ${secondVersion}`,
        `revert ${secondVersion}`,
        `revert ${firstVersion}`,
      ]);
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
      assert.deepEqual(await readHistoryEvents(), [
        `apply ${firstVersion}`,
        `revert ${firstVersion}`,
      ]);
    });

    it("keeps committed migrations when a later migration fails", async (): Promise<void> => {
      await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const failedFile = await writeMigration(
        secondVersion,
        "add_posts",
        `CREATE TABLE ${qualifiedRelation("posts")} (id integer);\n` +
          `SELECT * FROM ${qualifiedRelation("missing")};`,
        `DROP TABLE ${qualifiedRelation("posts")};`,
      );

      await assert.rejects(
        migrate(commandOptions()),
        (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            `Failed to apply migration '${failedFile}'.`,
          );
          assert.ok(error.cause instanceof Error);
          assert.match(error.cause.message, /relation .* does not exist/);
          return true;
        },
      );

      assert.equal(await relationExists("users"), true);
      assert.equal(await relationExists("posts"), false);
      assert.deepEqual(await readHistoryEvents(), [`apply ${firstVersion}`]);
    });

    it("writes a short migration failure only in default output", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);\nSELEC 1;`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const args = [
        ...[cliPath, "up", "--url", testUrl],
        ...["--directory", directory, "--table", table],
      ];
      const cause = `  Cause: syntax error at or near "SELEC"`;
      // A FORCE_COLOR from the test environment would add colors to stderr.
      const options = { env: { ...process.env, FORCE_COLOR: undefined } };

      await assert.rejects(
        promisify(execFile)(process.execPath, args, options),
        (error: { code: number; stderr: string }): boolean => {
          assert.equal(error.code, 1);
          const lines = error.stderr.trimEnd().split("\n");
          assert.match(lines.at(-2)!, new RegExp(`^✖ Failed '${file}' \\(`));
          assert.equal(lines.at(-1), cause);
          assert.doesNotMatch(error.stderr, /Error: Failed to apply/);
          return true;
        },
      );
      await assert.rejects(
        promisify(execFile)(process.execPath, [...args, "--quiet"], options),
        (error: { code: number; stderr: string }): boolean => {
          assert.equal(error.code, 1);
          assert.equal(
            error.stderr,
            `✖ Error: Failed to apply migration '${file}'.\n${cause}\n`,
          );
          return true;
        },
      );
      // Verbose output writes rollback and disconnect lines after the
      // failed migration, so the error line names the file again.
      await assert.rejects(
        promisify(execFile)(process.execPath, [...args, "--verbose"], options),
        (error: { code: number; stderr: string }): boolean => {
          assert.equal(error.code, 1);
          assert.ok(
            error.stderr.endsWith(
              `\n✖ Error: Failed to apply migration '${file}'.\n${cause}\n`,
            ),
          );
          return true;
        },
      );
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
      assert.deepEqual(await readHistoryEvents(), [`apply ${firstVersion}`]);
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

      assert.deepEqual(await readHistoryEvents(), [`apply ${firstVersion}`]);
      assert.equal(await relationExists("users"), true);
    });

    it("reads the repair target after waiting for the lock", async (): Promise<void> => {
      const file = await writeMigration(
        firstVersion,
        "add_users",
        "SELECT 1;",
        "",
      );
      const filePath = path.join(directory, file);
      await migrate(commandOptions());
      await fs.appendFile(filePath, "-- changed\n");
      const lockClient = new pg.Client({ connectionString: testUrl });
      await lockClient.connect();

      async function repairDuringLockWait(
        change: () => Promise<void>,
      ): Promise<RepairResult> {
        await lockClient.query(
          "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
          [schema, "schema_migrations"],
        );
        const lockStarted = Promise.withResolvers<void>();
        const result = repair({
          ...commandOptions(),
          log(event): void {
            if (event.type === "lock-acquire-start") {
              lockStarted.resolve();
            }
          },
          target: firstVersion,
        });
        // An early failure rejects at once instead of waiting forever.
        await Promise.race([lockStarted.promise, result]);
        await change();
        await lockClient.query(
          "SELECT pg_advisory_unlock(hashtext($1), hashtext($2));",
          [schema, "schema_migrations"],
        );
        return result;
      }

      try {
        assert.deepEqual(
          await repairDuringLockWait(() =>
            fs.appendFile(filePath, "-- changed again\n"),
          ),
          { file },
        );
        assert.deepEqual(await validate(commandOptions()), {
          applied: 1,
          pending: 0,
          total: 1,
        });
        await assert.rejects(
          repairDuringLockWait(() => fs.writeFile(filePath, "SELECT 1;\n")),
          new Error(`Missing 'migrate:up' marker in '${file}'.`),
        );
      } finally {
        await lockClient.end();
      }
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

    it("applies a migration once when commands run at the same time", async (): Promise<void> => {
      // The sleep keeps the first migration running while the others read
      // history, so a lock taken too late lets them apply it again.
      const file = await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);\n` +
          "SELECT pg_sleep(0.2);",
        `DROP TABLE ${qualifiedRelation("users")};`,
      );

      const results = await Promise.all([
        migrate(commandOptions()),
        migrate(commandOptions()),
        migrate(commandOptions()),
      ]);

      const applied = results.filter((result) => result.files.length > 0);
      assert.deepEqual(applied, [{ files: [file] }]);
      assert.deepEqual(await readHistoryEvents(), [`apply ${firstVersion}`]);
    });

    it("rejects when the database connection is lost", async (): Promise<void> => {
      await writeMigration(
        firstVersion,
        "add_users",
        `CREATE TABLE ${qualifiedRelation("users")} (id integer);`,
        `DROP TABLE ${qualifiedRelation("users")};`,
      );
      const target = new URL(testUrl);
      const sockets: net.Socket[] = [];
      // Proxy the connection so the test can drop it like a server restart.
      const proxy = net.createServer((socket) => {
        const upstream = net.connect(
          Number(target.port || 5432),
          target.hostname,
        );
        sockets.push(socket);
        socket.on("error", () => {});
        upstream.on("error", () => {});
        socket.on("close", () => upstream.destroy());
        socket.pipe(upstream).pipe(socket);
      });
      await new Promise<void>((resolve) => {
        proxy.listen(0, "127.0.0.1", resolve);
      });
      const url = new URL(testUrl);
      url.hostname = "127.0.0.1";
      url.port = String((proxy.address() as net.AddressInfo).port);
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
          url: url.toString(),
          log(event): void {
            if (event.type === "lock-acquire-start") {
              reportLockStart();
            }
          },
        });
        await lockStarted;
        // Give PostgreSQL time to put the migration session in the wait queue.
        await setTimeout(50);
        for (const socket of sockets) {
          socket.destroy();
        }

        await assert.rejects(migration, (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            `Failed to acquire migration lock for '${table}'.`,
          );
          assert.ok(error.cause instanceof Error);
          assert.equal(
            error.cause.message,
            "Connection terminated unexpectedly",
          );
          return true;
        });
      } finally {
        await lockClient.end();
        proxy.close();
      }

      assert.equal(await relationExists("schema_migrations"), false);
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
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          version integer NOT NULL
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

    it("rejects an id without an identity", async (): Promise<void> => {
      await getAdmin().query(`
        CREATE TABLE ${qualifiedRelation("schema_migrations")}
        (
          id bigint NOT NULL DEFAULT 0,
          version text NOT NULL,
          file text NOT NULL,
          checksum text NOT NULL,
          action text NOT NULL,
          executed_at timestamptz NOT NULL,
          executed_by text NOT NULL
        );
      `);

      await assert.rejects(
        validate(commandOptions()),
        new Error(
          `Migration history table '${table}' column 'id' must be an ` +
            "identity column.",
        ),
      );
    });

    it("rejects a nullable history column", async (): Promise<void> => {
      await getAdmin().query(`
        CREATE TABLE ${qualifiedRelation("schema_migrations")}
        (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          version text NOT NULL,
          file text NOT NULL,
          checksum text NOT NULL,
          action text NOT NULL,
          executed_at timestamptz,
          executed_by text NOT NULL
        );
      `);

      await assert.rejects(
        status(commandOptions()),
        new Error(
          `Migration history table '${table}' column 'executed_at' must be ` +
            "NOT NULL.",
        ),
      );
    });
  },
);
