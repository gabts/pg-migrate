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
    const output = runCli(["--directory", tempDir, "--name", "create-person"]);
    const createdPath = path.join(tempDir, "0-create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.equal(
      fs.readFileSync(createdPath, "utf8"),
      "-- % up-migration % --\n\n-- % down-migration % --\n",
    );
  });

  it("rejects migration names with unexpected characters", () => {
    assert.throws(
      () => runCli(["--directory", tempDir, "--name", "create person's"]),
      /Migration name may only use letters, numbers, _ and -/,
    );
  });

  it("rejects missing migration directories", () => {
    const missingDir = path.join(tempDir, "missing");

    assert.throws(
      () => runCli(["--directory", missingDir, "--name", "create-person"]),
      new RegExp(`Migration directory does not exist: ${missingDir}`),
    );
  });

  it("creates the next whole-number index after existing files", () => {
    fs.writeFileSync(path.join(tempDir, "000-initial.sql"), "existing\n");
    fs.writeFileSync(path.join(tempDir, "2-existing.sql"), "existing\n");

    const output = runCli(["--directory", tempDir, "--name", "create-person"]);
    const createdPath = path.join(tempDir, "3-create-person.sql");

    assert.equal(output, `${createdPath}\n`);
    assert.ok(fs.existsSync(createdPath));
  });
});
