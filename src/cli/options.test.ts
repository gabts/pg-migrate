import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseTokens } from "./args.js";
import {
  buildCreateOptions,
  buildDatabaseRunOptions,
  buildMigrationRunOptions,
} from "./options.js";

async function withEnvVars<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const originals = new Map<string, string | undefined>();
  const isolatedEnv = {
    PGM_ENV_FILE: "",
    ...env,
  };

  for (const [key, value] of Object.entries(isolatedEnv)) {
    originals.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of originals.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("options", (): void => {
  describe("buildCreateOptions", (): void => {
    it("uses PGM_MIGRATIONS_DIRECTORY when directory is omitted", async (): Promise<void> => {
      const parsed = parseTokens(["create", "--name", "create_person"]);

      const options = await withEnvVars(
        { PGM_MIGRATIONS_DIRECTORY: "sql/migrations" },
        () => buildCreateOptions(parsed, parsed.extraPositional),
      );

      assert.deepEqual(options, {
        directory: "sql/migrations",
        name: "create_person",
      });
    });

    it("prefers explicit directory and strips .sql from names", async (): Promise<void> => {
      const parsed = parseTokens([
        "create",
        "--directory",
        "explicit",
        "--name",
        "create_person.sql",
      ]);

      const options = await withEnvVars(
        { PGM_MIGRATIONS_DIRECTORY: "from-env" },
        () => buildCreateOptions(parsed, parsed.extraPositional),
      );

      assert.deepEqual(options, {
        directory: "explicit",
        name: "create_person",
      });
    });

    it("rejects positional create arguments", async (): Promise<void> => {
      const parsed = parseTokens(["create", "unexpected"]);

      await assert.rejects(async (): Promise<void> => {
        await buildCreateOptions(parsed, parsed.extraPositional);
      }, /Unexpected argument: unexpected/);
    });
  });

  describe("buildDatabaseRunOptions", (): void => {
    it("resolves database URL, directory, and table from flags", async (): Promise<void> => {
      const parsed = parseTokens([
        "validate",
        "--url",
        "postgres://example/db",
        "--directory",
        "sql/migrations",
        "--table",
        "custom_history",
      ]);

      assert.deepEqual(
        await buildDatabaseRunOptions(
          parsed,
          parsed.extraPositional,
          "validate",
        ),
        {
          clientConfig: {
            connectionString: "postgres://example/db",
            connectionTimeoutMillis: 10_000,
          },
          directory: "sql/migrations",
          table: "custom_history",
        },
      );
    });

    it("uses PGM_DATABASE_URL and shared defaults when flags are omitted", async (): Promise<void> => {
      const parsed = parseTokens(["up"]);

      const options = await withEnvVars(
        {
          PGM_DATABASE_URL: "postgres://env/db",
          PGM_MIGRATIONS_DIRECTORY: undefined,
        },
        () => buildDatabaseRunOptions(parsed, parsed.extraPositional, "up"),
      );

      assert.deepEqual(options, {
        clientConfig: {
          connectionString: "postgres://env/db",
          connectionTimeoutMillis: 10_000,
        },
        directory: "migrations",
        table: "schema_migrations",
      });
    });

    it("uses --env-file values when environment variables are omitted", async (): Promise<void> => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "pg_migrate-options-"),
      );
      const envFilePath = path.join(tempDir, ".env");
      await fs.writeFile(
        envFilePath,
        `
PGM_DATABASE_URL=postgres://file/db
PGM_MIGRATIONS_DIRECTORY=file/migrations
`,
      );
      const parsed = parseTokens(["status", "--env-file", envFilePath]);

      try {
        const options = await withEnvVars(
          {
            PGM_DATABASE_URL: undefined,
            PGM_MIGRATIONS_DIRECTORY: undefined,
          },
          () =>
            buildDatabaseRunOptions(parsed, parsed.extraPositional, "status"),
        );

        assert.deepEqual(options, {
          clientConfig: {
            connectionString: "postgres://file/db",
            connectionTimeoutMillis: 10_000,
          },
          directory: "file/migrations",
          table: "schema_migrations",
        });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("uses PGM_MIGRATIONS_DIRECTORY when database command directory is omitted", async (): Promise<void> => {
      const parsed = parseTokens(["down", "postgres://example/db"]);

      const options = await withEnvVars(
        { PGM_MIGRATIONS_DIRECTORY: "sql/migrations" },
        () => buildDatabaseRunOptions(parsed, parsed.extraPositional, "down"),
      );

      assert.deepEqual(options, {
        clientConfig: {
          connectionString: "postgres://example/db",
          connectionTimeoutMillis: 10_000,
        },
        directory: "sql/migrations",
        table: "schema_migrations",
      });
    });

    it("rejects duplicate explicit database URLs", async (): Promise<void> => {
      const parsed = parseTokens([
        "down",
        "postgres://positional/db",
        "--url",
        "postgres://flag/db",
      ]);

      await assert.rejects(async (): Promise<void> => {
        await buildDatabaseRunOptions(parsed, parsed.extraPositional, "down");
      }, /Database URL provided multiple times/);
    });

    it("rejects missing database URLs", async (): Promise<void> => {
      for (const command of ["up", "down", "validate", "status"] as const) {
        const parsed = parseTokens([command]);

        await withEnvVars(
          { PGM_DATABASE_URL: undefined },
          async (): Promise<void> => {
            await assert.rejects(
              async (): Promise<void> => {
                await buildDatabaseRunOptions(
                  parsed,
                  parsed.extraPositional,
                  command,
                );
              },
              new RegExp(`Database URL is required for ${command}`),
            );
          },
        );
      }
    });
  });

  describe("buildMigrationRunOptions", (): void => {
    it("adds migration-only dry-run and target options", async (): Promise<void> => {
      const parsed = parseTokens([
        "up",
        "postgres://example/db",
        "--dry-run",
        "--target",
        "20260429123456_create.sql",
      ]);

      const options = await withEnvVars(
        { PGM_MIGRATIONS_DIRECTORY: undefined },
        () => buildMigrationRunOptions(parsed, parsed.extraPositional, "up"),
      );

      assert.deepEqual(options, {
        clientConfig: {
          connectionString: "postgres://example/db",
          connectionTimeoutMillis: 10_000,
        },
        directory: "migrations",
        dryRun: true,
        table: "schema_migrations",
        target: "20260429123456_create.sql",
      });
    });
  });
});
