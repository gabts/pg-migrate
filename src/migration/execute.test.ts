import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as pg from "pg";
import { executeMigrations } from "./execute.js";
import type { DiskMigration } from "./files.js";
import type { LogEvent } from "./model.js";
import type { MigrationSql } from "./sql.js";

interface Query {
  parameters: unknown[] | undefined;
  sql: string;
}

const first: DiskMigration = {
  file: "20260811120000_add_users.sql",
  name: "add_users",
  path: "migrations/20260811120000_add_users.sql",
  version: "20260811120000",
};
const second: DiskMigration = {
  file: "20260811130000_add_posts.sql",
  name: "add_posts",
  path: "migrations/20260811130000_add_posts.sql",
  version: "20260811130000",
};
const sqlByFile = new Map<string, MigrationSql>([
  [
    first.file,
    {
      checksum: "first-checksum",
      down: "DROP TABLE users;",
      up: "CREATE TABLE users (id integer);",
    },
  ],
  [
    second.file,
    {
      checksum: "second-checksum",
      down: "DROP TABLE posts;",
      up: "CREATE TABLE posts (id integer);",
    },
  ],
]);

function createClient(failingSql?: string): {
  client: pg.Client;
  queries: Query[];
} {
  const queries: Query[] = [];
  const client = {
    query: async (
      sql: string,
      parameters?: unknown[],
    ): Promise<{ rows: unknown[] }> => {
      queries.push({ parameters, sql });
      if (sql === failingSql) {
        throw new Error("Database query failed.");
      }
      return { rows: [] };
    },
  } as unknown as pg.Client;
  return { client, queries };
}

function compact(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

function captureEvents(): {
  events: LogEvent[];
  log: (event: LogEvent) => undefined;
} {
  const events: LogEvent[] = [];
  return {
    events,
    log(event): undefined {
      events.push(event);
    },
  };
}

describe("execute", (): void => {
  it("applies migrations in separate transactions", async (): Promise<void> => {
    const { client, queries } = createClient();
    const { events, log } = captureEvents();

    const result = await executeMigrations(client, [first, second], sqlByFile, {
      direction: "up",
      initialized: true,
      log,
      qualifiedTable: '"schema_migrations"',
      table: "schema_migrations",
    });

    assert.deepEqual(result, { files: [first.file, second.file] });
    assert.deepEqual(
      queries.map((query) => compact(query.sql)),
      [
        "BEGIN;",
        "CREATE TABLE users (id integer);",
        'INSERT INTO "schema_migrations" (version, file, checksum, applied_at) VALUES ($1, $2, $3, clock_timestamp());',
        "COMMIT;",
        "BEGIN;",
        "CREATE TABLE posts (id integer);",
        'INSERT INTO "schema_migrations" (version, file, checksum, applied_at) VALUES ($1, $2, $3, clock_timestamp());',
        "COMMIT;",
      ],
    );
    assert.deepEqual(queries[2]?.parameters, [
      first.version,
      first.file,
      "first-checksum",
    ]);
    assert.deepEqual(queries[6]?.parameters, [
      second.version,
      second.file,
      "second-checksum",
    ]);
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "migration-start",
        "migration-done",
        "migration-start",
        "migration-done",
      ],
    );
  });

  it("reverts migrations in plan order", async (): Promise<void> => {
    const { client, queries } = createClient();

    const result = await executeMigrations(client, [second, first], sqlByFile, {
      direction: "down",
      initialized: true,
      qualifiedTable: '"schema_migrations"',
      table: "schema_migrations",
    });

    assert.deepEqual(result, { files: [second.file, first.file] });
    assert.deepEqual(
      queries.map((query) => compact(query.sql)),
      [
        "BEGIN;",
        "DROP TABLE posts;",
        'DELETE FROM "schema_migrations" WHERE version = $1;',
        "COMMIT;",
        "BEGIN;",
        "DROP TABLE users;",
        'DELETE FROM "schema_migrations" WHERE version = $1;',
        "COMMIT;",
      ],
    );
    assert.deepEqual(queries[2]?.parameters, [second.version]);
    assert.deepEqual(queries[6]?.parameters, [first.version]);
  });

  it("skips an empty down section", async (): Promise<void> => {
    const { client, queries } = createClient();
    const emptyDownSql = new Map<string, MigrationSql>([
      [first.file, { checksum: "first-checksum", down: "", up: "SELECT 1;" }],
    ]);

    const result = await executeMigrations(client, [first], emptyDownSql, {
      direction: "down",
      initialized: true,
      qualifiedTable: '"schema_migrations"',
      table: "schema_migrations",
    });

    assert.deepEqual(result, { files: [first.file] });
    assert.deepEqual(
      queries.map((query) => compact(query.sql)),
      [
        "BEGIN;",
        'DELETE FROM "schema_migrations" WHERE version = $1;',
        "COMMIT;",
      ],
    );
    assert.deepEqual(queries[1]?.parameters, [first.version]);
  });

  it("creates an uninitialized history table", async (): Promise<void> => {
    const { client, queries } = createClient();
    const { events, log } = captureEvents();

    const result = await executeMigrations(client, [], sqlByFile, {
      direction: "up",
      initialized: false,
      log,
      qualifiedTable: '"app"."schema_migrations"',
      table: "app.schema_migrations",
    });

    assert.deepEqual(result, { files: [] });
    assert.deepEqual(events, [
      { table: "app.schema_migrations", type: "history-initialize-start" },
      { table: "app.schema_migrations", type: "history-initialize-done" },
    ]);
    assert.deepEqual(
      queries.map((query) => compact(query.sql)),
      [
        "BEGIN;",
        'CREATE TABLE "app"."schema_migrations" ( version text PRIMARY KEY, file text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now() );',
        "COMMIT;",
      ],
    );
  });

  it("does no work for an empty down plan", async (): Promise<void> => {
    const { client, queries } = createClient();
    const { events, log } = captureEvents();

    const result = await executeMigrations(client, [], sqlByFile, {
      direction: "down",
      initialized: true,
      log,
      qualifiedTable: '"schema_migrations"',
      table: "schema_migrations",
    });

    assert.deepEqual(result, { files: [] });
    assert.deepEqual(events, []);
    assert.deepEqual(queries, []);
  });

  it("does not initialize history for an empty down plan", async (): Promise<void> => {
    const { client, queries } = createClient();

    const result = await executeMigrations(client, [], sqlByFile, {
      direction: "down",
      initialized: false,
      qualifiedTable: '"schema_migrations"',
      table: "schema_migrations",
    });

    assert.deepEqual(result, { files: [] });
    assert.deepEqual(queries, []);
  });

  it("rolls back a failed migration transaction", async (): Promise<void> => {
    const failingSql = sqlByFile.get(first.file)!.up;
    const { client, queries } = createClient(failingSql);
    const { events, log } = captureEvents();

    await assert.rejects(
      executeMigrations(client, [first], sqlByFile, {
        direction: "up",
        initialized: true,
        log,
        qualifiedTable: '"schema_migrations"',
        table: "schema_migrations",
      }),
      new Error("Database query failed."),
    );

    assert.deepEqual(
      queries.map((query) => compact(query.sql)),
      ["BEGIN;", "CREATE TABLE users (id integer);", "ROLLBACK;"],
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["migration-start", "migration-failed", "failed-migration-rollback-done"],
    );
    const failed = events[1];
    assert.equal(failed?.type, "migration-failed");
    if (failed?.type === "migration-failed") {
      assert.equal(failed.direction, "up");
      assert.equal(failed.file, first.file);
      assert.ok(failed.durationMs >= 0);
    }
  });
});
