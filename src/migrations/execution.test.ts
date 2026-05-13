import * as assert from "assert";
import type * as pg from "pg";
import type { Logger } from "../logging/logger.js";
import { executeDownPlan, executeUpPlan } from "./execution.js";
import type { MigrationStep } from "./types.js";

function normalizeMs(s: string): string {
  return s.replace(/\d+ms/, "<ms>");
}

interface QueryCall {
  sql: string;
  params?: unknown[];
}

const noopLogger: Logger = {
  emit: (): void => undefined,
};

function createCapturedLogger(logs: string[]): Logger {
  return {
    emit(event): void {
      logs.push(event.message);
    },
  };
}

function createFakeClient(): {
  client: pg.Client;
  queries: QueryCall[];
} {
  const queries: QueryCall[] = [];
  const client = {
    query: async (
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: unknown[] }> => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  } as unknown as pg.Client;

  return { client, queries };
}

describe("execution", (): void => {
  describe("executeUpPlan", (): void => {
    it("runs each migration in its own transaction and records it in the history table", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        {
          file: "20260416090000_create.sql",
          sql: "CREATE TABLE person (id integer);",
        },
        {
          file: "20260416090100_insert.sql",
          sql: "INSERT INTO person VALUES (1);",
        },
      ];

      await executeUpPlan({
        client,
        logger: createCapturedLogger(logs),
        steps,
        table: "pgmigrate.migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "Applying migration",
          "Migration applied",
          "Applying migration",
          "Migration applied",
        ].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        { sql: "BEGIN;", params: undefined },
        {
          sql: "CREATE TABLE person (id integer);",
          params: undefined,
        },
        {
          sql: 'INSERT INTO "pgmigrate"."migration_history" ( version, applied_at ) VALUES ( $1, clock_timestamp() );',
          params: ["20260416090000"],
        },
        { sql: "COMMIT;", params: undefined },
        { sql: "BEGIN;", params: undefined },
        {
          sql: "INSERT INTO person VALUES (1);",
          params: undefined,
        },
        {
          sql: 'INSERT INTO "pgmigrate"."migration_history" ( version, applied_at ) VALUES ( $1, clock_timestamp() );',
          params: ["20260416090100"],
        },
        { sql: "COMMIT;", params: undefined },
      ]);
    });

    it("rolls back the failing migration but leaves earlier migrations committed", async (): Promise<void> => {
      const queries: QueryCall[] = [];
      const client = {
        query: async (
          sql: string,
          params?: unknown[],
        ): Promise<{ rows: unknown[] }> => {
          queries.push({ sql, params });
          if (sql === "BROKEN SQL;") {
            throw Object.assign(new Error("syntax error at BROKEN"), {
              code: "42601",
            });
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [
        { file: "20260416090000_create.sql", sql: "CREATE TABLE person;" },
        { file: "20260416090100_break.sql", sql: "BROKEN SQL;" },
        { file: "20260416090200_never.sql", sql: "CREATE TABLE never_run;" },
      ];

      const logs: string[] = [];
      await assert.rejects(
        (): Promise<void> =>
          executeUpPlan({
            client,
            logger: createCapturedLogger(logs),
            steps,
            table: "migration_history",
          }),
        /syntax error at BROKEN/,
      );

      const transactionBoundaries = queries
        .filter(
          (q): boolean =>
            q.sql === "BEGIN;" || q.sql === "COMMIT;" || q.sql === "ROLLBACK;",
        )
        .map((q): string => q.sql);
      assert.deepEqual(transactionBoundaries, [
        "BEGIN;",
        "COMMIT;",
        "BEGIN;",
        "ROLLBACK;",
      ]);

      assert.ok(queries.some((q): boolean => q.sql === "CREATE TABLE person;"));
      assert.ok(
        !queries.some((q): boolean => q.sql === "CREATE TABLE never_run;"),
      );

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "Applying migration",
          "Migration applied",
          "Applying migration",
          "Migration failed",
          "Migration transaction rolled back",
        ].map(normalizeMs),
      );
    });

    it("does nothing for an empty up plan", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      await executeUpPlan({
        client,
        logger: noopLogger,
        steps: [],
        table: "migration_history",
      });

      assert.deepEqual(queries, []);
    });
  });

  describe("executeUpPlan (dryRun)", (): void => {
    it("runs each step directly, leaving outer transaction management to the caller", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        {
          file: "20260416090000_create.sql",
          sql: "CREATE TABLE person (id integer);",
        },
        {
          file: "20260416090100_insert.sql",
          sql: "INSERT INTO person VALUES (1);",
        },
      ];

      await executeUpPlan({
        client,
        dryRun: true,
        logger: createCapturedLogger(logs),
        steps,
        table: "migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "Applying migration",
          "Migration applied",
          "Applying migration",
          "Migration applied",
        ].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        { sql: "CREATE TABLE person (id integer);", params: undefined },
        {
          sql: 'INSERT INTO "migration_history" ( version, applied_at ) VALUES ( $1, clock_timestamp() );',
          params: ["20260416090000"],
        },
        { sql: "INSERT INTO person VALUES (1);", params: undefined },
        {
          sql: 'INSERT INTO "migration_history" ( version, applied_at ) VALUES ( $1, clock_timestamp() );',
          params: ["20260416090100"],
        },
      ]);
    });

    it("rethrows on step failure and leaves transaction boundaries to the caller", async (): Promise<void> => {
      const queries: QueryCall[] = [];
      const client = {
        query: async (
          sql: string,
          params?: unknown[],
        ): Promise<{ rows: unknown[] }> => {
          queries.push({ sql, params });
          if (sql === "BROKEN SQL;") {
            throw Object.assign(new Error("syntax error"), { code: "42601" });
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [
        { file: "20260416090000_create.sql", sql: "CREATE TABLE person;" },
        { file: "20260416090100_break.sql", sql: "BROKEN SQL;" },
      ];

      await assert.rejects(
        (): Promise<void> =>
          executeUpPlan({
            client,
            dryRun: true,
            logger: noopLogger,
            steps,
            table: "migration_history",
          }),
        /syntax error/,
      );

      const boundaries = queries
        .filter(
          (q): boolean =>
            q.sql === "BEGIN;" ||
            q.sql === "ROLLBACK;" ||
            q.sql.startsWith("SAVEPOINT") ||
            q.sql.startsWith("RELEASE SAVEPOINT") ||
            q.sql.startsWith("ROLLBACK TO SAVEPOINT"),
        )
        .map((q): string => q.sql);
      assert.deepEqual(boundaries, []);
    });
  });

  describe("executeDownPlan (dryRun)", (): void => {
    it("runs each step directly, leaving outer transaction management to the caller", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        { file: "20260416090100_insert.sql", sql: "DELETE FROM person;" },
      ];

      await executeDownPlan({
        client,
        dryRun: true,
        logger: createCapturedLogger(logs),
        steps,
        table: "migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        ["Reverting migration", "Migration reverted"].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        { sql: "DELETE FROM person;", params: undefined },
        {
          sql: 'DELETE FROM "migration_history" WHERE version = $1;',
          params: ["20260416090100"],
        },
      ]);
    });

    it("handles irreversible steps in dry run", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      const steps: MigrationStep[] = [
        { file: "20260416090000_backfill.sql", sql: "" },
      ];

      await executeDownPlan({
        client,
        dryRun: true,
        logger: noopLogger,
        steps,
        table: "migration_history",
      });

      assert.deepEqual(queries, [
        {
          sql: 'DELETE FROM "migration_history" WHERE version = $1;',
          params: ["20260416090000"],
        },
      ]);
    });

    it("rethrows on step failure and leaves transaction boundaries to the caller", async (): Promise<void> => {
      const queries: QueryCall[] = [];
      const client = {
        query: async (
          sql: string,
          params?: unknown[],
        ): Promise<{ rows: unknown[] }> => {
          queries.push({ sql, params });
          if (sql === "DROP TABLE person;") {
            throw Object.assign(new Error("table does not exist"), {
              code: "42P01",
            });
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [
        { file: "20260416090100_insert.sql", sql: "DELETE FROM person;" },
        { file: "20260416090000_create.sql", sql: "DROP TABLE person;" },
      ];

      await assert.rejects(
        (): Promise<void> =>
          executeDownPlan({
            client,
            dryRun: true,
            logger: noopLogger,
            steps,
            table: "migration_history",
          }),
        /table does not exist/,
      );

      const boundaries = queries
        .filter(
          (q): boolean =>
            q.sql === "BEGIN;" ||
            q.sql === "ROLLBACK;" ||
            q.sql.startsWith("SAVEPOINT") ||
            q.sql.startsWith("RELEASE SAVEPOINT") ||
            q.sql.startsWith("ROLLBACK TO SAVEPOINT"),
        )
        .map((q): string => q.sql);
      assert.deepEqual(boundaries, []);
    });

    it("does not log transaction rollback for an irreversible step failure", async (): Promise<void> => {
      const client = {
        query: async (sql: string): Promise<{ rows: unknown[] }> => {
          if (
            sql.startsWith('DELETE FROM "migration_history"') &&
            sql.includes("$1")
          ) {
            throw Object.assign(new Error("constraint violation"), {
              code: "23505",
            });
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      const logs: string[] = [];
      const steps: MigrationStep[] = [
        { file: "20260416090000_backfill.sql", sql: "" },
      ];

      await assert.rejects(
        (): Promise<void> =>
          executeDownPlan({
            client,
            dryRun: true,
            logger: createCapturedLogger(logs),
            steps,
            table: "migration_history",
          }),
        /constraint violation/,
      );

      assert.deepEqual(
        logs.map(normalizeMs),
        ["Reverting migration", "Migration failed"].map(normalizeMs),
      );
    });
  });

  describe("executeDownPlan", (): void => {
    it("runs each down migration in its own transaction and removes it from the history table", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        {
          file: "20260416090000_create.sql",
          sql: "DROP TABLE person;",
        },
      ];

      await executeDownPlan({
        client,
        logger: createCapturedLogger(logs),
        steps,
        table: "migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        ["Reverting migration", "Migration reverted"].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        { sql: "BEGIN;", params: undefined },
        {
          sql: "DROP TABLE person;",
          params: undefined,
        },
        {
          sql: 'DELETE FROM "migration_history" WHERE version = $1;',
          params: ["20260416090000"],
        },
        { sql: "COMMIT;", params: undefined },
      ]);
    });

    it("skips SQL execution for irreversible migrations but removes the tracking row", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        { file: "20260416090000_backfill.sql", sql: "" },
      ];

      await executeDownPlan({
        client,
        logger: createCapturedLogger(logs),
        steps,
        table: "migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        ["Reverting migration", "Migration reverted"].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        {
          sql: 'DELETE FROM "migration_history" WHERE version = $1;',
          params: ["20260416090000"],
        },
      ]);
    });

    it("logs a rollback for a reversible down failure", async (): Promise<void> => {
      const client = {
        query: async (sql: string): Promise<{ rows: unknown[] }> => {
          if (sql === "DROP TABLE person;") {
            throw new Error("cannot drop");
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [
        { file: "20260416090000_create.sql", sql: "DROP TABLE person;" },
      ];
      const logs: string[] = [];
      await assert.rejects(
        (): Promise<void> =>
          executeDownPlan({
            client,
            logger: createCapturedLogger(logs),
            steps,
            table: "migration_history",
          }),
        /cannot drop/,
      );

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "Reverting migration",
          "Migration failed",
          "Migration transaction rolled back",
        ].map(normalizeMs),
      );
    });

    it("does not log rollback when an irreversible down step fails", async (): Promise<void> => {
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          throw new Error("history write failed");
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [
        { file: "20260416090000_backfill.sql", sql: "" },
      ];
      const logs: string[] = [];
      await assert.rejects(
        (): Promise<void> =>
          executeDownPlan({
            client,
            logger: createCapturedLogger(logs),
            steps,
            table: "migration_history",
          }),
        /history write failed/,
      );

      assert.deepEqual(
        logs.map(normalizeMs),
        ["Reverting migration", "Migration failed"].map(normalizeMs),
      );
    });

    it("does nothing for an empty down plan", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      await executeDownPlan({
        client,
        logger: noopLogger,
        steps: [],
        table: "migration_history",
      });

      assert.deepEqual(queries, []);
    });
  });
});
