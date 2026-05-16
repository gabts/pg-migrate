import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as pg from "pg";
import { readRuntimeEnv } from "../env.js";
import { runCli } from "./run.js";

interface CliRunResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

async function runCliInProcessRaw(args: string[]): Promise<CliRunResult> {
  type StdoutWriteArgs = Parameters<typeof process.stdout.write>;
  type StderrWriteArgs = Parameters<typeof process.stderr.write>;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  function stdoutWriteSpy(...writeArgs: StdoutWriteArgs): boolean {
    const [chunk, encodingOrCallback, callback] = writeArgs;
    if (typeof chunk === "string") {
      stdoutChunks.push(chunk);
    } else {
      stdoutChunks.push(Buffer.from(chunk).toString("utf8"));
    }
    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (typeof done === "function") {
      done();
    }
    return true;
  }

  function stderrWriteSpy(...writeArgs: StderrWriteArgs): boolean {
    const [chunk, encodingOrCallback, callback] = writeArgs;
    if (typeof chunk === "string") {
      stderrChunks.push(chunk);
    } else {
      stderrChunks.push(Buffer.from(chunk).toString("utf8"));
    }
    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (typeof done === "function") {
      done();
    }
    return true;
  }

  // Color decisions still use the real process.stderr.isTTY; content assertions should strip ANSI.
  Object.defineProperty(process.stdout, "write", {
    configurable: true,
    value: stdoutWriteSpy as typeof process.stdout.write,
    writable: true,
  });
  Object.defineProperty(process.stderr, "write", {
    configurable: true,
    value: stderrWriteSpy as typeof process.stderr.write,
    writable: true,
  });

  try {
    const status = await runCli(["node", "pg-migrate", ...args]);
    return {
      status,
      stderr: stderrChunks.join(""),
      stdout: stdoutChunks.join(""),
    };
  } finally {
    Object.defineProperty(process.stdout, "write", {
      configurable: true,
      value: originalStdoutWrite,
      writable: true,
    });
    Object.defineProperty(process.stderr, "write", {
      configurable: true,
      value: originalStderrWrite,
      writable: true,
    });
  }
}

