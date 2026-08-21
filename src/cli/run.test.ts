import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { run } from "./run.js";

// Run the built CLI as a subprocess. This permits tests of output streams
// and the process exit code without changes to process globals.
const cliPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bin/cli.js",
);

function runCli(
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number | string; stdout: string; stderr: string }> {
  const childEnv = { ...process.env, ...env };
  // An explicit undefined removes an inherited variable from the test.
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined) {
      delete childEnv[key];
    }
  }
  // execFile rejects when the exit code is not zero. The error contains the
  // exit code and output streams. Convert both results to the same structure.
  // A start failure has an error code such as 'ENOENT'. Do not convert it.
  return promisify(execFile)(process.execPath, [cliPath, ...args], {
    env: childEnv,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number | string; stdout: string; stderr: string }) => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
}

describe("run", (): void => {
  let tempDir: string;

  beforeEach(async (): Promise<void> => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes help to stdout and exits 0", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["help"]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.length > 0);
    assert.ok(stdout.endsWith("\n"));
  });

  it("writes help for a bare invocation", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli([]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.length > 0);
  });

  it("suppresses implicit help in quiet mode", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["--quiet"]);
    assert.equal(code, 0);
    assert.equal(stdout, "");
    assert.equal(stderr, "");
  });

  it("writes command help when named by the help command", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["help", "up"]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.length > 0);
  });

  it("writes explicit help in quiet mode", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["help", "--quiet"]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.length > 0);
  });

  it("writes general help for an unknown help topic", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["help", "bogus"]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.length > 0);
  });

  it("does not read an option value as the help command", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli([
      "--config",
      "help",
      "bogus",
    ]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("Unknown command 'bogus'."));
  });

  it("rejects an unknown option passed to the help command", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["help", "--bogus"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("Unknown option '--bogus'."));
  });

  it("writes command help when the help flag is set", async (): Promise<void> => {
    const { code, stdout } = await runCli(["up", "--help"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("up"));
  });

  it("prefers help over an invocation that would fail to parse", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["up", "--help", "--bogus"]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("up"));
  });

  it("treats '--help' after '--' as a positional, not a help request", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["--", "--help"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("Unknown command '--help'."));
  });

  it("writes the result and completion without detail logs", async (): Promise<void> => {
    const directory = path.join(tempDir, "migrations");
    const { code, stdout, stderr } = await runCli([
      "create",
      "add_users",
      "--directory",
      directory,
    ]);

    assert.equal(code, 0);
    assert.ok(stdout.endsWith("\n"));
    const resultPath = stdout.trimEnd();
    assert.equal(path.dirname(resultPath), directory);
    assert.match(path.basename(resultPath), /^\d{14}_add_users\.sql$/);
    assert.deepEqual(await fs.readdir(directory), [path.basename(resultPath)]);
    assert.equal(
      stderr,
      "Running pg-migrate create...\n" +
        `✔ Created ${resultPath}\n` +
        "  Edit the file, then run `pg-migrate up` to apply it.\n",
    );
  });

  it("writes progress to stderr when verbose is active", async (): Promise<void> => {
    const directory = path.join(tempDir, "migrations");
    const { code, stdout, stderr } = await runCli([
      "create",
      "add_users",
      "--directory",
      directory,
      "--verbose",
    ]);

    assert.equal(code, 0);
    const resultPath = stdout.trimEnd();
    assert.equal(
      stderr,
      "Running pg-migrate create...\n" +
        `Creating migration in '${directory}'...\n` +
        `✔ Created ${resultPath}\n` +
        "  Edit the file, then run `pg-migrate up` to apply it.\n",
    );
  });

  it("suppresses normal output in quiet mode", async (): Promise<void> => {
    const directory = path.join(tempDir, "migrations");
    const { code, stdout, stderr } = await runCli([
      "create",
      "add_users",
      "--directory",
      directory,
      "--quiet",
    ]);

    assert.equal(code, 0);
    assert.equal(stdout, "");
    assert.equal(stderr, "");
    const files = await fs.readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^\d{14}_add_users\.sql$/);
  });

  it("lets quiet take precedence over verbose", async (): Promise<void> => {
    const directory = path.join(tempDir, "migrations");
    const { code, stdout, stderr } = await runCli([
      "create",
      "add_users",
      "--directory",
      directory,
      "--quiet",
      "--verbose",
    ]);

    assert.equal(code, 0);
    assert.equal(stdout, "");
    assert.equal(stderr, "");
  });

  it("writes errors to stderr and exits 1", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli(["bogus"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    // The subprocess stderr is not a TTY. Thus, the mark has no color.
    assert.equal(
      stderr,
      "✖ Error: Unknown command 'bogus'.\n" +
        "  Run `pg-migrate --help` for usage.\n",
    );
  });

  it("rejects options the command does not accept", async (): Promise<void> => {
    const { code, stderr } = await runCli([
      "create",
      "add_users",
      "--url",
      "x",
    ]);
    assert.equal(code, 1);
    assert.ok(stderr.includes("Unknown option '--url'."));
  });

  it("rejects missing required positionals", async (): Promise<void> => {
    const { code, stderr } = await runCli(["create"]);
    assert.equal(code, 1);
    assert.ok(stderr.includes("Missing required argument 'name'."));
    // The hint refers to help for the command that failed.
    assert.ok(stderr.includes("Run `pg-migrate create --help` for usage."));
  });

  it("rejects a missing database URL", async (): Promise<void> => {
    const configPath = path.join(tempDir, ".env");
    await fs.writeFile(configPath, "");

    const { code, stderr } = await runCli(["status", "--config", configPath], {
      PGM_URL: undefined,
    });

    assert.equal(code, 1);
    assert.ok(stderr.includes("Missing required argument 'url'."));
    assert.ok(stderr.includes("Run `pg-migrate status --help` for usage."));
  });

  it("rejects an empty URL instead of using PGM_URL", async (): Promise<void> => {
    const { code, stderr } = await runCli(["status", "--url="], {
      PGM_URL: "postgres://env/db",
    });

    assert.equal(code, 1);
    assert.ok(stderr.includes("Invalid value '' for 'url'."));
  });

  it("omits the help hint for a library error", async (): Promise<void> => {
    const { code, stderr } = await runCli([
      "create",
      "Invalid-Name",
      "--directory",
      tempDir,
    ]);

    assert.equal(code, 1);
    assert.ok(stderr.includes("Invalid migration name 'Invalid-Name'"));
    assert.doesNotMatch(stderr, /--help/);
  });

  it("keeps errors visible in quiet mode", async (): Promise<void> => {
    const { code, stdout, stderr } = await runCli([
      "create",
      "Invalid-Name",
      "--directory",
      tempDir,
      "--quiet",
    ]);

    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^✖ Error: Invalid migration name 'Invalid-Name'/);
    assert.doesNotMatch(stderr, /Running pg-migrate/);
  });

  // bin/cli.js calls run() without await. Thus, run() must fulfill its promise
  // when the invocation fails.
  it("fulfills when the invocation fails", async (): Promise<void> => {
    const previousExitCode = process.exitCode;
    // Discard this failure line. The subprocess test checks its content.
    const write = process.stderr.write;
    process.stderr.write = (): boolean => true;
    try {
      await assert.doesNotReject(run(["node", "pgm", "bogus"], {}));
      assert.equal(process.exitCode, 1);
    } finally {
      process.stderr.write = write;
      process.exitCode = previousExitCode;
    }
  });
});
