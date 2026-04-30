import * as assert from "assert";
import { readRuntimeEnv } from "./env.js";

describe("env", (): void => {
  it("reads runtime values from environment variables", (): void => {
    assert.deepEqual(
      readRuntimeEnv({
        DATABASE_URL: "postgres://example/db",
        MIGRATION_DIRECTORY: "sql/migrations",
      }),
      {
        databaseUrl: "postgres://example/db",
        migrationDirectory: "sql/migrations",
        migrationHistoryTable: "migration_history",
      },
    );
  });

  it("fills missing runtime values with defaults", (): void => {
    assert.deepEqual(readRuntimeEnv({}), {
      databaseUrl: undefined,
      migrationDirectory: "migrations",
      migrationHistoryTable: "migration_history",
    });
  });
});
