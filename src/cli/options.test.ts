import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseTokens } from "./args.js";
import {
  buildCreateOptions,
  buildDatabaseRunOptions,
  buildMigrationRunOptions,
} from "./options.js";

function withEnvVars<T>(
  env: Record<string, string | undefined>,
  fn: () => T,
): T {
  const originals = new Map<string, string | undefined>();
  const isolatedEnv = {
    PG_MIGRATE_ENV_FILE: "",
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
    return fn();
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
    it("uses MIGRATION_DIRECTORY when directory is omitted", (): void => {
      const parsed = parseTokens(["create", "--name", "create_person"]);

      const options = withEnvVars(
        { MIGRATION_DIRECTORY: "sql/migrations" },
        (): ReturnType<typeof buildCreateOptions> =>
          buildCreateOptions(parsed, parsed.extraPositional),
      );

      assert.deepEqual(options, {
        directory: "sql/migrations",
        name: "create_person",
      });
    });

    it("prefers explicit directory and strips .sql from names", (): void => {
      const parsed = parseTokens([
        "create",
        "--directory",
        "explicit",
        "--name",
        "create_person.sql",
      ]);

      const options = withEnvVars(
        { MIGRATION_DIRECTORY: "from-env" },
        (): ReturnType<typeof buildCreateOptions> =>
          buildCreateOptions(parsed, parsed.extraPositional),
      );

      assert.deepEqual(options, {
        directory: "explicit",
        name: "create_person",
      });
    });

    it("rejects positional create arguments", (): void => {
      const parsed = parseTokens(["create", "unexpected"]);

      assert.throws((): void => {
        buildCreateOptions(parsed, parsed.extraPositional);
      }, /Unexpected argument: unexpected/);
    });
  });

  describe("buildDatabaseRunOptions", (): void => {
    it("resolves database URL, directory, and table from flags", (): void => {
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
        buildDatabaseRunOptions(parsed, parsed.extraPositional, "validate"),
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

    it("uses DATABASE_URL and shared defaults when flags are omitted", (): void => {
      const parsed = parseTokens(["up"]);

      const options = withEnvVars(
        {
          DATABASE_URL: "postgres://env/db",
          MIGRATION_DIRECTORY: undefined,
        },
        (): ReturnType<typeof buildDatabaseRunOptions> =>
          buildDatabaseRunOptions(parsed, parsed.extraPositional, "up"),
      );

      assert.deepEqual(options, {
        clientConfig: {
          connectionString: "postgres://env/db",
          connectionTimeoutMillis: 10_000,
        },
        directory: "migrations",
        table: "migration_history",
      });
    });

    it("uses --env-file values when environment variables are omitted", (): void => {
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pg_migrate-options-"),
      );
      const envFilePath = path.join(tempDir, ".env");
      fs.writeFileSync(
        envFilePath,
        `
DATABASE_URL=postgres://file/db
MIGRATION_DIRECTORY=file/migrations
`,
      );
      const parsed = parseTokens(["status", "--env-file", envFilePath]);

      try {
        const options = withEnvVars(
          {
            DATABASE_URL: undefined,
            MIGRATION_DIRECTORY: undefined,
          },
          (): ReturnType<typeof buildDatabaseRunOptions> =>
            buildDatabaseRunOptions(parsed, parsed.extraPositional, "status"),
        );

        assert.deepEqual(options, {
          clientConfig: {
            connectionString: "postgres://file/db",
            connectionTimeoutMillis: 10_000,
          },
          directory: "file/migrations",
          table: "migration_history",
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("uses MIGRATION_DIRECTORY when database command directory is omitted", (): void => {
      const parsed = parseTokens(["down", "postgres://example/db"]);

      const options = withEnvVars(
        { MIGRATION_DIRECTORY: "sql/migrations" },
        (): ReturnType<typeof buildDatabaseRunOptions> =>
          buildDatabaseRunOptions(parsed, parsed.extraPositional, "down"),
      );

      assert.deepEqual(options, {
        clientConfig: {
          connectionString: "postgres://example/db",
          connectionTimeoutMillis: 10_000,
        },
        directory: "sql/migrations",
        table: "migration_history",
      });
    });

    it("rejects duplicate explicit database URLs", (): void => {
      const parsed = parseTokens([
        "down",
        "postgres://positional/db",
        "--url",
        "postgres://flag/db",
      ]);

      assert.throws((): void => {
        buildDatabaseRunOptions(parsed, parsed.extraPositional, "down");
      }, /Database URL provided multiple times/);
    });

    it("rejects missing database URLs", (): void => {
      for (const command of ["up", "down", "validate", "status"] as const) {
        const parsed = parseTokens([command]);

        withEnvVars({ DATABASE_URL: undefined }, (): void => {
          assert.throws(
            (): void => {
              buildDatabaseRunOptions(parsed, parsed.extraPositional, command);
            },
            new RegExp(`Database URL is required for ${command}`),
          );
        });
      }
    });
  });

  describe("buildMigrationRunOptions", (): void => {
    it("adds migration-only dry-run and target options", (): void => {
      const parsed = parseTokens([
        "up",
        "postgres://example/db",
        "--dry-run",
        "--target",
        "20260429123456_create.sql",
      ]);

      const options = withEnvVars(
        { MIGRATION_DIRECTORY: undefined },
        (): ReturnType<typeof buildMigrationRunOptions> =>
          buildMigrationRunOptions(parsed, parsed.extraPositional, "up"),
      );

      assert.deepEqual(options, {
        clientConfig: {
          connectionString: "postgres://example/db",
          connectionTimeoutMillis: 10_000,
        },
        directory: "migrations",
        dryRun: true,
        table: "migration_history",
        target: "20260429123456_create.sql",
      });
    });
  });
});
