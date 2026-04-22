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

function withoutDatabaseUrl<T>(fn: () => T): T {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertCreatedMigrationPath(
  output: string,
  directory: string,
  name: string,
): string {
  const createdPath = output.trim();

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

  it("creates a migration file with the expected markers", (): void => {
    const output = runCli([
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

  it("prints up help text", (): void => {
    const output = runCli(["up", "--help"]);

    assert.ok(output.length > 0);
    assert.match(output, /up to and including target/);
    assert.match(output, /then roll back/);
  });

  it("prints down help text", (): void => {
    const output = runCli(["down", "--help"]);

    assert.ok(output.length > 0);
    assert.match(output, /rolls back exactly one migration/);
    assert.match(output, /target migration is excluded from rollback/);
  });

  it("accepts slug migration names", (): void => {
    const output = runCli([
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

  it("rejects invalid migration slugs", (): void => {
    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name", "Create_Person"]);
    }, /Invalid migration name: Create_Person/);
    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name", "-create_person"]);
    }, /Invalid migration name: -create_person/);
    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name", "create person"]);
    }, /Invalid migration name: create person/);
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
          "create_person",
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

  it("creates a timestamped migration without inspecting existing SQL names", (): void => {
    fs.writeFileSync(path.join(tempDir, "000_initial.sql"), "existing\n");
    fs.writeFileSync(path.join(tempDir, "bad name.sql"), "existing\n");

    const output = runCli([
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

  it("rejects path separators in migration names", (): void => {
    assert.throws((): void => {
      runCli(["create", "--directory", tempDir, "--name", "../create_person"]);
    }, /Invalid migration name: \.\.\/create_person/);
  });

  it("rejects removed zero-padding options", (): void => {
    assert.throws((): void => {
      runCli([
        "create",
        "--directory",
        tempDir,
        "--pad-width",
        "3abc",
        "--name",
        "create_person",
      ]);
    }, /Unknown argument: --pad-width/);
  });

  it("rejects unknown commands", (): void => {
    assert.throws((): void => {
      runCli(["unknown"]);
    }, /Unknown command: unknown/);
  });

  it("rejects up when database URL is missing", (): void => {
    assert.throws((): void => {
      withoutDatabaseUrl((): string => runCli(["up"]));
    }, /Database URL is required for up/);
  });

  it("rejects down when database URL is missing", (): void => {
    assert.throws((): void => {
      withoutDatabaseUrl((): string => runCli(["down"]));
    }, /Database URL is required for down/);
  });

  it("rejects unknown up flags", (): void => {
    assert.throws((): void => {
      runCli(["up", "postgres://localhost:5432/example", "--unknown"]);
    }, /Unknown argument: --unknown/);
  });

  it("rejects multiple explicit database URLs", (): void => {
    assert.throws((): void => {
      runCli([
        "up",
        "postgres://localhost:5432/one",
        "--url",
        "postgres://localhost:5432/two",
      ]);
    }, /Database URL provided multiple times/);
  });

  it("strips .sql extension from migration name", (): void => {
    const output = runCli([
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

  it("create help documents generated filename format", (): void => {
    const output = runCli(["create", "--help"]);

    assert.match(output, /Creates <YYYYMMDDHHMMSS>_<name>\.sql/);
  });
});
