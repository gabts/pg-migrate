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

function databaseUrl(invocation: ResolvedInvocation): string {
  if (invocation.command === "create") {
    throw new Error("Expected a resolved database command.");
  }
  return invocation.options.url;
}

describe("resolve", (): void => {
  let tempDir: string;
  let previousCwd: string;

  // Each test uses a new temporary working directory. This prevents a .env
  // file in the repository from changing configuration resolution.
  beforeEach(async (): Promise<void> => {
    previousCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
    process.chdir(tempDir);
  });

  afterEach(async (): Promise<void> => {
    process.chdir(previousCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("applies CLI defaults", async (): Promise<void> => {
    assert.deepEqual(
      await resolveInvocation(status({ url: "postgres://args/db" }), {}),
      {
        command: "status",
        options: {
          directory: "migrations",
          table: "schema_migrations",
          url: "postgres://args/db",
        },
      },
    );
  });

  it("resolves create options without a database URL", async (): Promise<void> => {
    assert.deepEqual(
      await resolveInvocation(
        { command: "create", name: "add_users", values: {} },
        {},
      ),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("ignores empty database values for create", async (): Promise<void> => {
    assert.deepEqual(
      await resolveInvocation(
        { command: "create", name: "add_users", values: {} },
        { PGM_TABLE: "", PGM_URL: "" },
      ),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("does not pass verbose to the library options", async (): Promise<void> => {
    assert.deepEqual(
      await resolveInvocation(
        {
          command: "create",
          name: "add_users",
          values: { verbose: true },
        },
        {},
      ),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("does not pass quiet to the library options", async (): Promise<void> => {
    assert.deepEqual(
      await resolveInvocation(
        {
          command: "create",
          name: "add_users",
          values: { quiet: true },
        },
        {},
      ),
      {
        command: "create",
        options: { directory: "migrations", name: "add_users" },
      },
    );
  });

  it("preserves migration options", async (): Promise<void> => {
    const result = await resolveInvocation(
      {
        command: "up",
        values: {
          target: "20240101120000_init.sql",
          url: "postgres://args/db",
        },
      },
      {},
    );

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

  it("fills missing values from environment variables", async (): Promise<void> => {
    assert.deepEqual(
      await resolveInvocation(status({}), {
        PGM_DIRECTORY: "sql/migrations",
        PGM_TABLE: "migration_history",
        PGM_URL: "postgres://env/db",
      }),
      {
        command: "status",
        options: {
          directory: "sql/migrations",
          table: "migration_history",
          url: "postgres://env/db",
        },
      },
    );
  });

  it("ignores unprefixed environment variables", async (): Promise<void> => {
    await assert.rejects(
      resolveInvocation(status({}), {
        DIRECTORY: "sql/migrations",
        URL: "postgres://env/db",
      }),
      new Error("Missing required argument 'url'."),
    );
  });

  it("fills missing values from an explicit environment file", async (): Promise<void> => {
    const configPath = path.join(tempDir, "custom.env");
    await fs.writeFile(
      configPath,
      `
PGM_DIRECTORY=sql/migrations
PGM_TABLE=migration_history
PGM_URL=postgres://file/db
`,
    );

    assert.deepEqual(
      await resolveInvocation(status({ config: configPath }), {}),
      {
        command: "status",
        options: {
          directory: "sql/migrations",
          table: "migration_history",
          url: "postgres://file/db",
        },
      },
    );
  });

  it("reads the environment file path from PGM_CONFIG", async (): Promise<void> => {
    const configPath = path.join(tempDir, "custom.env");
    await fs.writeFile(configPath, "PGM_URL=postgres://file/db\n");

    const result = await resolveInvocation(status({}), {
      PGM_CONFIG: configPath,
    });

    assert.equal(databaseUrl(result), "postgres://file/db");
  });

  it("prefers the config option over PGM_CONFIG", async (): Promise<void> => {
    const argPath = path.join(tempDir, "arg.env");
    const envPath = path.join(tempDir, "env.env");
    await fs.writeFile(argPath, "PGM_URL=postgres://arg/db\n");
    await fs.writeFile(envPath, "PGM_URL=postgres://env/db\n");

    const result = await resolveInvocation(status({ config: argPath }), {
      PGM_CONFIG: envPath,
    });

    assert.equal(databaseUrl(result), "postgres://arg/db");
  });

  it("reads the default environment file", async (): Promise<void> => {
    await fs.writeFile(
      path.join(tempDir, ".env"),
      "PGM_URL=postgres://default/db\n",
    );

    const result = await resolveInvocation(status({}), {});

    assert.equal(databaseUrl(result), "postgres://default/db");
  });

  it("prefers options over environment and file values", async (): Promise<void> => {
    const configPath = path.join(tempDir, ".env");
    await fs.writeFile(configPath, "PGM_URL=postgres://file/db\n");

    const result = await resolveInvocation(
      status({ config: configPath, url: "postgres://args/db" }),
      { PGM_URL: "postgres://env/db" },
    );

    assert.equal(databaseUrl(result), "postgres://args/db");
  });

  it("prefers environment over file values", async (): Promise<void> => {
    const configPath = path.join(tempDir, ".env");
    await fs.writeFile(configPath, "PGM_URL=postgres://file/db\n");

    const result = await resolveInvocation(status({ config: configPath }), {
      PGM_URL: "postgres://env/db",
    });

    assert.equal(databaseUrl(result), "postgres://env/db");
  });

  it("rejects empty options instead of using environment values", async (): Promise<void> => {
    const env = {
      PGM_DIRECTORY: "sql/migrations",
      PGM_TABLE: "migration_history",
      PGM_URL: "postgres://env/db",
    };

    await assert.rejects(
      resolveInvocation(
        status({ directory: "", url: "postgres://args/db" }),
        env,
      ),
      new Error("Invalid value '' for 'directory'."),
    );
    await assert.rejects(
      resolveInvocation(status({ table: "", url: "postgres://args/db" }), env),
      new Error("Invalid value '' for 'table'."),
    );
    await assert.rejects(
      resolveInvocation(status({ url: "" }), env),
      new Error("Invalid value '' for 'url'."),
    );
  });

  it("rejects empty environment values instead of using file values", async (): Promise<void> => {
    await fs.writeFile(
      path.join(tempDir, ".env"),
      "PGM_URL=postgres://file/db\n",
    );

    await assert.rejects(
      resolveInvocation(status({}), { PGM_URL: "" }),
      new Error("Invalid value '' for 'url'."),
    );
  });

  it("rejects empty environment file values", async (): Promise<void> => {
    await fs.writeFile(path.join(tempDir, ".env"), "PGM_URL=\n");

    await assert.rejects(
      resolveInvocation(status({}), {}),
      new Error("Invalid value '' for 'url'."),
    );
  });

  it("rejects an empty config option instead of using PGM_CONFIG", async (): Promise<void> => {
    const configPath = path.join(tempDir, "custom.env");
    await fs.writeFile(configPath, "PGM_URL=postgres://file/db\n");

    await assert.rejects(
      resolveInvocation(status({ config: "" }), { PGM_CONFIG: configPath }),
      new Error("Invalid value '' for 'config'."),
    );
  });

  it("rejects a missing explicit config file", async (): Promise<void> => {
    const configPath = path.join(tempDir, "missing.env");

    await assert.rejects(
      resolveInvocation(status({ config: configPath }), {}),
      /Cannot read config file/,
    );
  });

  it("rejects a missing PGM_CONFIG file", async (): Promise<void> => {
    const configPath = path.join(tempDir, "missing.env");

    await assert.rejects(
      resolveInvocation(status({}), { PGM_CONFIG: configPath }),
      /Cannot read config file/,
    );
  });

  it("rejects an explicit config directory", async (): Promise<void> => {
    const configPath = path.join(tempDir, "config.d");
    await fs.mkdir(configPath);

    await assert.rejects(
      resolveInvocation(status({ config: configPath }), {}),
      /Cannot read config file/,
    );
  });

  it("ignores a missing default environment file", async (): Promise<void> => {
    await assert.doesNotReject(
      resolveInvocation(status({ url: "postgres://args/db" }), {}),
    );
  });

  it("ignores a default environment file directory", async (): Promise<void> => {
    await fs.mkdir(path.join(tempDir, ".env"));

    await assert.doesNotReject(
      resolveInvocation(status({ url: "postgres://args/db" }), {}),
    );
  });
});
