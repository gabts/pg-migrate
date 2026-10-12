import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as pg from "pg";
import {
  createHistoryTable,
  lockMigrations,
  readHistory,
  recordMigrationEvent,
  resolveHistoryTable,
  validateHistoryTableName,
  type HistoryColumn,
  type ResolvedHistoryTable,
} from "./history.js";

function noLog(): undefined {
  return undefined;
}

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

function historyColumns(): HistoryColumn[] {
  return [
    { identity: true, name: "id", notNull: true, type: "bigint" },
    { identity: false, name: "version", notNull: true, type: "text" },
    { identity: false, name: "file", notNull: true, type: "text" },
    { identity: false, name: "checksum", notNull: true, type: "text" },
    { identity: false, name: "action", notNull: true, type: "text" },
    {
      identity: false,
      name: "executed_at",
      notNull: true,
      type: "timestamp with time zone",
    },
    { identity: false, name: "executed_by", notNull: true, type: "text" },
  ];
}

const historyTable: ResolvedHistoryTable = {
  name: "schema_migrations",
  qualifiedName: '"public"."schema_migrations"',
  schema: "public",
  table: "schema_migrations",
};

function readHistoryWithColumns(
  columns: HistoryColumn[],
): ReturnType<typeof readHistory> {
  const { client } = createClient([[{ exists: true }], columns]);
  return readHistory(client, historyTable, noLog);
}