async function runCliInProcess(args: string[]): Promise<string> {
  const result = await runCliInProcessRaw(args);

  if (result.status !== 0) {
    throw new Error(result.stderr.trim());
  }

  return result.stdout;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

describe("cli run", (): void => {
  let tempDir: string;

  beforeEach(async (): Promise<void> => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-cli-run-"));
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("prints help text", async (): Promise<void> => {
    const output = await runCliInProcess(["--help"]);

    assert.ok(output.length > 0);
  });

  it("emits parseable JSON for help when --json is set", async (): Promise<void> => {
    const result = await runCliInProcessRaw(["--json", "--help"]);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ["command", "help", "ok"]);
    assert.equal(parsed.command, null);
    assert.equal(parsed.ok, true);
    assert.match(parsed.help, /Usage: pg-migrate/);
    assert.equal(result.stderr, "");
  });

  it("emits parseable JSON for create with no incidental stdout text", async (): Promise<void> => {
    const result = await runCliInProcessRaw([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
      "--json",
    ]);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ["command", "file"]);
    assert.equal(parsed.command, "create");
    assert.equal(path.dirname(parsed.file), tempDir);
    assert.equal(result.stderr, "");
  });

  it("creates irreversible migrations from create --irreversible", async (): Promise<void> => {
    const result = await runCliInProcessRaw([
      "create",
      "--directory",
      tempDir,
      "--name",
      "purge_old_posts",
      "--irreversible",
      "--json",
    ]);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(
      await fs.readFile(parsed.file, "utf8"),
      "-- migrate:irreversible\n",
    );
    assert.equal(result.stderr, "");
  });

  it("creates missing output directories for create", async (): Promise<void> => {
    const directory = path.join(tempDir, "missing", "migrations");
    const result = await runCliInProcessRaw([
      "create",
      "--directory",
      directory,
      "--name",
      "create_person",
      "--json",
    ]);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(path.dirname(parsed.file), directory);
    assert.equal((await fs.stat(directory)).isDirectory(), true);
    assert.equal(result.stderr, "");
  });

  it("emits parseable JSON for successful validate with no incidental stdout text", async function (this: Mocha.Context): Promise<void> {
    const databaseUrl = (await readRuntimeEnv()).databaseUrl;
    if (!databaseUrl) {
      this.skip();
      return;
    }

    const createFile = "20260416090000_create.sql";
    const insertFile = "20260416090100_insert.sql";
    await fs.writeFile(
      path.join(tempDir, createFile),
      `-- migrate:up
CREATE TABLE cli_validate_person (
  id SERIAL PRIMARY KEY
);

-- migrate:down
DROP TABLE cli_validate_person;
`,
    );
    await fs.writeFile(
      path.join(tempDir, insertFile),
      `-- migrate:up
INSERT INTO cli_validate_person DEFAULT VALUES;

-- migrate:down
DELETE FROM cli_validate_person;
`,
    );

    const table = `migration_history_cli_validate_${Date.now()}_${process.pid}`;
    const client = new pg.Client(databaseUrl);
    await client.connect();

    try {
      await client.query(`
        CREATE TABLE ${table}
        (
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      const result = await runCliInProcessRaw([
        "validate",
        "--url",
        databaseUrl,
        "--directory",
        tempDir,
        "--table",
        table,
        "--json",
        "--quiet",
      ]);

      assert.equal(result.status, 0);
      assert.equal(result.stdout.trimEnd().split("\n").length, 1);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(parsed).sort(), ["command", "ok"]);
      assert.equal(parsed.command, "validate");
      assert.equal(parsed.ok, true);
      assert.equal(result.stderr, "");
    } finally {
      await client.query(`DROP TABLE IF EXISTS ${table};`);
      await client.end();
    }
  });

  it("emits parseable JSON for validate failures while keeping logs on stderr", async (): Promise<void> => {
    const missingDirectory = path.join(tempDir, "missing");
    const result = await runCliInProcessRaw([
      "validate",
      "--url",
      "postgres://localhost:5432/example",
      "--directory",
      missingDirectory,
      "--json",
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ["command", "error", "ok"]);
    assert.equal(parsed.command, "validate");
    assert.equal(parsed.ok, false);
    assert.match(
      parsed.error,
      new RegExp(
        `Migrations directory does not exist: ${escapeRegExp(missingDirectory)}`,
      ),
    );
    const logs = result.stderr
      .trimEnd()
      .split("\n")
      .map(
        (
          line,
        ): {
          error?: { message?: string };
          fields?: { pg_migrate?: { correlation_id?: string } };
          message?: string;
        } => JSON.parse(line),
      );
    assert.ok(
      logs.some(
        (log): boolean =>
          log.error?.message ===
          `Migrations directory does not exist: ${missingDirectory}`,
      ),
    );
    assert.ok(
      logs.every(
        (log): boolean =>
          typeof log.fields?.pg_migrate?.correlation_id === "string",
      ),
    );
    assert.equal(
      new Set(
        logs.map(
          (log): string | undefined => log.fields?.pg_migrate?.correlation_id,
        ),
      ).size,
      1,
    );
  });

  it("keeps json stdout clean while sending verbose logs to stderr", async (): Promise<void> => {
    const result = await runCliInProcessRaw([
      "--json",
      "--verbose",
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
      "--irreversible",
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "create");
    const logs = result.stderr
      .trimEnd()
      .split("\n")
      .map(
        (
          line,
        ): {
          event?: { action?: string };
          fields?: {
            pg_migrate?: { command?: string; irreversible?: boolean };
          };
          level?: string;
        } => JSON.parse(line),
      );
    assert.ok(
      logs.some(
        (log): boolean =>
          log.level === "debug" &&
          log.event?.action === "command.options" &&
          log.fields?.pg_migrate?.command === "create" &&
          log.fields?.pg_migrate?.irreversible === true,
      ),
    );
  });

  it("suppresses non-error logs in quiet mode", async (): Promise<void> => {
    const missingDirectory = path.join(tempDir, "missing");
    const result = await runCliInProcessRaw([
      "--quiet",
      "up",
      "postgres://localhost:5432/example",
      "--directory",
      missingDirectory,
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /Migration run started/);
    assert.match(result.stderr, /Migration run aborted/);
    assert.match(
      result.stderr,
      new RegExp(`Migrations directory does not exist: ${missingDirectory}`),
    );
  });

  it("emits debug logs when verbose is enabled", async (): Promise<void> => {
    const result = await runCliInProcessRaw([
      "--verbose",
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
    ]);

    assert.equal(result.status, 0);
    assert.match(stripAnsi(result.stderr), /Debug: Command options parsed/);
    assert.match(stripAnsi(result.stderr), /command=create/);
    assert.match(stripAnsi(result.stderr), /irreversible=false/);
    assert.ok(result.stdout.trim().length > 0);
  });

  it("uses main run debug logs for up without duplicate command logs", async (): Promise<void> => {
    const missingDirectory = path.join(tempDir, "missing");
    const result = await runCliInProcessRaw([
      "--verbose",
      "up",
      "postgres://localhost:5432/example",
      "--directory",
      missingDirectory,
    ]);

    assert.equal(result.status, 1);
    assert.match(stripAnsi(result.stderr), /Debug: Run options parsed/);
    assert.match(stripAnsi(result.stderr), /command=up/);
    assert.doesNotMatch(stripAnsi(result.stderr), /Command options parsed/);
  });

  it("emits parseable JSON on parse-time failures when --json is set", async (): Promise<void> => {
    const result = await runCliInProcessRaw(["--json", "--bogus"]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ["command", "error", "ok"]);
    assert.equal(parsed.command, null);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /Unknown argument: --bogus/);
    assert.match(stripAnsi(result.stderr), /Unknown argument: --bogus/);
  });

  it("does not treat --json as a parse-time global when it is a flag value", async (): Promise<void> => {
    const result = await runCliInProcessRaw([
      "create",
      "--name",
      "--json",
      "--bogus",
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(stripAnsi(result.stderr), /Unknown argument: --bogus/);
  });

  describe("--no-color on parse-time errors", (): void => {
    async function runWithTty(args: string[]): Promise<CliRunResult> {
      const originalIsTTY = process.stderr.isTTY;
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: true,
        writable: true,
      });
      try {
        return await runCliInProcessRaw(args);
      } finally {
        Object.defineProperty(process.stderr, "isTTY", {
          configurable: true,
          value: originalIsTTY,
          writable: true,
        });
      }
    }

    it("emits ANSI color on parse errors under a tty by default", async (): Promise<void> => {
      const result = await runWithTty(["--bogus"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /\x1b\[[0-9;]*m/);
    });

    it("suppresses ANSI color on parse errors when --no-color is set", async (): Promise<void> => {
      const result = await runWithTty(["--no-color", "--bogus"]);

      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stderr, /\x1b\[[0-9;]*m/);
      assert.match(stripAnsi(result.stderr), /Unknown argument: --bogus/);
    });

    it("does not treat --no-color as a parse-time global when it is a flag value", async (): Promise<void> => {
      const result = await runWithTty([
        "create",
        "--name",
        "--no-color",
        "--bogus",
      ]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /\x1b\[[0-9;]*m/);
      assert.match(stripAnsi(result.stderr), /Unknown argument: --bogus/);
    });
  });
});
