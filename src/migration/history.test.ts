import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as pg from "pg";
import {
  createHistoryTable,
  lockMigrations,
  readAppliedMigrations,
  readHistoryDefinition,
  recordAppliedMigration,
  removeAppliedMigration,
  resolveHistoryTable,
  validateHistoryDefinition,
  validateHistoryTableName,
} from "./history.js";

interface Query {
  parameters: unknown[] | undefined;
  sql: string;
}

function createClient(results: unknown[][] = []): {
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
      return { rows: results.shift() ?? [] };
    },
  } as unknown as pg.Client;
  return { client, queries };
}

describe("history", (): void => {
  describe("lock", (): void => {
    it("resolves the schema of an unqualified table", async (): Promise<void> => {
      const { client, queries } = createClient([[{ schema: "app" }]]);

      const table = await resolveHistoryTable(client, "schema_migrations");
      await lockMigrations(client, table);

      assert.deepEqual(table, {
        name: "schema_migrations",
        qualifiedName: '"app"."schema_migrations"',
        schema: "app",
        table: "schema_migrations",
      });
      assert.deepEqual(queries[0]?.parameters, ["schema_migrations"]);
      assert.match(queries[0]!.sql, /to_regclass\(\$1\)/);
      assert.match(queries[0]!.sql, /current_schema\(\)/);
      assert.deepEqual(queries[1], {
        parameters: ["app", "schema_migrations"],
        sql: "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
      });
    });

    it("uses the schema and table as the lock identity", async (): Promise<void> => {
      const { client, queries } = createClient();

      const table = await resolveHistoryTable(client, "app.schema_migrations");
      await lockMigrations(client, table);

      assert.deepEqual(table, {
        name: "app.schema_migrations",
        qualifiedName: '"app"."schema_migrations"',
        schema: "app",
        table: "schema_migrations",
      });
      assert.deepEqual(queries, [
        {
          parameters: ["app", "schema_migrations"],
          sql: "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
        },
      ]);
    });

    it("rejects an unresolvable schema", async (): Promise<void> => {
      const { client } = createClient([[{ schema: null }]]);

      await assert.rejects(
        resolveHistoryTable(client, "schema_migrations"),
        new Error(
          "Cannot resolve schema for migration table 'schema_migrations'.",
        ),
      );
    });
  });

  it("validates table names", (): void => {
    const longestIdentifier = "a".repeat(63);

    validateHistoryTableName("schema_migrations");
    validateHistoryTableName("app.schema_migrations");
    validateHistoryTableName(longestIdentifier);
    validateHistoryTableName(`${longestIdentifier}.${longestIdentifier}`);
  });

  it("rejects invalid table names", (): void => {
    for (const table of [
      "",
      "Schema_Migrations",
      "1_migrations",
      "schema-migrations",
      "app..schema_migrations",
      "app.schema.migrations",
      '"schema_migrations"',
      "schema_migrations; DROP TABLE users",
      "a".repeat(64),
      `${"a".repeat(64)}.schema_migrations`,
      `app.${"a".repeat(64)}`,
    ]) {
      assert.throws(
        () => validateHistoryTableName(table),
        new Error(`Invalid migration table name '${table}'.`),
      );
    }
  });

  it("reads an uninitialized history definition", async (): Promise<void> => {
    const { client, queries } = createClient([[{ exists: false }]]);

    const result = await readHistoryDefinition(client, '"schema_migrations"');

    assert.deepEqual(result, { columns: [], initialized: false });
    assert.deepEqual(queries, [
      {
        parameters: ['"schema_migrations"'],
        sql: "SELECT to_regclass($1) IS NOT NULL AS exists;",
      },
    ]);
  });

  it("reads a history definition without validating it", async (): Promise<void> => {
    const columns = [{ name: "version", notNull: true, type: "integer" }];
    const { client } = createClient([[{ exists: true }], columns]);

    const result = await readHistoryDefinition(client, '"schema_migrations"');

    assert.deepEqual(result, { columns, initialized: true });
  });

  it("validates a history definition", (): void => {
    validateHistoryDefinition(
      {
        columns: [
          { name: "version", notNull: true, type: "text" },
          { name: "file", notNull: true, type: "text" },
          { name: "checksum", notNull: true, type: "text" },
          {
            name: "applied_at",
            notNull: true,
            type: "timestamp with time zone",
          },
        ],
        initialized: true,
      },
      "schema_migrations",
    );
  });

  it("validates an uninitialized history definition", (): void => {
    assert.doesNotThrow(() =>
      validateHistoryDefinition(
        { columns: [], initialized: false },
        "schema_migrations",
      ),
    );
  });

  it("rejects an invalid history definition", (): void => {
    assert.throws(
      () =>
        validateHistoryDefinition(
          {
            columns: [
              { name: "version", notNull: true, type: "integer" },
              { name: "file", notNull: true, type: "text" },
              { name: "checksum", notNull: true, type: "text" },
              {
                name: "applied_at",
                notNull: true,
                type: "timestamp with time zone",
              },
            ],
            initialized: true,
          },
          "schema_migrations",
        ),
      new Error(
        "Migration history table 'schema_migrations' column 'version' must " +
          "be 'text', not 'integer'.",
      ),
    );
  });

  it("rejects a history definition without checksums", (): void => {
    assert.throws(
      () =>
        validateHistoryDefinition(
          {
            columns: [
              { name: "version", notNull: true, type: "text" },
              { name: "file", notNull: true, type: "text" },
              {
                name: "applied_at",
                notNull: true,
                type: "timestamp with time zone",
              },
            ],
            initialized: true,
          },
          "schema_migrations",
        ),
      new Error(
        "Migration history table 'schema_migrations' is missing column " +
          "'checksum'.",
      ),
    );
  });

  it("reads applied migrations separately", async (): Promise<void> => {
    const appliedAt = "2026-08-11T12:00:00.000Z";
    const rows = [
      {
        appliedAt,
        checksum: "migration-checksum",
        file: "20260811120000_add_users.sql",
        version: "20260811120000",
      },
    ];
    const { client, queries } = createClient([rows]);

    const result = await readAppliedMigrations(
      client,
      '"app"."schema_migrations"',
    );

    assert.deepEqual(result, rows);
    assert.match(queries[0]!.sql, /version,\s+file,\s+checksum,/);
    assert.match(queries[0]!.sql, /applied_at AT TIME ZONE 'UTC'/);
    assert.match(queries[0]!.sql, /'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'/);
    assert.match(queries[0]!.sql, /FROM "app"\."schema_migrations";/);
  });

  it("writes history changes", async (): Promise<void> => {
    const { client, queries } = createClient();

    await createHistoryTable(client, '"schema_migrations"');
    await recordAppliedMigration(
      client,
      '"schema_migrations"',
      "20260811120000",
      "20260811120000_add_users.sql",
      "migration-checksum",
    );
    await removeAppliedMigration(
      client,
      '"schema_migrations"',
      "20260811120000",
    );

    assert.match(queries[0]!.sql, /CREATE TABLE "schema_migrations"/);
    assert.match(queries[1]!.sql, /INSERT INTO "schema_migrations"/);
    assert.deepEqual(queries[1]!.parameters, [
      "20260811120000",
      "20260811120000_add_users.sql",
      "migration-checksum",
    ]);
    assert.match(queries[2]!.sql, /DELETE FROM "schema_migrations"/);
    assert.deepEqual(queries[2]!.parameters, ["20260811120000"]);
  });
});
