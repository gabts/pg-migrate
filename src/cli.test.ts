import * as assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

interface CliRunResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

function runCliRaw(args: string[]): CliRunResult {
  const cliPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "bin",
    "cli.js",
  );
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

describe("cli process", (): void => {
  let tempDir: string;

  beforeEach((): void => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg_migrate-cli-"));
  });

  afterEach((): void => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
    assert.match(result.stderr, /Migration run started/);
    assert.match(result.stderr, /Migration run aborted/);
    assert.match(
      result.stderr,
      new RegExp(`Migration directory does not exist: ${missingDirectory}`),
    );
  });

  it("returns status code 0 for help and non-zero for failures", (): void => {
    const helpResult = runCliRaw(["--help"]);
    const errorResult = runCliRaw(["unknown"]);

    assert.equal(helpResult.status, 0);
    assert.match(helpResult.stdout, /Usage: pg-migrate/);
    assert.equal(errorResult.status, 1);
  });

  it("does not output ANSI color sequences in non-tty mode", (): void => {
    const result = runCliRaw(["unknown"]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.length > 0);
    assert.doesNotMatch(result.stderr, /\u001B\[[0-9;]*m/);
  });
});
