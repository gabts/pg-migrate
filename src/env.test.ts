import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { readRuntimeEnv } from "./env.js";

describe("env", (): void => {
  it("reads runtime values from environment variables", async (): Promise<void> => {
    assert.deepEqual(
      await readRuntimeEnv(
        {
          PGM_DATABASE_URL: "postgres://example/db",
          PGM_MIGRATIONS_DIRECTORY: "sql/migrations",
        },
        { envFilePath: false },
      ),
      {
        databaseUrl: "postgres://example/db",
        migrationsDirectory: "sql/migrations",
        migrationsTable: "schema_migrations",
      },
    );
  });

  it("fills missing runtime values with defaults", async (): Promise<void> => {
    assert.deepEqual(await readRuntimeEnv({}, { envFilePath: false }), {
      databaseUrl: undefined,
      migrationsDirectory: "migrations",
      migrationsTable: "schema_migrations",
    });
  });

  it("ignores unprefixed runtime environment variables", async (): Promise<void> => {
    assert.deepEqual(
      await readRuntimeEnv(
        {
          DATABASE_URL: "postgres://example/db",
          MIGRATIONS_DIRECTORY: "sql/migrations",
        },
        { envFilePath: false },
      ),
      {
        databaseUrl: undefined,
        migrationsDirectory: "migrations",
        migrationsTable: "schema_migrations",
      },
    );
  });

  it("reads runtime values from an env file", async (): Promise<void> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, ".env");

    try {
      await fs.writeFile(
        envFilePath,
        `
PGM_DATABASE_URL=postgres://file/db
PGM_MIGRATIONS_DIRECTORY=sql/migrations
`,
      );

      assert.deepEqual(await readRuntimeEnv({}, { envFilePath }), {
        databaseUrl: "postgres://file/db",
        migrationsDirectory: "sql/migrations",
        migrationsTable: "schema_migrations",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("allows env file values to contain equals signs", async (): Promise<void> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, ".env");

    try {
      await fs.writeFile(
        envFilePath,
        "PGM_DATABASE_URL=postgres://file/db?sslmode=require&foo=bar\n",
      );

      assert.equal(
        (await readRuntimeEnv({}, { envFilePath })).databaseUrl,
        "postgres://file/db?sslmode=require&foo=bar",
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers environment variables over env file values", async (): Promise<void> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, ".env");

    try {
      await fs.writeFile(
        envFilePath,
        `
PGM_DATABASE_URL=postgres://file/db
PGM_MIGRATIONS_DIRECTORY=file/migrations
`,
      );

      assert.deepEqual(
        await readRuntimeEnv(
          {
            PGM_DATABASE_URL: "postgres://env/db",
          },
          { envFilePath },
        ),
        {
          databaseUrl: "postgres://env/db",
          migrationsDirectory: "file/migrations",
          migrationsTable: "schema_migrations",
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses PGM_ENV_FILE when provided", async (): Promise<void> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-env-"));
    const envFilePath = path.join(tempDir, "custom.env");

    try {
      await fs.writeFile(
        envFilePath,
        "PGM_DATABASE_URL=postgres://custom/db\n",
      );

      assert.deepEqual(
        await readRuntimeEnv({
          PGM_ENV_FILE: envFilePath,
        }),
        {
          databaseUrl: "postgres://custom/db",
          migrationsDirectory: "migrations",
          migrationsTable: "schema_migrations",
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
