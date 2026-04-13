import * as assert from "assert";
import type * as pg from "pg";
import { executeDownPlan, executeUpPlan } from "./execution.js";
import type { MigrationStep } from "./types.js";

interface QueryCall {
  sql: string;
  params?: unknown[];
}

function createFakeClient(): { client: pg.Client; queries: QueryCall[] } {
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
    it("runs up SQL and records migrations in the history table", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        {
          file: "0-create.sql",
          index: 0,
          sql: "CREATE TABLE person (id integer);",
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

      assert.deepEqual(logs, ['↑  upgrading > "0-create.sql"']);
      assert.deepEqual(queries, [
        {
          sql: "CREATE TABLE person (id integer);",
          params: undefined,
        },
        {
          sql: "INSERT INTO migratorosaurus.migration_history ( index, file, date ) VALUES ( $1, $2, clock_timestamp() );",
          params: [0, "0-create.sql"],
        },
      ]);
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
    it("runs down SQL and removes migrations from the history table", async (): Promise<void> => {
      const { client, queries } = createFakeClient();
      const logs: string[] = [];

      const steps: MigrationStep[] = [
        {
          file: "0-create.sql",
          index: 0,
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
        {
          sql: "DROP TABLE person;",
          params: undefined,
        },
        {
          sql: "DELETE FROM migration_history WHERE file = $1;",
          params: ["0-create.sql"],
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
