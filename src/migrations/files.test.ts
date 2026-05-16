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

const validIrreversibleMigration = `-- migrate:irreversible
INSERT INTO audit_log(message) VALUES ('seeded');
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

    it("accepts marker-only lines with flexible whitespace", (): void => {
      const migration = ` \t--   migrate:up  \r
CREATE TABLE person (id integer);
\t--migrate:down\t
DROP TABLE person;
`;

      assert.equal(
        parseMigration(migration, "up", "0_create.sql"),
        "CREATE TABLE person (id integer);",
      );
      assert.equal(
        parseMigration(migration, "down", "0_create.sql"),
        "DROP TABLE person;",
      );
    });

    it("extracts irreversible SQL as up SQL and empty down SQL", (): void => {
      assert.equal(
        parseMigration(validIrreversibleMigration, "up", "0_seed.sql"),
        "INSERT INTO audit_log(message) VALUES ('seeded');",
      );
      assert.equal(
        parseMigration(validIrreversibleMigration, "down", "0_seed.sql"),
        "",
      );
    });

    it("does not treat marker text inside SQL strings or comments as markers", (): void => {
      const migration = `-- migrate:up
INSERT INTO audit_log(message) VALUES ('-- migrate:down');
INSERT INTO audit_log(message) VALUES ('-- migrate:irreversible');
INSERT INTO audit_log(message) VALUES ('
-- migrate:down
');
INSERT INTO audit_log(message) VALUES (E'it\\'s
-- migrate:down
fine');
DO $body$
BEGIN
  RAISE NOTICE '-- migrate:down';
-- migrate:down
END;
$body$;
/*
-- migrate:down
-- migrate:irreversible
*/
-- marker mention: -- migrate:down
-- migrate:down
SELECT '-- migrate:up';
`;
      const upSql = parseMigration(migration, "up", "0_create.sql");

      assert.match(upSql, /INSERT INTO audit_log/);
      assert.match(upSql, /E'it\\'s/);
      assert.match(upSql, /DO \$body\$/);
      assert.match(
        upSql,
        /\/\*\n-- migrate:down\n-- migrate:irreversible\n\*\//,
      );
      assert.equal(
        parseMigration(migration, "down", "0_create.sql"),
        "SELECT '-- migrate:up';",
      );
    });

    it("rejects missing section markers or duplicated markers", (): void => {
      assert.throws((): void => {
        parseMigration("CREATE TABLE person (id integer);", "up", "0.sql");
      }, /Missing migrate:up or migrate:irreversible marker in migration file: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `${validMigration}\n-- migrate:up\nSELECT 1;`,
          "up",
          "0.sql",
        );
      }, /Duplicate migrate:up marker in migration file: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `${validMigration}\n-- migrate:down\nSELECT 1;`,
          "down",
          "0.sql",
        );
      }, /Duplicate migrate:down marker in migration file: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `${validIrreversibleMigration}\n-- migrate:irreversible\nSELECT 1;`,
          "up",
          "0.sql",
        );
      }, /Duplicate migrate:irreversible marker in migration file: 0\.sql/);
    });

    it("rejects down markers before up markers", (): void => {
      const downBeforeUp = `-- migrate:down
DROP TABLE person;
-- migrate:up
CREATE TABLE person (id integer);
`;

      assert.throws((): void => {
        parseMigration(downBeforeUp, "up", "0_create.sql");
      }, /migrate:up marker must appear before migrate:down marker in migration file: 0_create\.sql/);
    });

    it("rejects empty up sections", (): void => {
      assert.throws((): void => {
        parseMigration(
          `-- migrate:up\n\n-- migrate:down\nDROP TABLE person;`,
          "up",
          "0.sql",
        );
      }, /Empty migrate:up section in migration file: 0\.sql/);
    });

    it("rejects non-comment content before the initial migration marker", (): void => {
      assert.throws((): void => {
        parseMigration(
          `DROP TABLE important_data;\n-- migrate:up\nCREATE TABLE t (id int);\n-- migrate:down\nDROP TABLE t;`,
          "up",
          "0.sql",
        );
      }, /Unexpected content before migration marker in: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `SELECT 1;\n-- migrate:irreversible\nINSERT INTO audit_log(message) VALUES ('seeded');`,
          "up",
          "0.sql",
        );
      }, /Unexpected content before migration marker in: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `SELECT 1;\n-- migrate:down\nDROP TABLE t;\n-- migrate:up\nCREATE TABLE t (id int);`,
          "up",
          "0.sql",
        );
      }, /Unexpected content before migration marker in: 0\.sql/);
    });

    it("allows comments and whitespace before the up marker", (): void => {
      assert.equal(
        parseMigration(
          `-- header comment
-- migrate:custom-tag
/* internal note */

-- migrate:up
CREATE TABLE person (id integer);

-- migrate:down
DROP TABLE person;
`,
          "up",
          "0.sql",
        ),
        "CREATE TABLE person (id integer);",
      );
    });

    it("rejects empty down sections", (): void => {
      assert.throws((): void => {
        parseMigration(
          `-- migrate:up\nCREATE TABLE person (id integer);\n-- migrate:down\n`,
          "down",
          "0.sql",
        );
      }, /Empty migrate:down section in migration file: 0\.sql\. Use migrate:irreversible for forward-only migrations\./);
      assert.throws((): void => {
        parseMigration(
          `-- migrate:up\nCREATE TABLE person (id integer);\n-- migrate:down\n-- explain rollback manually\n`,
          "down",
          "0.sql",
        );
      }, /Empty migrate:down section in migration file: 0\.sql\. Use migrate:irreversible for forward-only migrations\./);
    });

    it("rejects up sections without a down marker", (): void => {
      const upOnlyMigration = `-- migrate:up\nCREATE TABLE person (id integer);\n`;
      assert.throws((): void => {
        parseMigration(upOnlyMigration, "up", "0.sql");
      }, /Missing migrate:down marker in migration file: 0\.sql\. Use migrate:irreversible for forward-only migrations\./);
    });

    it("rejects irreversible markers combined with reversible markers", (): void => {
      assert.throws((): void => {
        parseMigration(
          `-- migrate:irreversible\nSELECT 1;\n-- migrate:down\nSELECT 2;`,
          "up",
          "0.sql",
        );
      }, /migrate:irreversible marker cannot be combined with migrate:up or migrate:down markers in migration file: 0\.sql/);
    });

    it("rejects empty irreversible sections", (): void => {
      assert.throws((): void => {
        parseMigration(`-- migrate:irreversible\n`, "up", "0.sql");
      }, /Empty migrate:irreversible section in migration file: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `-- migrate:irreversible\n-- data loaded elsewhere\n`,
          "up",
          "0.sql",
        );
      }, /Empty migrate:irreversible section in migration file: 0\.sql/);
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

    it("rejects materialization when down marker appears before up marker", async (): Promise<void> => {
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

          await assert.rejects(async (): Promise<void> => {
            await materializeSteps(disk.all, "up");
          }, /migrate:up marker must appear before migrate:down marker in migration file: 20260416090000_create_person\.sql/);
        },
      );
    });

    it("materializes irreversible migrations as empty down SQL", async (): Promise<void> => {
      await withMigrationsDirectory(
        {
          "20260416090000_backfill.sql": validIrreversibleMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          assert.deepEqual(await materializeSteps(disk.all, "up"), [
            {
              file: "20260416090000_backfill.sql",
              sql: "INSERT INTO audit_log(message) VALUES ('seeded');",
            },
          ]);
          assert.deepEqual(await materializeSteps(disk.all, "down"), [
            { file: "20260416090000_backfill.sql", sql: "" },
          ]);
        },
      );
    });

    it("rejects materialization when down marker is omitted", async (): Promise<void> => {
      const upOnlyMigration = `-- migrate:up\nINSERT INTO data SELECT generate_series(1, 1000);\n`;

      await withMigrationsDirectory(
        {
          "20260416090000_backfill.sql": upOnlyMigration,
        },
        async (directory): Promise<void> => {
          const disk = await loadDiskMigrations(directory);

          await assert.rejects(async (): Promise<void> => {
            await materializeSteps(disk.all, "down");
          }, /Missing migrate:down marker in migration file: 20260416090000_backfill\.sql\. Use migrate:irreversible for forward-only migrations\./);
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
