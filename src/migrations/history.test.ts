import * as assert from "assert";
import type * as pg from "pg";
import type { Logger } from "../logging/logger.js";
import { messages } from "../logging/messages.js";
import {
  assertMigrationHistoryTableShape,
  ensureMigrationHistory,
  migrationHistoryExists,
  readAppliedRows,
} from "./history.js";

interface EnsurePlan {
  tableExists: boolean;
}

function createCapturedLogger(logs: string[]): Logger {
  const capture = (message: string): void => {
    logs.push(message);
  };
  const captureError = (input: unknown): void => {
    logs.push(String(input));
  };

  return {
    debug: capture,
    error: captureError,
    info: capture,
    warn: capture,
  };
}

function createEnsureFakeClient(plan: EnsurePlan): {
  client: pg.Client;
  queries: Array<{ sql: string; params?: unknown[] }>;
} {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const client = {
    query: async (
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: unknown[] }> => {
      queries.push({ sql, params });

      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ exists: plan.tableExists }] };
      }

      return { rows: [] };
    },
  } as unknown as pg.Client;

  return { client, queries };
}

describe("history", (): void => {
  describe("migrationHistoryExists", (): void => {
    it("checks whether the qualified history table exists", async (): Promise<void> => {
      const queries: Array<{ sql: string; params?: unknown[] }> = [];
      const client = {
        query: async (
          sql: string,
          params?: unknown[],
        ): Promise<{ rows: unknown[] }> => {
          queries.push({ sql, params });
          return { rows: [{ exists: true }] };
        },
      } as unknown as pg.Client;

      const exists = await migrationHistoryExists(
        client,
        '"migration_history"',
      );

      assert.equal(exists, true);
      assert.deepEqual(queries, [
        {
          sql: "SELECT to_regclass($1) IS NOT NULL AS exists;",
          params: ['"migration_history"'],
        },
      ]);
    });

    it("returns false when the history table is missing", async (): Promise<void> => {
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          return { rows: [{ exists: false }] };
        },
      } as unknown as pg.Client;

      assert.equal(
        await migrationHistoryExists(client, '"migration_history"'),
        false,
      );
    });
  });

  describe("ensureMigrationHistory", (): void => {
    it("creates the history table with filename/version columns and logs creation", async (): Promise<void> => {
      const { client, queries } = createEnsureFakeClient({
        tableExists: false,
      });
      const logs: string[] = [];

      await ensureMigrationHistory({
        client,
        logger: createCapturedLogger(logs),
        qualifiedTableName: '"migration_history"',
      });

      assert.deepEqual(logs, [messages.creatingTable()]);
      assert.ok(
        queries.some(
          ({ sql }): boolean =>
            sql.includes('CREATE TABLE "migration_history"') &&
            sql.includes("filename text PRIMARY KEY") &&
            sql.includes("version text NOT NULL"),
        ),
      );
      assert.equal(
        queries.some(({ sql }): boolean => sql.includes("ALTER TABLE")),
        false,
      );
    });

    it("does nothing when the history table already exists", async (): Promise<void> => {
      const { client, queries } = createEnsureFakeClient({
        tableExists: true,
      });
      const logs: string[] = [];

      await ensureMigrationHistory({
        client,
        logger: createCapturedLogger(logs),
        qualifiedTableName: '"migration_history"',
      });

      assert.deepEqual(logs, []);
      assert.equal(
        queries.some(({ sql }): boolean => sql.includes("CREATE TABLE")),
        false,
      );
      assert.equal(
        queries.some(({ sql }): boolean => sql.includes("ALTER TABLE")),
        false,
      );
    });
  });

  describe("readAppliedRows", (): void => {
    it("loads rows from filename/version columns", async (): Promise<void> => {
      const queries: string[] = [];
      const client = {
        query: async (sql: string): Promise<{ rows: unknown[] }> => {
          queries.push(sql);
          return {
            rows: [
              {
                filename: "20260416090000_create.sql",
                version: "20260416090000",
              },
            ],
          };
        },
      } as unknown as pg.Client;

      const rows = await readAppliedRows(client, '"migration_history"');

      assert.deepEqual(rows, [
        { filename: "20260416090000_create.sql", version: "20260416090000" },
      ]);
      assert.ok(
        queries.some((sql): boolean =>
          sql.includes(`SELECT filename, version FROM "migration_history"`),
        ),
      );
    });

    it("validates and rejects duplicate applied rows", async (): Promise<void> => {
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          return {
            rows: [
              {
                filename: "20260416090000_create.sql",
                version: "20260416090000",
              },
              {
                filename: "20260416090000_create.sql",
                version: "20260416090000",
              },
            ],
          };
        },
      } as unknown as pg.Client;

      await assert.rejects(
        (): Promise<unknown> => readAppliedRows(client, '"migration_history"'),
        /Duplicate applied migration file: 20260416090000_create\.sql/,
      );
    });

    it("validates and rejects duplicate applied versions", async (): Promise<void> => {
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          return {
            rows: [
              {
                filename: "20260416090000_create.sql",
                version: "20260416090000",
              },
              {
                filename: "20260416090001_insert.sql",
                version: "20260416090000",
              },
            ],
          };
        },
      } as unknown as pg.Client;

      await assert.rejects(
        (): Promise<unknown> => readAppliedRows(client, '"migration_history"'),
        /Duplicate applied migration version: 20260416090000/,
      );
    });
  });

  describe("assertMigrationHistoryTableShape", (): void => {
    it("accepts tables with the expected columns", async (): Promise<void> => {
      const queries: string[] = [];
      const client = {
        query: async (sql: string): Promise<{ rows: unknown[] }> => {
          queries.push(sql);
          return { rows: [] };
        },
      } as unknown as pg.Client;

      await assertMigrationHistoryTableShape({
        client,
        qualifiedTableName: '"migration_history"',
        table: "migration_history",
      });

      assert.ok(
        queries.some((sql): boolean =>
          sql.includes(
            'SELECT filename, version, applied_at FROM "migration_history" LIMIT 0;',
          ),
        ),
      );
    });

    it("throws a clear schema error when expected columns are missing", async (): Promise<void> => {
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          throw Object.assign(new Error('column "version" does not exist'), {
            code: "42703",
          });
        },
      } as unknown as pg.Client;

      await assert.rejects(
        (): Promise<void> =>
          assertMigrationHistoryTableShape({
            client,
            qualifiedTableName: '"migration_history"',
            table: "migration_history",
          }),
        /Invalid migration history table schema: migration_history\. Expected columns filename, version, applied_at: column "version" does not exist/,
      );
    });

    it("rethrows non-schema database errors unchanged", async (): Promise<void> => {
      const dbError = Object.assign(new Error("permission denied"), {
        code: "42501",
      });
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          throw dbError;
        },
      } as unknown as pg.Client;

      await assert.rejects(
        (): Promise<void> =>
          assertMigrationHistoryTableShape({
            client,
            qualifiedTableName: '"migration_history"',
            table: "migration_history",
          }),
        (error: unknown): boolean => error === dbError,
      );
    });
  });
});
