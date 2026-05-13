import * as assert from "node:assert";
import type * as pg from "pg";
import { runInTransaction } from "./transaction.js";

interface QueryCall {
  sql: string;
}

function createFakeClient(
  options: {
    failOn?: string;
  } = {},
): {
  client: pg.Client;
  queries: QueryCall[];
} {
  const queries: QueryCall[] = [];
  const client = {
    query: async (sql: string): Promise<{ rows: unknown[] }> => {
      queries.push({ sql });
      if (sql === options.failOn) {
        throw new Error(`failed: ${sql}`);
      }
      return { rows: [] };
    },
  } as unknown as pg.Client;

  return { client, queries };
}

describe("transaction", (): void => {
  describe("runInTransaction", (): void => {
    it("commits and returns the callback result", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      const result = await runInTransaction(
        client,
        async (): Promise<string> => {
          await client.query("SELECT 1;");
          return "done";
        },
      );

      assert.equal(result, "done");
      assert.deepEqual(queries, [
        { sql: "BEGIN;" },
        { sql: "SELECT 1;" },
        { sql: "COMMIT;" },
      ]);
    });

    it("rolls back and preserves callback errors", async (): Promise<void> => {
      const { client, queries } = createFakeClient();

      await assert.rejects(
        (): Promise<void> =>
          runInTransaction(client, async (): Promise<void> => {
            await client.query("BROKEN SQL;");
            throw new Error("callback failed");
          }),
        /callback failed/,
      );

      assert.deepEqual(queries, [
        { sql: "BEGIN;" },
        { sql: "BROKEN SQL;" },
        { sql: "ROLLBACK;" },
      ]);
    });

    it("rolls back and preserves commit errors", async (): Promise<void> => {
      const { client, queries } = createFakeClient({ failOn: "COMMIT;" });

      await assert.rejects(
        (): Promise<void> =>
          runInTransaction(client, async (): Promise<void> => {
            await client.query("SELECT 1;");
          }),
        /failed: COMMIT;/,
      );

      assert.deepEqual(queries, [
        { sql: "BEGIN;" },
        { sql: "SELECT 1;" },
        { sql: "COMMIT;" },
        { sql: "ROLLBACK;" },
      ]);
    });

    it("ignores rollback errors and preserves the original error", async (): Promise<void> => {
      const queries: QueryCall[] = [];
      const client = {
        query: async (sql: string): Promise<{ rows: unknown[] }> => {
          queries.push({ sql });
          if (sql === "ROLLBACK;") {
            throw new Error("rollback failed");
          }
          return { rows: [] };
        },
      } as unknown as pg.Client;

      await assert.rejects(
        (): Promise<void> =>
          runInTransaction(client, async (): Promise<void> => {
            throw new Error("callback failed");
          }),
        /callback failed/,
      );

      assert.deepEqual(queries, [{ sql: "BEGIN;" }, { sql: "ROLLBACK;" }]);
    });
  });
});
