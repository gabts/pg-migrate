import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readRuntimeEnv } from "./env.js";

describe("env", (): void => {
  it("reads runtime values from environment variables", (): void => {
    assert.deepEqual(
      readRuntimeEnv(
        {
          PGM_DATABASE_URL: "postgres://example/db",
          PGM_MIGRATION_DIRECTORY: "sql/migrations",
        },
        { envFilePath: false },
      ),
      {
        databaseUrl: "postgres://example/db",
        migrationDirectory: "sql/migrations",
        migrationHistoryTable: "migration_history",
      },
    );
  });

  it("fills missing runtime values with defaults", (): void => {
    assert.deepEqual(readRuntimeEnv({}, { envFilePath: false }), {
      databaseUrl: undefined,
      migrationDirectory: "migrations",
      migrationHistoryTable: "migration_history",
    });
  });

  it("ignores unprefixed runtime environment variables", (): void => {
    assert.deepEqual(
      readRuntimeEnv(
        {
          DATABASE_URL: "postgres://example/db",
          MIGRATION_DIRECTORY: "sql/migrations",
        },
        { envFilePath: false },
      ),
      {
        databaseUrl: undefined,
        migrationDirectory: "migrations",
        migrationHistoryTable: "migration_history",
      },
    );
  });

  it("reads runtime values from an env file", (): void => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, ".env");

    try {
      fs.writeFileSync(
        envFilePath,
        `
PGM_DATABASE_URL=postgres://file/db
PGM_MIGRATION_DIRECTORY=sql/migrations
`,
      );

      assert.deepEqual(readRuntimeEnv({}, { envFilePath }), {
        databaseUrl: "postgres://file/db",
        migrationDirectory: "sql/migrations",
        migrationHistoryTable: "migration_history",
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("allows env file values to contain equals signs", (): void => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, ".env");

    try {
      fs.writeFileSync(
        envFilePath,
        "PGM_DATABASE_URL=postgres://file/db?sslmode=require&foo=bar\n",
      );

      assert.equal(
        readRuntimeEnv({}, { envFilePath }).databaseUrl,
        "postgres://file/db?sslmode=require&foo=bar",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers environment variables over env file values", (): void => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, ".env");

    try {
      fs.writeFileSync(
        envFilePath,
        `
PGM_DATABASE_URL=postgres://file/db
PGM_MIGRATION_DIRECTORY=file/migrations
`,
      );

      assert.deepEqual(
        readRuntimeEnv(
          {
            PGM_DATABASE_URL: "postgres://env/db",
          },
          { envFilePath },
        ),
        {
          databaseUrl: "postgres://env/db",
          migrationDirectory: "file/migrations",
          migrationHistoryTable: "migration_history",
        },
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses PGM_ENV_FILE when provided", (): void => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, "custom.env");

    try {
      fs.writeFileSync(envFilePath, "PGM_DATABASE_URL=postgres://custom/db\n");

      assert.deepEqual(
        readRuntimeEnv({
          PGM_ENV_FILE: envFilePath,
        }),
        {
          databaseUrl: "postgres://custom/db",
          migrationDirectory: "migrations",
          migrationHistoryTable: "migration_history",
        },
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
