import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { calculateMigrationChecksum } from "./checksum.js";
import type { DiskMigration } from "./files.js";
import {
  parseMigrationSql,
  readMigrationSql,
  validateMigrationSql,
  type MigrationSource,
} from "./sql.js";

const file = "20260811120000_add_users.sql";
const checksum = "checksum";

function sql(content: string): Map<string, MigrationSource> {
  return new Map([[file, { checksum, sql: content }]]);
}

describe("sql", (): void => {
  let tempDir: string;

  beforeEach(async (): Promise<void> => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads SQL without validating its structure", async (): Promise<void> => {
    const filePath = path.join(tempDir, file);
    const contents = Buffer.from("SELECT 1;\n");
    await fs.writeFile(filePath, contents);
    const migrations: DiskMigration[] = [
      {
        file,
        name: "add_users",
        path: filePath,
        version: "20260811120000",
      },
    ];

    assert.deepEqual(
      await readMigrationSql(migrations),
      new Map([
        [
          file,
          {
            checksum: calculateMigrationChecksum(contents),
            sql: "SELECT 1;\n",
          },
        ],
      ]),
    );
  });

  it("rejects SQL that is not valid UTF-8", async (): Promise<void> => {
    const filePath = path.join(tempDir, file);
    await fs.writeFile(filePath, Buffer.from([0xc3, 0x28]));
    const migrations: DiskMigration[] = [
      {
        file,
        name: "add_users",
        path: filePath,
        version: "20260811120000",
      },
    ];

    await assert.rejects(
      readMigrationSql(migrations),
      new Error(`Migration file '${file}' is not valid UTF-8.`),
    );
  });

  it("validates and parses up and down SQL", (): void => {
    const contents = sql(
      "-- migrate:up\nCREATE TABLE users (id integer);\n" +
        "-- migrate:down\nDROP TABLE users;\n",
    );

    assert.doesNotThrow(() => validateMigrationSql(contents));
    assert.deepEqual(parseMigrationSql(contents).get(file), {
      checksum,
      down: "DROP TABLE users;",
      up: "CREATE TABLE users (id integer);",
    });
  });

  it("allows whitespace before the first marker", (): void => {
    const contents = sql(
      " \t\r\n\r\n -- migrate:up \r\nSELECT 1;\r\n" +
        "\t-- migrate:down\r\nSELECT 2;\r\n",
    );

    validateMigrationSql(contents);
    assert.deepEqual(parseMigrationSql(contents).get(file), {
      checksum,
      down: "SELECT 2;",
      up: "SELECT 1;",
    });
  });

  it("treats section contents as opaque SQL", (): void => {
    const contents = sql(
      "-- migrate:up\n" +
        "SELECT '-- migrate:down';\n" +
        "-- migrate:down\n" +
        "SELECT 'ok';\n",
    );

    validateMigrationSql(contents);
    assert.deepEqual(parseMigrationSql(contents).get(file), {
      checksum,
      down: "SELECT 'ok';",
      up: "SELECT '-- migrate:down';",
    });
  });

  it("rejects exact marker lines inside SQL", (): void => {
    assert.throws(
      () =>
        validateMigrationSql(
          sql(
            "-- migrate:up\n" +
              "SELECT $body$\n-- migrate:down\n$body$;\n" +
              "-- migrate:down\nSELECT 2;\n",
          ),
        ),
      new Error(`Marker 'migrate:down' is duplicated in '${file}'.`),
    );
  });

  it("rejects missing markers", (): void => {
    assert.throws(
      () => validateMigrationSql(sql("SELECT 1;\n")),
      new Error(`Missing 'migrate:up' marker in '${file}'.`),
    );
    assert.throws(
      () => validateMigrationSql(sql("-- migrate:up\nSELECT 1;\n")),
      new Error(`Missing 'migrate:down' marker in '${file}'.`),
    );
  });

  it("rejects duplicate markers", (): void => {
    assert.throws(
      () =>
        validateMigrationSql(
          sql(
            "-- migrate:up\nSELECT 1;\n" +
              "-- migrate:up\nSELECT 2;\n" +
              "-- migrate:down\nSELECT 3;\n",
          ),
        ),
      new Error(`Marker 'migrate:up' is duplicated in '${file}'.`),
    );
  });

  it("rejects a down marker before an up marker", (): void => {
    assert.throws(
      () =>
        validateMigrationSql(
          sql("-- migrate:down\nSELECT 2;\n-- migrate:up\nSELECT 1;\n"),
        ),
      new Error(
        `Marker 'migrate:up' must come before 'migrate:down' in '${file}'.`,
      ),
    );
  });

  it("rejects an empty up section", (): void => {
    assert.throws(
      () =>
        validateMigrationSql(
          sql("-- migrate:up\n\n-- migrate:down\nSELECT 2;\n"),
        ),
      new Error(`Section 'migrate:up' is empty in '${file}'.`),
    );
  });

  it("allows an empty or comment-only down section", (): void => {
    for (const down of ["", "/* No SQL. */\n"]) {
      const contents = sql(
        `-- migrate:up\nSELECT 1;\n-- migrate:down\n${down}`,
      );
      assert.doesNotThrow(() => validateMigrationSql(contents));
    }
  });

  it("rejects content before the first marker", (): void => {
    for (const prefix of ["SELECT 0;\n", "-- migration note\n"]) {
      assert.throws(
        () =>
          validateMigrationSql(
            sql(
              `${prefix}-- migrate:up\nSELECT 1;\n` +
                "-- migrate:down\nSELECT 2;\n",
            ),
          ),
        new Error(
          `Unexpected content before the first migration marker in '${file}'.`,
        ),
      );
    }
  });
});
