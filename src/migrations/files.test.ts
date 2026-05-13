import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadDiskMigrations,
  materializeSteps,
  materializeStepsFromSql,
  parseMigration,
  readMigrationSqlByFile,
} from "./files.js";

const validMigration = `-- migrate:up
CREATE TABLE person (id integer);

-- migrate:down
DROP TABLE person;
`;

async function withMigrationsDirectory(
  files: Record<string, string | Buffer>,
  test: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pg_migrate-migration-files-"),
  );

  try {
    for (const [file, content] of Object.entries(files)) {
      await fs.writeFile(path.join(directory, file), content);
    }

    await test(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe("files", (): void => {
  describe("parseMigration", (): void => {
    it("extracts up and down SQL from a migration file", (): void => {
      assert.equal(
        parseMigration(validMigration, "up", "0_create.sql"),
        "CREATE TABLE person (id integer);",
      );
      assert.equal(
        parseMigration(validMigration, "down", "0_create.sql"),
        "DROP TABLE person;",
      );
    });

    it("rejects missing up or duplicated markers", (): void => {
      assert.throws((): void => {
        parseMigration("CREATE TABLE person (id integer);", "up", "0.sql");
      }, /Invalid migration file contents: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `${validMigration}\n-- migrate:up\nSELECT 1;`,
          "up",
          "0.sql",
        );
      }, /Invalid migration file contents: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `${validMigration}\n-- migrate:down\nSELECT 1;`,
          "down",
          "0.sql",
        );
      }, /Invalid migration file contents: 0\.sql/);
    });

    it("extracts up and down SQL when down marker appears before up marker", (): void => {
      const downBeforeUp = `-- migrate:down
DROP TABLE person;
-- migrate:up
CREATE TABLE person (id integer);
`;

      assert.equal(
        parseMigration(downBeforeUp, "up", "0_create.sql"),
        "CREATE TABLE person (id integer);",
      );
      assert.equal(
        parseMigration(downBeforeUp, "down", "0_create.sql"),
        "DROP TABLE person;",
      );
    });

    it("rejects empty up sections", (): void => {
      assert.throws((): void => {
        parseMigration(
          `-- migrate:up\n\n-- migrate:down\nDROP TABLE person;`,
          "up",
          "0.sql",
        );
      }, /Invalid migration file contents: 0\.sql/);
    });

    it("rejects non-comment content before the first marker", (): void => {
      assert.throws((): void => {
        parseMigration(
          `DROP TABLE important_data;\n-- migrate:up\nCREATE TABLE t (id int);\n-- migrate:down\nDROP TABLE t;`,
          "up",
          "0.sql",
        );
      }, /Unexpected content before up marker in: 0\.sql/);
    });

    it("allows comments and whitespace before the up marker", (): void => {
      assert.equal(
        parseMigration(
          `-- header comment
-- migrate:custom-tag
/* internal note */

-- migrate:up
CREATE TABLE person (id integer);
`,
          "up",
          "0.sql",
        ),
        "CREATE TABLE person (id integer);",
      );
    });

    it("allows empty down sections for irreversible migrations", (): void => {
      assert.equal(
        parseMigration(
          `-- migrate:up\nCREATE TABLE person (id integer);\n-- migrate:down\n`,
          "down",
          "0.sql",
        ),
        "",
      );
    });

    it("allows migrations without a down marker", (): void => {
      const upOnlyMigration = `-- migrate:up\nCREATE TABLE person (id integer);\n`;
      assert.equal(
        parseMigration(upOnlyMigration, "up", "0.sql"),
        "CREATE TABLE person (id integer);",
      );
      assert.equal(parseMigration(upOnlyMigration, "down", "0.sql"), "");
    });
  });

  describe("materializeSteps", (): void => {
    it("reads migration files and extracts SQL for the given direction", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_create_person.sql": validMigration,
          "20260416090100_add_column.sql": validMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          assert.deepEqual(await materializeSteps(disk.all, "up"), [
            {
              file: "20260416090000_create_person.sql",
              sql: "CREATE TABLE person (id integer);",
            },
            {
              file: "20260416090100_add_column.sql",
              sql: "CREATE TABLE person (id integer);",
            },
          ]);

          assert.deepEqual(await materializeSteps(disk.all, "down"), [
            {
              file: "20260416090000_create_person.sql",
              sql: "DROP TABLE person;",
            },
            {
              file: "20260416090100_add_column.sql",
              sql: "DROP TABLE person;",
            },
          ]);
        },
      );
    });

    it("returns an empty array for an empty plan", async (): Promise<void> => {
      assert.deepEqual(await materializeSteps([], "up"), []);
    });

    it("throws when a migration file is not valid UTF-8", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_invalid_utf8.sql": Buffer.from([0xc3, 0x28]),
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);
          await assert.rejects(async (): Promise<void> => {
            await materializeSteps(disk.all, "up");
          }, /Migration file is not valid UTF-8: 20260416090000_invalid_utf8\.sql/);
        },
      );
    });

    it("materializes SQL when down marker appears before up marker", async (): Promise<void> => {
      const downBeforeUp = `-- migrate:down
DROP TABLE person;
-- migrate:up
CREATE TABLE person (id integer);
`;

      await withMigrationsDirectory(
        {
          "20260416090000_create_person.sql": downBeforeUp,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          assert.deepEqual(await materializeSteps(disk.all, "up"), [
            {
              file: "20260416090000_create_person.sql",
              sql: "CREATE TABLE person (id integer);",
            },
          ]);
          assert.deepEqual(await materializeSteps(disk.all, "down"), [
            {
              file: "20260416090000_create_person.sql",
              sql: "DROP TABLE person;",
            },
          ]);
        },
      );
    });

    it("materializes empty down SQL for irreversible migrations", async (): Promise<void> => {
      const irreversibleMigration = `-- migrate:up\nINSERT INTO data SELECT generate_series(1, 1000);\n-- migrate:down\n`;

      await withMigrationsDirectory(
        {
          "20260416090000_backfill.sql": irreversibleMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          assert.deepEqual(await materializeSteps(disk.all, "down"), [
            { file: "20260416090000_backfill.sql", sql: "" },
          ]);
        },
      );
    });

    it("materializes empty down SQL when down marker is omitted", async (): Promise<void> => {
      const upOnlyMigration = `-- migrate:up\nINSERT INTO data SELECT generate_series(1, 1000);\n`;

      await withMigrationsDirectory(
        {
          "20260416090000_backfill.sql": upOnlyMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          assert.deepEqual(await materializeSteps(disk.all, "down"), [
            { file: "20260416090000_backfill.sql", sql: "" },
          ]);
        },
      );
    });
  });

  describe("cached materialization", (): void => {
    it("reuses parsed SQL across directions", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_create_person.sql": validMigration,
          "20260416090100_add_column.sql": validMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);
          const sqlByFile = await readMigrationSqlByFile(disk.all);

          assert.deepEqual(materializeStepsFromSql(disk.all, "up", sqlByFile), [
            {
              file: "20260416090000_create_person.sql",
              sql: "CREATE TABLE person (id integer);",
            },
            {
              file: "20260416090100_add_column.sql",
              sql: "CREATE TABLE person (id integer);",
            },
          ]);

          assert.deepEqual(
            materializeStepsFromSql(disk.all, "down", sqlByFile),
            [
              {
                file: "20260416090000_create_person.sql",
                sql: "DROP TABLE person;",
              },
              {
                file: "20260416090100_add_column.sql",
                sql: "DROP TABLE person;",
              },
            ],
          );
        },
      );
    });

    it("throws when cached SQL is missing for a planned file", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_create_person.sql": validMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);
          assert.throws((): void => {
            materializeStepsFromSql(disk.all, "up", new Map());
          }, /Missing parsed migration SQL for file: 20260416090000_create_person\.sql/);
        },
      );
    });
  });

  describe("loadDiskMigrations", (): void => {
    it("throws when the migrations directory has no SQL files", async (): Promise<void> => {
      await withMigrationsDirectory({}, async (directory): Promise<void> => {
        await assert.rejects(async (): Promise<void> => {
          await loadDiskMigrations(directory);
        }, /No migration files found in directory/);
      });
    });

    it("throws when the migrations directory does not exist", async (): Promise<void> => {
      const missingDirectory = path.join(
        os.tmpdir(),
        "pg_migrate-missing-directory",
      );

      await assert.rejects(async (): Promise<void> => {
        await loadDiskMigrations(missingDirectory);
      }, /Migrations directory does not exist/);
    });

    it("loads SQL migration files in version order", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090002_second.sql": validMigration,
          "20260416090001_first.sql": validMigration,
          "20260416090003_third.sql": validMigration,
          "notes.txt": "ignored",
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          assert.deepEqual(
            disk.all.map(
              ({
                file,
                path: migrationPath,
              }): { file: string; path: string } => ({
                file,
                path: migrationPath,
              }),
            ),
            [
              {
                file: "20260416090001_first.sql",
                path: path.join(directory, "20260416090001_first.sql"),
              },
              {
                file: "20260416090002_second.sql",
                path: path.join(directory, "20260416090002_second.sql"),
              },
              {
                file: "20260416090003_third.sql",
                path: path.join(directory, "20260416090003_third.sql"),
              },
            ],
          );
          assert.equal(
            disk.byFile.get("20260416090003_third.sql")?.path,
            path.join(directory, "20260416090003_third.sql"),
          );
        },
      );
    });

    it("rejects invalid migration filenames", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_valid.sql": validMigration,
          "bad name.sql": validMigration,
        },
        async (directory): Promise<void> => {
          await assert.rejects(async (): Promise<void> => {
            await loadDiskMigrations(directory);
          }, /Invalid migration filename: bad name\.sql/);
        },
      );
    });

    it("rejects duplicate migration versions across different files", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_add_users.sql": validMigration,
          "20260416090000_add_roles.sql": validMigration,
        },
        async (directory): Promise<void> => {
          await assert.rejects(async (): Promise<void> => {
            await loadDiskMigrations(directory);
          }, /Duplicate migration version: 20260416090000/);
        },
      );
    });
  });
});
