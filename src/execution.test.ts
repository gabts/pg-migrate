import * as assert from "assert";
import type * as pg from "pg";
import { executeDownPlan, executeUpPlan } from "./execution.js";
import type { MigrationStep } from "./types.js";

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

      assert.deepEqual(logs, [
        '↑  upgrading > "0-create.sql"',
        '↑  upgrading > "1-insert.sql"',
      ]);
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
            throw new Error("syntax error at BROKEN");
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      const steps: MigrationStep[] = [
        { file: "0-create.sql", sql: "CREATE TABLE person;" },
        { file: "1-break.sql", sql: "BROKEN SQL;" },
        { file: "2-never.sql", sql: "CREATE TABLE never_run;" },
      ];

      await assert.rejects(
        (): Promise<void> =>
          executeUpPlan({
            client,
            log: (): void => undefined,
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

      assert.deepEqual(logs, ['↓  downgrading > "0-create.sql"']);
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

      assert.deepEqual(logs, [
        '↓  downgrading > "0-backfill.sql" (no down section, skipping)',
      ]);
      assert.deepEqual(queries, [
        {
          sql: 'DELETE FROM "migration_history" WHERE file = $1;',
          params: ["0-backfill.sql"],
        },
      ]);
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
