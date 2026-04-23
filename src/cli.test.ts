import { spawnSync } from "child_process";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { cli } from "./cli.js";

interface CliRunResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

function runCliRaw(args: string[]): CliRunResult {
  const cliPath = path.join(__dirname, "..", "bin", "cli.js");
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

async function runCliInProcessRaw(args: string[]): Promise<CliRunResult> {
  type StdoutWriteArgs = Parameters<typeof process.stdout.write>;
  type StderrWriteArgs = Parameters<typeof process.stderr.write>;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const stdoutWriteSpy = (...writeArgs: StdoutWriteArgs): boolean => {
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
  };

  const stderrWriteSpy = (...writeArgs: StderrWriteArgs): boolean => {
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
  };

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
    const status = await cli(["node", "migratorosaurus", ...args]);
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

async function withoutDatabaseUrl<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  }
}

async function withEnvVars<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const originals = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function assertCreatedMigrationPath(
  stdoutText: string,
  directory: string,
  name: string,
): string {
  const createdPath = stdoutText.trim();

  assert.equal(path.dirname(createdPath), directory);
  assert.match(
    path.basename(createdPath),
    new RegExp(`^\\d{14}_${escapeRegExp(name)}\\.sql$`),
  );

  return createdPath;
}

describe("cli", (): void => {
  let tempDir: string;

  beforeEach((): void => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migratorosaurus-cli-"));
  });

  afterEach((): void => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a migration file with the expected markers", async (): Promise<void> => {
    const output = await runCliInProcess([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
    ]);
    const createdPath = assertCreatedMigrationPath(
      output,
      tempDir,
      "create_person",
    );

    assert.equal(
      fs.readFileSync(createdPath, "utf8"),
      "-- migrate:up\n\n-- migrate:down\n",
    );
  });

  it("prints help text", async (): Promise<void> => {
    const output = await runCliInProcess(["--help"]);

    assert.ok(output.length > 0);
  });

  it("prints create help text", async (): Promise<void> => {
    const output = await runCliInProcess(["create", "--help"]);

    assert.ok(output.length > 0);
  });

  it("prints create help text even when help appears after another flag", async (): Promise<void> => {
    const output = await runCliInProcess(["create", "--name", "--help"]);

    assert.ok(output.length > 0);
  });

  it("prints up help text", async (): Promise<void> => {
    const output = await runCliInProcess(["up", "--help"]);

    assert.ok(output.length > 0);
    assert.match(output, /up to and including target/);
    assert.match(output, /then roll back/);
  });

  it("prints down help text", async (): Promise<void> => {
    const output = await runCliInProcess(["down", "--help"]);

    assert.ok(output.length > 0);
    assert.match(output, /rolls back exactly one migration/);
    assert.match(output, /target migration is excluded from rollback/);
  });

  it("accepts slug migration names", async (): Promise<void> => {
    const output = await runCliInProcess([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person_table2",
    ]);
    const createdPath = assertCreatedMigrationPath(
      output,
      tempDir,
      "create_person_table2",
    );

    assert.ok(fs.existsSync(createdPath));
  });

  it("rejects invalid migration slugs", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          tempDir,
          "--name",
          "Create_Person",
        ]),
      /Invalid migration name: Create_Person/,
    );
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          tempDir,
          "--name",
          "-create_person",
        ]),
      /Invalid migration name: -create_person/,
    );
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          tempDir,
          "--name",
          "create person",
        ]),
      /Invalid migration name: create person/,
    );
  });

  it("rejects missing migration directories", async (): Promise<void> => {
    const missingDir = path.join(tempDir, "missing");

    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          missingDir,
          "--name",
          "create_person",
        ]),
      new RegExp(`Migration directory does not exist: ${missingDir}`),
    );
  });

  it("rejects missing name flag values", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess(["create", "--directory", tempDir, "--name"]),
      /Name flag \(\-\-name, -n\) requires a value/,
    );
  });

  it("rejects missing directory flag values", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> => runCliInProcess(["create", "--directory"]),
      /Directory flag \(\-\-directory, -d\) requires a value/,
    );
  });

  it("creates a timestamped migration without inspecting existing SQL names", async (): Promise<void> => {
    fs.writeFileSync(path.join(tempDir, "000_initial.sql"), "existing\n");
    fs.writeFileSync(path.join(tempDir, "bad name.sql"), "existing\n");

    const output = await runCliInProcess([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
    ]);
    const createdPath = assertCreatedMigrationPath(
      output,
      tempDir,
      "create_person",
    );

    assert.ok(fs.existsSync(createdPath));
  });

  it("uses MIGRATION_DIRECTORY when create --directory is omitted", async (): Promise<void> => {
    const output = await withEnvVars(
      { MIGRATION_DIRECTORY: tempDir },
      (): Promise<string> =>
        runCliInProcess(["create", "--name", "create_person"]),
    );
    const createdPath = assertCreatedMigrationPath(
      output,
      tempDir,
      "create_person",
    );

    assert.ok(fs.existsSync(createdPath));
  });

  it("prefers create --directory over MIGRATION_DIRECTORY", async (): Promise<void> => {
    const explicitDirectory = path.join(tempDir, "explicit");
    fs.mkdirSync(explicitDirectory);

    const output = await withEnvVars(
      { MIGRATION_DIRECTORY: tempDir },
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          explicitDirectory,
          "--name",
          "create_person",
        ]),
    );
    const createdPath = assertCreatedMigrationPath(
      output,
      explicitDirectory,
      "create_person",
    );

    assert.ok(fs.existsSync(createdPath));
  });

  it("rejects path separators in migration names", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          tempDir,
          "--name",
          "../create_person",
        ]),
      /Invalid migration name: \.\.\/create_person/,
    );
  });

  it("rejects removed zero-padding options", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "create",
          "--directory",
          tempDir,
          "--pad-width",
          "3abc",
          "--name",
          "create_person",
        ]),
      /Unknown argument: --pad-width/,
    );
  });

  it("rejects unknown commands", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> => runCliInProcess(["unknown"]),
      /Unknown command: unknown/,
    );
  });

  it("rejects unknown commands even when --help is passed", async (): Promise<void> => {
    const result = await runCliInProcessRaw(["unknown", "--help"]);

    assert.equal(result.status, 1);
    assert.match(stripAnsi(result.stderr), /Unknown command: unknown/);
    assert.equal(result.stdout, "");
  });

  it("rejects command-scoped flags when no command is given", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> => runCliInProcess(["--dry-run"]),
      /Unknown argument: --dry-run/,
    );
    await assert.rejects(
      (): Promise<string> => runCliInProcess(["--name", "x"]),
      /Unknown argument: --name/,
    );
  });

  it("still shows help when --help is passed alongside command-scoped flags without a command", async (): Promise<void> => {
    const output = await runCliInProcess(["--name", "x", "--help"]);

    assert.ok(output.length > 0);
    assert.match(output, /Usage: migratorosaurus/);
  });

  it("rejects up when database URL is missing", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        withoutDatabaseUrl((): Promise<string> => runCliInProcess(["up"])),
      /Database URL is required for up/,
    );
  });

  it("rejects down when database URL is missing", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        withoutDatabaseUrl((): Promise<string> => runCliInProcess(["down"])),
      /Database URL is required for down/,
    );
  });

  it("rejects unknown up flags", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "up",
          "postgres://localhost:5432/example",
          "--unknown",
        ]),
      /Unknown argument: --unknown/,
    );
  });

  it("rejects multiple explicit database URLs", async (): Promise<void> => {
    await assert.rejects(
      (): Promise<string> =>
        runCliInProcess([
          "up",
          "postgres://localhost:5432/one",
          "--url",
          "postgres://localhost:5432/two",
        ]),
      /Database URL provided multiple times/,
    );
  });

  it("strips .sql extension from migration name", async (): Promise<void> => {
    const output = await runCliInProcess([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person.sql",
    ]);
    const createdPath = assertCreatedMigrationPath(
      output,
      tempDir,
      "create_person",
    );

    assert.ok(fs.existsSync(createdPath));
  });

  it("uses MIGRATION_DIRECTORY for up when --directory is omitted", async (): Promise<void> => {
    const missingDirectory = path.join(tempDir, "missing-from-env");

    await assert.rejects(
      (): Promise<string> =>
        withEnvVars(
          { MIGRATION_DIRECTORY: missingDirectory },
          (): Promise<string> =>
            runCliInProcess(["up", "postgres://localhost:5432/example"]),
        ),
      new RegExp(`Migration directory does not exist: ${missingDirectory}`),
    );
  });

  it("prefers up --directory over MIGRATION_DIRECTORY", async (): Promise<void> => {
    const explicitDirectory = path.join(tempDir, "empty-dir");
    const missingDirectory = path.join(tempDir, "missing-from-env");
    fs.mkdirSync(explicitDirectory);

    await assert.rejects(
      (): Promise<string> =>
        withEnvVars(
          { MIGRATION_DIRECTORY: missingDirectory },
          (): Promise<string> =>
            runCliInProcess([
              "up",
              "postgres://localhost:5432/example",
              "--directory",
              explicitDirectory,
            ]),
        ),
      new RegExp(
        `No migration files found in directory: ${escapeRegExp(explicitDirectory)}`,
      ),
    );
  });

  it("uses MIGRATION_DIRECTORY for down when --directory is omitted", async (): Promise<void> => {
    const missingDirectory = path.join(tempDir, "missing-from-env");

    await assert.rejects(
      (): Promise<string> =>
        withEnvVars(
          { MIGRATION_DIRECTORY: missingDirectory },
          (): Promise<string> =>
            runCliInProcess(["down", "postgres://localhost:5432/example"]),
        ),
      new RegExp(`Migration directory does not exist: ${missingDirectory}`),
    );
  });

  it("prefers down --directory over MIGRATION_DIRECTORY", async (): Promise<void> => {
    const explicitDirectory = path.join(tempDir, "empty-dir");
    const missingDirectory = path.join(tempDir, "missing-from-env");
    fs.mkdirSync(explicitDirectory);

    await assert.rejects(
      (): Promise<string> =>
        withEnvVars(
          { MIGRATION_DIRECTORY: missingDirectory },
          (): Promise<string> =>
            runCliInProcess([
              "down",
              "postgres://localhost:5432/example",
              "--directory",
              explicitDirectory,
            ]),
        ),
      new RegExp(
        `No migration files found in directory: ${escapeRegExp(explicitDirectory)}`,
      ),
    );
  });

  it("create help documents generated filename format", async (): Promise<void> => {
    const output = await runCliInProcess(["create", "--help"]);

    assert.match(output, /Creates <YYYYMMDDHHMMSS>_<name>\.sql/);
  });

  it("separates failed up logs to stderr while keeping stdout empty", (): void => {
    const missingDirectory = path.join(tempDir, "missing");
    const result = runCliRaw([
      "up",
      "postgres://localhost:5432/example",
      "--directory",
      missingDirectory,
    ]);

    assert.notEqual(result.status, 0);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /started migration run/);
    assert.match(result.stderr, /migration run aborted/);
    assert.match(
      result.stderr,
      new RegExp(`Migration directory does not exist: ${missingDirectory}`),
    );
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

  it("keeps json stdout clean while sending verbose logs to stderr", async (): Promise<void> => {
    const result = await runCliInProcessRaw([
      "--json",
      "--verbose",
      "create",
      "--directory",
      tempDir,
      "--name",
      "create_person",
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "create");
    assert.match(stripAnsi(result.stderr), /Debug: command=create/);
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
    assert.doesNotMatch(result.stderr, /started migration run/);
    assert.match(result.stderr, /migration run aborted/);
    assert.match(
      result.stderr,
      new RegExp(`Migration directory does not exist: ${missingDirectory}`),
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
    assert.match(stripAnsi(result.stderr), /Debug: command=create/);
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
    assert.match(stripAnsi(result.stderr), /Debug: run=up /);
    assert.doesNotMatch(stripAnsi(result.stderr), /Debug: command=up/);
  });

  it("returns status code 0 for help and non-zero for failures", (): void => {
    const helpResult = runCliRaw(["--help"]);
    const errorResult = runCliRaw(["unknown"]);

    assert.equal(helpResult.status, 0);
    assert.equal(errorResult.status, 1);
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
  });

  it("does not output ANSI color sequences in non-tty mode", (): void => {
    const result = runCliRaw(["unknown"]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.length > 0);
    assert.doesNotMatch(result.stderr, /\u001B\[[0-9;]*m/);
  });
});
