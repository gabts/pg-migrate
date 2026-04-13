import { spawnSync } from "child_process";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const cliPath = path.join(__dirname, "..", "bin", "cli.js");

function runCli(args: string[]): string {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim());
  }

  return result.stdout;
}

describe("cli", (): void => {
  let tempDir: string;

  beforeEach((): void => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migratorosaurus-cli-"));
  });

  afterEach((): void => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a migration file with the expected markers", (): void => {
    const output = runCli([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create-person",
    ]);
    const createdPath = path.join(tempDir, "001-create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.equal(
      fs.readFileSync(createdPath, "utf8"),
      "-- % up-migration % --\n\n-- % down-migration % --\n",
    );
  });

  it("prints help text", (): void => {
    const output = runCli(["--help"]);

    assert.ok(output.length > 0);
  });

  it("prints create help text", (): void => {
    const output = runCli(["create", "--help"]);

    assert.ok(output.length > 0);
  });

  it("prints create help text even when help appears after another flag", (): void => {
    const output = runCli(["create", "--name", "--help"]);

    assert.ok(output.length > 0);
  });

  it("rejects migration names with unexpected characters", (): void => {
    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name", "create person's"]);
    }, /Migration name may only use letters, numbers, _ and -/);
  });

  it("accepts migration names that start with a hyphen", (): void => {
    const output = runCli([
      "create",
      "--directory",
      tempDir,
      "--name",
      "-create-person",
    ]);
    const createdPath = path.join(tempDir, "001--create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.ok(fs.existsSync(createdPath));
  });

  it("rejects missing migration directories", (): void => {
    const missingDir = path.join(tempDir, "missing");

    assert.throws(
      (): void => {
        runCli([
          "create",
          "--directory",
          missingDir,
          "--name",
          "create-person",
        ]);
      },
      new RegExp(`Migration directory does not exist: ${missingDir}`),
    );
  });

  it("rejects missing name flag values", (): void => {
    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name"]);
    }, /Name flag \(\-\-name, -n\) requires a value/);
  });

  it("rejects missing directory flag values", (): void => {
    assert.throws((): void => {
      runCli(["create", "--directory"]);
    }, /Directory flag \(\-\-directory, -d\) requires a value/);
  });

  it("creates the next whole-number index after existing files", (): void => {
    fs.writeFileSync(path.join(tempDir, "000-initial.sql"), "existing\n");
    fs.writeFileSync(path.join(tempDir, "2-existing.sql"), "existing\n");

    const output = runCli([
      "create",
      "--directory",
      tempDir,
      "--name",
      "create-person",
    ]);
    const createdPath = path.join(tempDir, "003-create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.ok(fs.existsSync(createdPath));
  });

  it("rejects next index beyond PostgreSQL integer range", (): void => {
    fs.writeFileSync(
      path.join(tempDir, "2147483647-at-limit.sql"),
      "existing\n",
    );

    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name", "overflow"]);
    }, /exceeds PostgreSQL integer range/);
  });

  it("supports customizing zero-padding width", (): void => {
    const output = runCli([
      "create",
      "--directory",
      tempDir,
      "--pad-width",
      "5",
      "--name",
      "create-person",
    ]);
    const createdPath = path.join(tempDir, "00001-create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.ok(fs.existsSync(createdPath));
  });

  it("supports disabling zero-padding", (): void => {
    fs.writeFileSync(path.join(tempDir, "000-initial.sql"), "existing\n");

    const output = runCli([
      "create",
      "--directory",
      tempDir,
      "--pad-width",
      "0",
      "--name",
      "create-person",
    ]);
    const createdPath = path.join(tempDir, "1-create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.ok(fs.existsSync(createdPath));
  });

  it("rejects invalid zero-padding widths", (): void => {
    assert.throws((): void => {
      runCli([
        "create",
        "--directory",
        tempDir,
        "--pad-width",
        "8",
        "--name",
        "create-person",
      ]);
    }, /Pad width flag \(\-\-pad-width, -p\) must be an integer from 0 to 7/);
  });

  it("rejects zero-padding widths with trailing characters", (): void => {
    assert.throws((): void => {
      runCli([
        "create",
        "--directory",
        tempDir,
        "--pad-width",
        "3abc",
        "--name",
        "create-person",
      ]);
    }, /Pad width flag \(\-\-pad-width, -p\) must be an integer from 0 to 7/);
  });

  it("rejects unknown commands", (): void => {
    assert.throws((): void => {
      runCli(["unknown"]);
    }, /Unknown command: unknown/);
  });
});
