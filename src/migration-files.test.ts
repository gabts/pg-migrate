import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadDiskMigrations,
  materializeSteps,
  parseMigration,
  parseMigrationIndex,
} from "./migration-files.js";

const validMigration = `-- % up-migration % --
CREATE TABLE person (id integer);

-- % down-migration % --
DROP TABLE person;
`;

function withMigrationDirectory(
  files: Record<string, string>,
  test: (directory: string) => void,
): void {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "migratorosaurus-migration-files-"),
  );

  try {
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(directory, file), content);
    }

    test(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("migration-files", (): void => {
  describe("parseMigrationIndex", (): void => {
    it("parses the leading integer from valid migration file names", (): void => {
      assert.equal(parseMigrationIndex("001-create-person.sql"), 1);
      assert.equal(parseMigrationIndex("10.sql"), 10);
      assert.equal(parseMigrationIndex("000-name.with.dots.sql"), 0);
    });

    it("rejects invalid migration file names", (): void => {
      assert.throws((): void => {
        parseMigrationIndex("1.1-create.sql");
      }, /Invalid migration file name: 1\.1-create\.sql/);
      assert.throws((): void => {
        parseMigrationIndex("1-create person's.sql");
      }, /Invalid migration file name: 1-create person's\.sql/);
      assert.throws((): void => {
        parseMigrationIndex("create.sql");
      }, /Invalid migration file name: create\.sql/);
    });
  });

  describe("parseMigration", (): void => {
    it("extracts up and down SQL from a migration file", (): void => {
      assert.equal(
        parseMigration(validMigration, "up", "0-create.sql"),
        "CREATE TABLE person (id integer);",
      );
      assert.equal(
        parseMigration(validMigration, "down", "0-create.sql"),
        "DROP TABLE person;",
      );
    });

    it("rejects missing, duplicated, or reversed migration markers", (): void => {
      assert.throws((): void => {
        parseMigration("CREATE TABLE person (id integer);", "up", "0.sql");
      }, /Invalid migration file contents: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `${validMigration}\n-- % up-migration % --\nSELECT 1;`,
          "up",
          "0.sql",
        );
      }, /Invalid migration file contents: 0\.sql/);
      assert.throws((): void => {
        parseMigration(
          `-- % down-migration % --\nDROP TABLE person;\n-- % up-migration % --\nCREATE TABLE person (id integer);`,
          "up",
          "0.sql",
        );
      }, /Invalid migration file contents: 0\.sql/);
    });

    it("rejects empty up sections", (): void => {
      assert.throws((): void => {
        parseMigration(
          `-- % up-migration % --\n\n-- % down-migration % --\nDROP TABLE person;`,
          "up",
          "0.sql",
        );
      }, /Invalid migration file contents: 0\.sql/);
    });

    it("allows empty down sections for irreversible migrations", (): void => {
      assert.equal(
        parseMigration(
          `-- % up-migration % --\nCREATE TABLE person (id integer);\n-- % down-migration % --\n`,
          "down",
          "0.sql",
        ),
        "",
      );
    });
  });

  describe("materializeSteps", (): void => {
    it("reads migration files and extracts SQL for the given direction", (): void => {
      withMigrationDirectory(
        {
          "0-create.sql": validMigration,
          "1-add-column.sql": validMigration,
        },
        (directory): void => {
          const disk = loadDiskMigrations(directory);

          assert.deepEqual(materializeSteps(disk.all, "up"), [
            {
              file: "0-create.sql",
              index: 0,
              sql: "CREATE TABLE person (id integer);",
            },
            {
              file: "1-add-column.sql",
              index: 1,
              sql: "CREATE TABLE person (id integer);",
            },
          ]);

          assert.deepEqual(materializeSteps(disk.all, "down"), [
            {
              file: "0-create.sql",
              index: 0,
              sql: "DROP TABLE person;",
            },
            {
              file: "1-add-column.sql",
              index: 1,
              sql: "DROP TABLE person;",
            },
          ]);
        },
      );
    });

    it("returns an empty array for an empty plan", (): void => {
      assert.deepEqual(materializeSteps([], "up"), []);
    });

    it("materializes empty down SQL for irreversible migrations", (): void => {
      const irreversibleMigration = `-- % up-migration % --\nINSERT INTO data SELECT generate_series(1, 1000);\n-- % down-migration % --\n`;

      withMigrationDirectory(
        {
          "0-backfill.sql": irreversibleMigration,
        },
        (directory): void => {
          const disk = loadDiskMigrations(directory);

          assert.deepEqual(materializeSteps(disk.all, "down"), [
            { file: "0-backfill.sql", index: 0, sql: "" },
          ]);
        },
      );
    });
  });

  describe("loadDiskMigrations", (): void => {
    it("throws when the migration directory has no SQL files", (): void => {
      withMigrationDirectory({}, (directory): void => {
        assert.throws((): void => {
          loadDiskMigrations(directory);
        }, /No migration files found in directory/);
      });
    });

    it("throws when the migration directory does not exist", (): void => {
      const missingDirectory = path.join(
        os.tmpdir(),
        "migratorosaurus-missing-directory",
      );

      assert.throws((): void => {
        loadDiskMigrations(missingDirectory);
      }, /Migration directory does not exist/);
    });

    it("loads, sorts, and indexes SQL migration files", (): void => {
      withMigrationDirectory(
        {
          "2-second.sql": validMigration,
          "1-first.sql": validMigration,
          "notes.txt": "ignored",
        },
        (directory): void => {
          const disk = loadDiskMigrations(directory);

          assert.deepEqual(
            disk.all.map(
              ({
                file,
                index,
                path: migrationPath,
              }): { file: string; index: number; path: string } => ({
                file,
                index,
                path: migrationPath,
              }),
            ),
            [
              {
                file: "1-first.sql",
                index: 1,
                path: path.join(directory, "1-first.sql"),
              },
              {
                file: "2-second.sql",
                index: 2,
                path: path.join(directory, "2-second.sql"),
              },
            ],
          );
          assert.equal(disk.byFile.get("1-first.sql")?.index, 1);
        },
      );
    });

    it("rejects invalid SQL migration file names", (): void => {
      withMigrationDirectory(
        {
          "1.1-create.sql": validMigration,
        },
        (directory): void => {
          assert.throws((): void => {
            loadDiskMigrations(directory);
          }, /Invalid migration file name: 1\.1-create\.sql/);
        },
      );
    });

    it("rejects duplicate resolved migration indices", (): void => {
      withMigrationDirectory(
        {
          "001-create.sql": validMigration,
          "1-create-again.sql": validMigration,
        },
        (directory): void => {
          assert.throws((): void => {
            loadDiskMigrations(directory);
          }, /Duplicate migration index 1: 001-create\.sql and 1-create-again\.sql/);
        },
      );
    });
  });
});
