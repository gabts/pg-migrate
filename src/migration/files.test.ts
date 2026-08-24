import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buildMigrationIndex,
  getMigrationVersion,
  isMigrationFilename,
  isMigrationVersion,
  readMigrationDirectory,
  validateMigrationFilenames,
  validateMigrationName,
} from "./files.js";

describe("files", (): void => {
  let tempDir: string;

  beforeEach(async (): Promise<void> => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("migration names", (): void => {
    it("accepts lowercase slugs", (): void => {
      validateMigrationName("create_users");
      validateMigrationName("a");
      validateMigrationName("v2_add_index");
    });

    it("rejects invalid names", (): void => {
      for (const name of [
        "",
        "Create",
        "add-index",
        "_leading",
        "has space",
        "café",
      ]) {
        assert.throws(
          () => validateMigrationName(name),
          new Error(
            `Invalid migration name '${name}', expected lowercase ` +
              `letters, numbers, and underscores.`,
          ),
        );
      }
    });
  });

  describe("migration versions", (): void => {
    it("matches canonical versions", (): void => {
      assert.equal(isMigrationVersion("20240101120000"), true);
    });

    it("rejects other values", (): void => {
      for (const value of [
        "2024010112000",
        "202401011200000",
        "2024010112000a",
        "20240101120000_create_users.sql",
      ]) {
        assert.equal(isMigrationVersion(value), false);
      }
    });
  });

  describe("migration filenames", (): void => {
    it("matches canonical filenames", (): void => {
      assert.equal(
        isMigrationFilename("20240101120000_create_users.sql"),
        true,
      );
    });

    it("rejects other filenames", (): void => {
      for (const value of [
        "20240101120000_create_users.txt",
        "2024_create_users.sql",
        "20240101120000-create-users.sql",
        "20240101120000_.sql",
        "create_users.sql",
        ".20240101120000.lock",
      ]) {
        assert.equal(isMigrationFilename(value), false);
      }
    });

    it("extracts the migration version", (): void => {
      assert.equal(
        getMigrationVersion("20240101120000_create_users.sql"),
        "20240101120000",
      );
    });
  });

  it("rejects a missing migration directory while reading", async (): Promise<void> => {
    const directory = path.join(tempDir, "missing");

    await assert.rejects(
      readMigrationDirectory(directory),
      new Error(`Migration path '${directory}' is not a directory.`),
    );
  });

  it("reads entries without validating their names", async (): Promise<void> => {
    const file = "invalid name.sql";
    await fs.writeFile(path.join(tempDir, file), "");

    assert.deepEqual(await readMigrationDirectory(tempDir), [
      { isFile: true, name: file },
    ]);
  });

  it("accepts a directory without migration files during validation", (): void => {
    assert.doesNotThrow(() =>
      validateMigrationFilenames(tempDir, [
        { isFile: true, name: "notes.txt" },
      ]),
    );
  });

  it("rejects an invalid SQL filename during validation", (): void => {
    const file = "create_users.sql";

    assert.throws(
      () => validateMigrationFilenames(tempDir, [{ isFile: true, name: file }]),
      new Error(`Invalid migration filename '${file}'.`),
    );
  });

  it("rejects a migration entry that is not a file", (): void => {
    const file = "20240101120000_create_users.sql";

    assert.throws(
      () =>
        validateMigrationFilenames(tempDir, [{ isFile: false, name: file }]),
      new Error(`Migration path '${path.join(tempDir, file)}' is not a file.`),
    );
  });

  it("rejects duplicate migration versions", (): void => {
    const postsFile = "20240101120000_create_posts.sql";
    const usersFile = "20240101120000_create_users.sql";

    assert.throws(
      () =>
        validateMigrationFilenames(tempDir, [
          { isFile: true, name: usersFile },
          { isFile: true, name: postsFile },
        ]),
      new Error(
        "Migration version '20240101120000' is used by " +
          `'${postsFile}' and '${usersFile}'.`,
      ),
    );
  });

  it("builds migrations in version order", (): void => {
    const firstFile = "20240101120000_create_users.sql";
    const secondFile = "20240202120000_add_posts.sql";
    const result = buildMigrationIndex(tempDir, [
      { isFile: true, name: secondFile },
      { isFile: true, name: "notes.txt" },
      { isFile: true, name: firstFile },
    ]);

    assert.deepEqual(result.all, [
      {
        file: firstFile,
        name: "create_users",
        path: path.join(tempDir, firstFile),
        version: "20240101120000",
      },
      {
        file: secondFile,
        name: "add_posts",
        path: path.join(tempDir, secondFile),
        version: "20240202120000",
      },
    ]);
    assert.equal(result.byFile.get(firstFile), result.all[0]);
    assert.equal(result.byVersion.get("20240202120000"), result.all[1]);
  });
});
