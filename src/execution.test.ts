import * as assert from "assert";
import type * as pg from "pg";
import { executeDownPlan, executeUpPlan } from "./execution.js";
import { messages } from "./log-messages.js";
import type { MigrationStep } from "./types.js";

function normalizeMs(s: string): string {
  return s.replace(/\d+ms/, "<ms>");
}

interface QueryCall {
  sql: string;
  params?: unknown[];
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
          file: "0-create.sql",
          sql: "CREATE TABLE person (id integer);",
        },
        {
          file: "1-insert.sql",
          sql: "INSERT INTO person VALUES (1);",
        },
      ];

      await executeUpPlan({
        client,
        log: (message: string): void => {
          logs.push(message);
        },
        steps,
        table: "migratorosaurus.migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "",
          messages.applying("0-create.sql"),
          messages.applied("0-create.sql", 0),
          "",
          messages.applying("1-insert.sql"),
          messages.applied("1-insert.sql", 0),
        ].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        { sql: "BEGIN;", params: undefined },
        {
          sql: "CREATE TABLE person (id integer);",
          params: undefined,
        },
        {
          sql: 'INSERT INTO "migratorosaurus"."migration_history" ( file, applied_at ) VALUES ( $1, clock_timestamp() );',
          params: ["0-create.sql"],
        },
        { sql: "COMMIT;", params: undefined },
        { sql: "BEGIN;", params: undefined },
        {
          sql: "INSERT INTO person VALUES (1);",
          params: undefined,
        },
        {
          sql: 'INSERT INTO "migratorosaurus"."migration_history" ( file, applied_at ) VALUES ( $1, clock_timestamp() );',
          params: ["1-insert.sql"],
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
        { file: "0-create.sql", sql: "CREATE TABLE person;" },
        { file: "1-break.sql", sql: "BROKEN SQL;" },
        { file: "2-never.sql", sql: "CREATE TABLE never_run;" },
      ];

      const logs: string[] = [];
      await assert.rejects(
        (): Promise<void> =>
          executeUpPlan({
            client,
            log: (message: string): void => {
              logs.push(message);
            },
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
          "",
          messages.applying("0-create.sql"),
          messages.applied("0-create.sql", 0),
          "",
          messages.applying("1-break.sql"),
          messages.failed("1-break.sql", 0),
          messages.errorDetails(
            Object.assign(new Error("syntax error at BROKEN"), {
              code: "42601",
            }),
          ),
          messages.failureRolledBack(),
        ].map(normalizeMs),
      );
    });

    it("does nothing for an empty up plan", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      await executeUpPlan({
        client,
        log: (): void => undefined,
        steps: [],
        table: "migration_history",
      });

      assert.deepEqual(queries, []);
    });
  });

  describe("executeDownPlan", (): void => {
    it("runs each down migration in its own transaction and removes it from the history table", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        {
          file: "0-create.sql",
          sql: "DROP TABLE person;",
        },
      ];

      await executeDownPlan({
        client,
        log: (message: string): void => {
          logs.push(message);
        },
        steps,
        table: "migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "",
          messages.reverting("0-create.sql", true),
          messages.reverted("0-create.sql", 0),
        ].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        { sql: "BEGIN;", params: undefined },
        {
          sql: "DROP TABLE person;",
          params: undefined,
        },
        {
          sql: 'DELETE FROM "migration_history" WHERE file = $1;',
          params: ["0-create.sql"],
        },
        { sql: "COMMIT;", params: undefined },
      ]);
    });

    it("skips SQL execution for irreversible migrations but removes the tracking row", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [{ file: "0-backfill.sql", sql: "" }];

      await executeDownPlan({
        client,
        log: (message: string): void => {
          logs.push(message);
        },
        steps,
        table: "migration_history",
      });

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "",
          messages.reverting("0-backfill.sql", false),
          messages.reverted("0-backfill.sql", 0),
        ].map(normalizeMs),
      );
      assert.deepEqual(queries, [
        {
          sql: 'DELETE FROM "migration_history" WHERE file = $1;',
          params: ["0-backfill.sql"],
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
        { file: "0-create.sql", sql: "DROP TABLE person;" },
      ];
      const logs: string[] = [];
      await assert.rejects(
        (): Promise<void> =>
          executeDownPlan({
            client,
            log: (message: string): void => {
              logs.push(message);
            },
            steps,
            table: "migration_history",
          }),
        /cannot drop/,
      );

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "",
          messages.reverting("0-create.sql", true),
          messages.failed("0-create.sql", 0),
          messages.errorDetails(new Error("cannot drop")),
          messages.failureRolledBack(),
        ].map(normalizeMs),
      );
    });

    it("does not log failureRolledBack when an irreversible down step fails", async (): Promise<void> => {
      const client = {
        query: async (): Promise<{ rows: unknown[] }> => {
          throw new Error("history write failed");
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [{ file: "0-backfill.sql", sql: "" }];
      const logs: string[] = [];
      await assert.rejects(
        (): Promise<void> =>
          executeDownPlan({
            client,
            log: (message: string): void => {
              logs.push(message);
            },
            steps,
            table: "migration_history",
          }),
        /history write failed/,
      );

      assert.deepEqual(
        logs.map(normalizeMs),
        [
          "",
          messages.reverting("0-backfill.sql", false),
          messages.failed("0-backfill.sql", 0),
          messages.errorDetails(new Error("history write failed")),
        ].map(normalizeMs),
      );
    });

    it("does nothing for an empty down plan", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      await executeDownPlan({
        client,
        log: (): void => undefined,
        steps: [],
        table: "migration_history",
      });

      assert.deepEqual(queries, []);
    });
  });
});
