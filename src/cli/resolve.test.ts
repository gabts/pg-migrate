import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Args, ResolvedInvocation, ValidatedInvocation } from "./model.js";
import { resolveInvocation } from "./resolve.js";

function status(values: Args): ValidatedInvocation {
  return { command: "status", values };
}

// process.loadEnvFile writes to the real process environment, so tests set
// their variables there too. Each test restores the environment afterwards.
function resolve(
  invocation: ValidatedInvocation,
  env: NodeJS.ProcessEnv = {},
): ResolvedInvocation {
  Object.assign(process.env, env);
  return resolveInvocation(invocation);
}

function databaseUrl(invocation: ResolvedInvocation): string {
  if (invocation.command === "create") {
    throw new Error("Expected a resolved database command.");
  }
  return invocation.options.url;
}

describe("resolve", (): void => {
  let tempDir: string;
  let previousCwd: string;
  let previousEnv: NodeJS.ProcessEnv;

  // Each test uses a new temporary working directory. This prevents a .env
  // file in the repository from changing configuration resolution. PGM_
  // variables and DATABASE_URL from the shell running the tests are removed
  // for the same reason.
  beforeEach(async (): Promise<void> => {
    previousCwd = process.cwd();
    previousEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("PGM_") || key === "DATABASE_URL") {
        delete process.env[key];
      }
    }
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
    process.chdir(tempDir);
  });

  afterEach(async (): Promise<void> => {
    process.chdir(previousCwd);
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("applies CLI defaults", (): void => {
    assert.deepEqual(resolve(status({ url: "postgres://args/db" })), {
      command: "status",
      failOnPending: false,
      options: {
        directory: "migrations",
        table: "schema_migrations",
        url: "postgres://args/db",
      },
    });
  });

  it("resolves the status pending flag", (): void => {
    assert.deepEqual(
      resolve(status({ "fail-on-pending": true, url: "postgres://args/db" })),
      {
        command: "status",
        failOnPending: true,
        options: {
          directory: "migrations",
          table: "schema_migrations",
          url: "postgres://args/db",
        },
      },
    );
  });

  it("resolves create options without a database URL", (): void => {
    assert.deepEqual(
      resolve({ command: "create", name: "add_users", values: {} }),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("ignores empty database values for create", (): void => {
    assert.deepEqual(
      resolve(
        { command: "create", name: "add_users", values: {} },
        { PGM_TABLE: "", DATABASE_URL: "" },
      ),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("does not pass verbose to the library options", (): void => {
    assert.deepEqual(
      resolve({
        command: "create",
        name: "add_users",
        values: { verbose: true },
      }),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("does not pass quiet to the library options", (): void => {
    assert.deepEqual(
      resolve({
        command: "create",
        name: "add_users",
        values: { quiet: true },
      }),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("preserves migration options", (): void => {
    const result = resolve({
      command: "up",
      values: {
        target: "20240101120000_init.sql",
        url: "postgres://args/db",
      },
    });

    assert.deepEqual(result, {
      command: "up",
      options: {
        directory: "migrations",
        table: "schema_migrations",
        target: "20240101120000_init.sql",
        url: "postgres://args/db",
      },
    });
  });

  it("passes the repair target to the library options", (): void => {
    const result = resolve({
      command: "repair",
      target: "20240101120000",
      values: { url: "postgres://args/db" },
    });

    assert.deepEqual(result, {
      command: "repair",
      options: {
        directory: "migrations",
        table: "schema_migrations",
        target: "20240101120000",
        url: "postgres://args/db",
      },
    });
  });

  it("fills missing values from environment variables", (): void => {
    assert.deepEqual(
      resolve(status({}), {
        PGM_DIRECTORY: "sql/migrations",
        PGM_TABLE: "migration_history",
        DATABASE_URL: "postgres://env/db",
      }),
      {
        command: "status",
        failOnPending: false,
        options: {
          directory: "sql/migrations",
          table: "migration_history",
          url: "postgres://env/db",
        },
      },
    );
  });

  it("ignores unprefixed variables other than DATABASE_URL", (): void => {
    assert.throws(
      () =>
        resolve(status({}), {
          DIRECTORY: "sql/migrations",
          URL: "postgres://env/db",
        }),
      new Error("Missing required argument 'url'."),
    );
  });

  it("fills missing values from an explicit environment file", async (): Promise<void> => {
    const envFilePath = path.join(tempDir, "custom.env");
    await fs.writeFile(
      envFilePath,
      `
PGM_DIRECTORY=sql/migrations
PGM_TABLE=migration_history
DATABASE_URL=postgres://file/db
`,
    );

    assert.deepEqual(resolve(status({ "env-file": envFilePath })), {
      command: "status",
      failOnPending: false,
      options: {
        directory: "sql/migrations",
        table: "migration_history",
        url: "postgres://file/db",
      },
    });
  });

  it("reads the environment file path from PGM_ENV_FILE", async (): Promise<void> => {
    const envFilePath = path.join(tempDir, "custom.env");
    await fs.writeFile(envFilePath, "DATABASE_URL=postgres://file/db\n");

    const result = resolve(status({}), {
      PGM_ENV_FILE: envFilePath,
    });

    assert.equal(databaseUrl(result), "postgres://file/db");
  });

  it("loads every variable of the environment file", async (): Promise<void> => {
    await fs.writeFile(
      path.join(tempDir, ".env"),
      "DATABASE_URL=postgres://file/db\nPGPASSWORD=secret\n",
    );
    // A shell value would win over the file. afterEach restores it.
    delete process.env.PGPASSWORD;

    resolve(status({}));

    assert.equal(process.env.PGPASSWORD, "secret");
  });

  it("prefers the env-file option over PGM_ENV_FILE", async (): Promise<void> => {
    const argPath = path.join(tempDir, "arg.env");
    const envPath = path.join(tempDir, "env.env");
    await fs.writeFile(argPath, "DATABASE_URL=postgres://arg/db\n");
    await fs.writeFile(envPath, "DATABASE_URL=postgres://env/db\n");

    const result = resolve(status({ "env-file": argPath }), {
      PGM_ENV_FILE: envPath,
    });

    assert.equal(databaseUrl(result), "postgres://arg/db");
  });

  it("reads the default environment file", async (): Promise<void> => {
    await fs.writeFile(
      path.join(tempDir, ".env"),
      "DATABASE_URL=postgres://default/db\n",
    );

    const result = resolve(status({}));

    assert.equal(databaseUrl(result), "postgres://default/db");
  });

  it("prefers options over environment and file values", async (): Promise<void> => {
    const envFilePath = path.join(tempDir, ".env");
    await fs.writeFile(envFilePath, "DATABASE_URL=postgres://file/db\n");

    const result = resolve(
      status({ "env-file": envFilePath, url: "postgres://args/db" }),
      { DATABASE_URL: "postgres://env/db" },
    );

    assert.equal(databaseUrl(result), "postgres://args/db");
  });

  it("prefers environment over file values", async (): Promise<void> => {
    const envFilePath = path.join(tempDir, ".env");
    await fs.writeFile(envFilePath, "DATABASE_URL=postgres://file/db\n");

    const result = resolve(status({ "env-file": envFilePath }), {
      DATABASE_URL: "postgres://env/db",
    });

    assert.equal(databaseUrl(result), "postgres://env/db");
  });

  it("rejects empty options instead of using environment values", (): void => {
    const env = {
      PGM_DIRECTORY: "sql/migrations",
      PGM_TABLE: "migration_history",
      DATABASE_URL: "postgres://env/db",
    };

    assert.throws(
      () => resolve(status({ directory: "", url: "postgres://args/db" }), env),
      new Error("Invalid value '' for 'directory'."),
    );
    assert.throws(
      () => resolve(status({ table: "", url: "postgres://args/db" }), env),
      new Error("Invalid value '' for 'table'."),
    );
    assert.throws(
      () => resolve(status({ url: "" }), env),
      new Error("Invalid value '' for 'url'."),
    );
  });

  it("rejects empty environment values instead of using file values", async (): Promise<void> => {
    await fs.writeFile(
      path.join(tempDir, ".env"),
      "DATABASE_URL=postgres://file/db\n",
    );

    assert.throws(
      () => resolve(status({}), { DATABASE_URL: "" }),
      new Error("Invalid value '' for 'url'."),
    );
  });

  it("rejects empty environment file values", async (): Promise<void> => {
    await fs.writeFile(path.join(tempDir, ".env"), "DATABASE_URL=\n");

    assert.throws(
      () => resolve(status({})),
      new Error("Invalid value '' for 'url'."),
    );
  });

  it("rejects an empty env-file option instead of using PGM_ENV_FILE", async (): Promise<void> => {
    const envFilePath = path.join(tempDir, "custom.env");
    await fs.writeFile(envFilePath, "DATABASE_URL=postgres://file/db\n");

    assert.throws(
      () =>
        resolve(status({ "env-file": "" }), {
          PGM_ENV_FILE: envFilePath,
        }),
      new Error("Invalid value '' for 'env-file'."),
    );
  });

  it("rejects a missing explicit env file", (): void => {
    const envFilePath = path.join(tempDir, "missing.env");

    assert.throws(
      () => resolve(status({ "env-file": envFilePath })),
      (error: unknown): boolean => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `Cannot read env file '${envFilePath}'.`);
        assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
        return true;
      },
    );
  });

  it("rejects a missing PGM_ENV_FILE file", (): void => {
    const envFilePath = path.join(tempDir, "missing.env");

    assert.throws(
      () => resolve(status({}), { PGM_ENV_FILE: envFilePath }),
      /Cannot read env file/,
    );
  });

  it("rejects an explicit env file directory", async (): Promise<void> => {
    const envFilePath = path.join(tempDir, "env.d");
    await fs.mkdir(envFilePath);

    assert.throws(
      () => resolve(status({ "env-file": envFilePath })),
      /Cannot read env file/,
    );
  });

  it("ignores a missing default environment file", (): void => {
    assert.doesNotThrow(() => resolve(status({ url: "postgres://args/db" })));
  });

  it("ignores an unreadable default environment file", async (): Promise<void> => {
    await fs.writeFile(path.join(tempDir, ".env"), "", { mode: 0o000 });

    assert.doesNotThrow(() => resolve(status({ url: "postgres://args/db" })));
  });

  it("ignores a default environment file directory", async (): Promise<void> => {
    await fs.mkdir(path.join(tempDir, ".env"));

    assert.doesNotThrow(() => resolve(status({ url: "postgres://args/db" })));
  });
});
