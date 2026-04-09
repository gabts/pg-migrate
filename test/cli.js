const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const cliPath = path.join(__dirname, "..", "bin", "cli.js");

function runCli(args) {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim());
  }

  return result.stdout;
}

describe("cli", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migratorosaurus-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a migration file with the expected markers", () => {
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

  it("prints help text", () => {
    const output = runCli(["--help"]);

    assert.ok(output.length > 0);
  });

  it("prints create help text", () => {
    const output = runCli(["create", "--help"]);

    assert.ok(output.length > 0);
  });

  it("prints create help text even when help appears after another flag", () => {
    const output = runCli(["create", "--name", "--help"]);

    assert.ok(output.length > 0);
  });

  it("rejects migration names with unexpected characters", () => {
    assert.throws(
      () =>
        runCli(["create", "--directory", tempDir, "--name", "create person's"]),
      /Migration name may only use letters, numbers, _ and -/,
    );
  });

  it("accepts migration names that start with a hyphen", () => {
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

  it("rejects missing migration directories", () => {
    const missingDir = path.join(tempDir, "missing");

    assert.throws(
      () =>
        runCli([
          "create",
          "--directory",
          missingDir,
          "--name",
          "create-person",
        ]),
      new RegExp(`Migration directory does not exist: ${missingDir}`),
    );
  });

  it("rejects missing name flag values", () => {
    assert.throws(
      () => runCli(["create", "--directory", tempDir, "--name"]),
      /Name flag \(\-\-name, -n\) requires a value/,
    );
  });

  it("rejects missing directory flag values", () => {
    assert.throws(
      () => runCli(["create", "--directory"]),
      /Directory flag \(\-\-directory, -d\) requires a value/,
    );
  });

  it("creates the next whole-number index after existing files", () => {
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

  it("supports customizing zero-padding width", () => {
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

  it("supports disabling zero-padding", () => {
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

  it("rejects invalid zero-padding widths", () => {
    assert.throws(
      () =>
        runCli([
          "create",
          "--directory",
          tempDir,
          "--pad-width",
          "8",
          "--name",
          "create-person",
        ]),
      /Pad width flag \(\-\-pad-width, -p\) must be an integer from 0 to 7/,
    );
  });

  it("rejects zero-padding widths with trailing characters", () => {
    assert.throws(
      () =>
        runCli([
          "create",
          "--directory",
          tempDir,
          "--pad-width",
          "3abc",
          "--name",
          "create-person",
        ]),
      /Pad width flag \(\-\-pad-width, -p\) must be an integer from 0 to 7/,
    );
  });

  it("rejects unknown commands", () => {
    assert.throws(() => runCli(["unknown"]), /Unknown command: unknown/);
  });
});
