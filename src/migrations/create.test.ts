import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createMigration } from "./create.js";

const fixedDate = new Date("2026-04-29T12:34:56.000Z");

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-create-"));
}

describe("create", (): void => {
  let tempDir: string;

  beforeEach(async (): Promise<void> => {
    tempDir = await createTempDirectory();
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates a timestamped migration file with section markers", async (): Promise<void> => {
    const filePath = await createMigration({
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    });

    assert.equal(
      filePath,
      path.join(tempDir, "20260429123456_create_person.sql"),
    );
    assert.equal(
      await fs.readFile(filePath, "utf8"),
      "-- migrate:up\n\n-- migrate:down\n",
    );
  });

  it("ignores non-canonical SQL filenames while checking versions", async (): Promise<void> => {
    await fs.writeFile(path.join(tempDir, "000_initial.sql"), "existing\n");
    await fs.writeFile(path.join(tempDir, "bad name.sql"), "existing\n");

    const filePath = await createMigration({
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    });

    assert.equal(
      filePath,
      path.join(tempDir, "20260429123456_create_person.sql"),
    );
  });

  it("rejects two creates in the same second with different names", async (): Promise<void> => {
    await createMigration({
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    });

    await assert.rejects(async (): Promise<void> => {
      await createMigration({
        clock: (): Date => fixedDate,
        directory: tempDir,
        name: "add_email",
      });
    }, /Migration version already exists: 20260429123456/);
  });

  it("requires a migration name", async (): Promise<void> => {
    await assert.rejects(async (): Promise<void> => {
      await createMigration({ directory: tempDir });
    }, /Name flag \(\-\-name, -n\) is required/);
  });

  it("rejects invalid migration names", async (): Promise<void> => {
    await assert.rejects(async (): Promise<void> => {
      await createMigration({ directory: tempDir, name: "CreatePerson" });
    }, /Invalid migration name: CreatePerson/);
    await assert.rejects(async (): Promise<void> => {
      await createMigration({ directory: tempDir, name: "../create_person" });
    }, /Invalid migration name: \.\.\/create_person/);
  });

  it("creates missing migration directories", async (): Promise<void> => {
    const missingDirectory = path.join(tempDir, "missing", "migrations");

    const filePath = await createMigration({
      clock: (): Date => fixedDate,
      directory: missingDirectory,
      name: "create_person",
    });

    assert.equal(
      filePath,
      path.join(missingDirectory, "20260429123456_create_person.sql"),
    );
    assert.equal((await fs.stat(missingDirectory)).isDirectory(), true);
  });

  it("rejects migration paths that are not directories", async (): Promise<void> => {
    const filePath = path.join(tempDir, "migrations");
    await fs.writeFile(filePath, "not a directory\n");

    await assert.rejects(
      async (): Promise<void> => {
        await createMigration({
          directory: filePath,
          name: "create_person",
        });
      },
      new RegExp(`Migration path is not a directory: ${filePath}`),
    );
  });

  it("rejects duplicate migration file creation", async (): Promise<void> => {
    const options = {
      clock: (): Date => fixedDate,
      directory: tempDir,
      name: "create_person",
    };

    await createMigration(options);

    await assert.rejects(async (): Promise<void> => {
      await createMigration(options);
    }, /Migration version already exists: 20260429123456/);
  });
});
