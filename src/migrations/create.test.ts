import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMigration } from "./create.js";

const fixedDate = new Date("2026-04-29T12:34:56.000Z");

function createTempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pg_migrate-create-"));
}

describe("create", (): void => {
  let tempDir: string;

  beforeEach((): void => {
    tempDir = createTempDirectory();
  });

  afterEach((): void => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a timestamped migration file with section markers", (): void => {
    const filePath = createMigration({
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    });

    assert.equal(
      filePath,
      path.join(tempDir, "20260429123456_create_person.sql"),
    );
    assert.equal(
      fs.readFileSync(filePath, "utf8"),
      "-- migrate:up\n\n-- migrate:down\n",
    );
  });

  it("ignores non-canonical SQL filenames while checking versions", (): void => {
    fs.writeFileSync(path.join(tempDir, "000_initial.sql"), "existing\n");
    fs.writeFileSync(path.join(tempDir, "bad name.sql"), "existing\n");

    const filePath = createMigration({
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    });

    assert.equal(
      filePath,
      path.join(tempDir, "20260429123456_create_person.sql"),
    );
  });

  it("rejects two creates in the same second with different names", (): void => {
    createMigration({
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    });

    assert.throws((): void => {
      createMigration({
        clock: (): Date => fixedDate,
        directory: tempDir,
        name: "add_email",
      });
    }, /Migration version already exists: 20260429123456/);
  });

  it("requires a migration name", (): void => {
    assert.throws((): void => {
      createMigration({ directory: tempDir });
    }, /Name flag \(\-\-name, -n\) is required/);
  });

  it("rejects invalid migration names", (): void => {
    assert.throws((): void => {
      createMigration({ directory: tempDir, name: "CreatePerson" });
    }, /Invalid migration name: CreatePerson/);
    assert.throws((): void => {
      createMigration({ directory: tempDir, name: "../create_person" });
    }, /Invalid migration name: \.\.\/create_person/);
  });

  it("creates missing migration directories", (): void => {
    const missingDirectory = path.join(tempDir, "missing", "migrations");

    const filePath = createMigration({
      clock: (): Date => fixedDate,
      directory: missingDirectory,
      name: "create_person",
    });

    assert.equal(
      filePath,
      path.join(missingDirectory, "20260429123456_create_person.sql"),
    );
    assert.equal(fs.statSync(missingDirectory).isDirectory(), true);
  });

  it("rejects migration paths that are not directories", (): void => {
    const filePath = path.join(tempDir, "migrations");
    fs.writeFileSync(filePath, "not a directory\n");

    assert.throws(
      (): void => {
        createMigration({
          directory: filePath,
          name: "create_person",
        });
      },
      new RegExp(`Migration path is not a directory: ${filePath}`),
    );
  });

  it("rejects duplicate migration file creation", (): void => {
    const options = {
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    };

    createMigration(options);

    assert.throws((): void => {
      createMigration(options);
    }, /Migration version already exists: 20260429123456/);
  });
});