describe("history", (): void => {
  describe("lock", (): void => {
    it("resolves the schema of an unqualified table", async (): Promise<void> => {
      const { client, queries } = createClient([[{ schema: "app" }]]);

      const table = await resolveHistoryTable(client, "schema_migrations");
      await lockMigrations(client, table, noLog);

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
      const { client, queries } = createClient([[{ exists: true }]]);

      const table = await resolveHistoryTable(client, "app.schema_migrations");
      await lockMigrations(client, table, noLog);

      assert.deepEqual(table, {
        name: "app.schema_migrations",
        qualifiedName: '"app"."schema_migrations"',
        schema: "app",
        table: "schema_migrations",
      });
      assert.deepEqual(queries, [
        {
          parameters: ["app"],
          sql: "SELECT to_regnamespace($1) IS NOT NULL AS exists;",
        },
        {
          parameters: ["app", "schema_migrations"],
          sql: "SELECT pg_advisory_lock(hashtext($1), hashtext($2));",
        },
      ]);
    });

    it("rejects a missing schema of a qualified table", async (): Promise<void> => {
      const { client } = createClient([[{ exists: false }]]);

      await assert.rejects(
        resolveHistoryTable(client, "app.schema_migrations"),
        new Error("Schema 'app' does not exist."),
      );
    });

    it("identifies the table when a history query fails", async (): Promise<void> => {
      const failure = new Error("permission denied for schema app");
      const client = {
        query: async (): Promise<never> => {
          throw failure;
        },
      } as unknown as pg.Client;
      const table = await resolveHistoryTable(
        createClient([[{ exists: true }]]).client,
        "app.schema_migrations",
      );
      // Reads a valid history table definition, then fails on the next query.
      const results = [[{ exists: true }], historyColumns()];
      const appliedClient = {
        query: async (): Promise<{ rows: unknown[] }> => {
          const rows = results.shift();
          if (!rows) {
            throw failure;
          }
          return { rows };
        },
      } as unknown as pg.Client;

      for (const [operation, message] of [
        [
          () => resolveHistoryTable(client, "schema_migrations"),
          "Failed to look up schema for migration table 'schema_migrations'.",
        ],
        [
          () => resolveHistoryTable(client, "app.schema_migrations"),
          "Failed to look up schema for migration table 'app.schema_migrations'.",
        ],
        [
          () => lockMigrations(client, table, noLog),
          "Failed to acquire migration lock for 'app.schema_migrations'.",
        ],
        [
          () => readHistory(client, table, noLog),
          "Failed to read migration history table 'app.schema_migrations'.",
        ],
        [
          () => readHistory(appliedClient, table, noLog),
          "Failed to read migration history table 'app.schema_migrations'.",
        ],
      ] as const) {
        await assert.rejects(operation, (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, message);
          assert.equal(error.cause, failure);
          return true;
        });
      }
    });

    it("rejects an unresolvable schema", async (): Promise<void> => {
      const { client } = createClient([[{ schema: null }]]);

      await assert.rejects(
        resolveHistoryTable(client, "schema_migrations"),
        new Error("No schema found for migration table 'schema_migrations'."),
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

  it("rejects an invalid history definition", async (): Promise<void> => {
    const columns = historyColumns();
    columns[1]!.type = "integer";

    await assert.rejects(
      readHistoryWithColumns(columns),
      new Error(
        "Migration history table 'schema_migrations' column 'version' must " +
          "be 'text', not 'integer'.",
      ),
    );
  });

  it("rejects a history definition without checksums", async (): Promise<void> => {
    const columns = historyColumns().filter(
      (column) => column.name !== "checksum",
    );

    await assert.rejects(
      readHistoryWithColumns(columns),
      new Error(
        "Migration history table 'schema_migrations' is missing column " +
          "'checksum'.",
      ),
    );
  });

  it("rejects a nullable history column", async (): Promise<void> => {
    const columns = historyColumns();
    columns[3]!.notNull = false;

    await assert.rejects(
      readHistoryWithColumns(columns),
      new Error(
        "Migration history table 'schema_migrations' column 'checksum' must " +
          "be NOT NULL.",
      ),
    );
  });

  it("rejects an id that is not an identity column", async (): Promise<void> => {
    const columns = historyColumns();
    columns[0]!.identity = false;

    await assert.rejects(
      readHistoryWithColumns(columns),
      new Error(
        "Migration history table 'schema_migrations' column 'id' must be an " +
          "identity column.",
      ),
    );
  });

  it("reads no applied migrations without a history table", async (): Promise<void> => {
    const { client, queries } = createClient([[{ exists: false }]]);

    const history = await readHistory(client, historyTable, noLog);

    assert.deepEqual(history, { applied: [], initialized: false });
    assert.deepEqual(queries, [
      {
        parameters: ['"public"."schema_migrations"'],
        sql: "SELECT to_regclass($1) IS NOT NULL AS exists;",
      },
    ]);
  });

  it("reads applied migrations from a valid history table", async (): Promise<void> => {
    const rows = [
      {
        appliedAt: "2026-08-11T12:00:00.000Z",
        checksum: "migration-checksum",
        file: "20260811120000_add_users.sql",
        version: "20260811120000",
      },
    ];
    const { client, queries } = createClient([
      [{ exists: true }],
      [{ exists: true }],
      historyColumns(),
      rows,
    ]);
    const table = await resolveHistoryTable(client, "app.schema_migrations");

    const history = await readHistory(client, table, noLog);

    assert.deepEqual(history, { applied: rows, initialized: true });
    assert.match(queries[3]!.sql, /executed_at AT TIME ZONE 'UTC'/);
    assert.match(queries[3]!.sql, /'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'/);
    assert.match(queries[3]!.sql, /FROM "app"\."schema_migrations"/);
  });

  it("writes history changes", async (): Promise<void> => {
    const { client, queries } = createClient();

    await createHistoryTable(client, '"schema_migrations"');
    await recordMigrationEvent(
      client,
      '"schema_migrations"',
      "repair",
      "20260811120000",
      "20260811120000_add_users.sql",
      "migration-checksum",
    );

    assert.match(queries[0]!.sql, /CREATE TABLE "schema_migrations"/);
    assert.match(queries[1]!.sql, /INSERT INTO "schema_migrations"/);
    assert.deepEqual(queries[1]!.parameters, [
      "20260811120000",
      "20260811120000_add_users.sql",
      "migration-checksum",
      "repair",
    ]);
  });
});
