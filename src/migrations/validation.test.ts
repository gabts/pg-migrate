import * as assert from "assert";
import { getMigrationVersion } from "./naming.js";
import {
  validateAppliedFilesExistOnDisk,
  validateAppliedHistory,
  validateDownPreconditions,
  validateUpPreconditions,
} from "./validation.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

const createFile = "20260416090000_create.sql";
const insertFile = "20260416090100_insert.sql";
const alterFile = "20260416090200_alter.sql";
const dropFile = "20260416090300_drop.sql";
const missingFile = "20260416099999_missing.sql";
const missingBetweenFile = "20260416090150_missing.sql";

function row(file: string, version = getMigrationVersion(file)): AppliedRow {
  return { filename: file, version };
}

const migrations: DiskMigration[] = [
  { file: createFile, path: `/migrations/${createFile}` },
  { file: insertFile, path: `/migrations/${insertFile}` },
  { file: alterFile, path: `/migrations/${alterFile}` },
];

const disk: LoadedMigrations = {
  all: migrations,
  byFile: new Map(
    migrations.map((migration): [string, DiskMigration] => [
      migration.file,
      migration,
    ]),
  ),
};

describe("validation", (): void => {
  describe("validateAppliedHistory", (): void => {
    it("accepts applied migration files", (): void => {
      assert.doesNotThrow((): void => {
        validateAppliedHistory([row(insertFile), row(createFile)]);
      });
    });

    it("rejects invalid applied migration files", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([{ filename: "", version: "20260416090000" }]);
      }, /Invalid applied migration file:/);
    });

    it("rejects duplicate applied migration files", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([row(insertFile), row(insertFile)]);
      }, /Duplicate applied migration file: 20260416090100_insert\.sql/);
    });

    it("rejects duplicate applied migration versions", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([
          row(createFile),
          row(insertFile, getMigrationVersion(createFile)),
        ]);
      }, /Duplicate applied migration version: 20260416090000/);
    });
  });

  describe("validateAppliedFilesExistOnDisk", (): void => {
    it("accepts applied files that exist on disk", (): void => {
      assert.doesNotThrow((): void => {
        validateAppliedFilesExistOnDisk([row(createFile)], disk);
      });
    });

    it("rejects applied files that are missing on disk", (): void => {
      assert.throws((): void => {
        validateAppliedFilesExistOnDisk([row(missingFile)], disk);
      }, /Applied migration file is missing on disk: 20260416099999_missing\.sql/);
    });
  });

  describe("validateDownPreconditions", (): void => {
    const appliedRows: AppliedRow[] = [
      row(alterFile),
      row(insertFile),
      row(createFile),
    ];

    it("returns null target when no target is provided", (): void => {
      assert.deepEqual(
        validateDownPreconditions({
          appliedRows,
          disk,
        }),
        { targetMigration: null },
      );
    });

    it("returns the resolved target migration", (): void => {
      assert.deepEqual(
        validateDownPreconditions({
          appliedRows,
          disk,
          target: createFile,
        }),
        { targetMigration: migrations[0] },
      );
    });

    it("rejects target files that do not exist on disk", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows,
          disk,
          target: missingFile,
        });
      }, /No such target file "20260416099999_missing\.sql"/);
    });

    it("rejects target files that are not applied", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [row(createFile)],
          disk,
          target: insertFile,
        });
      }, /Target migration is not applied: 20260416090100_insert\.sql/);
    });

    it("validates rollback files exist on disk", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [
            row(alterFile),
            row(missingBetweenFile),
            row(createFile),
          ],
          disk,
          target: createFile,
        });
      }, /Applied migration file is missing on disk: 20260416090150_missing\.sql/);
    });

    it("validates the latest applied file exists on disk when no target is provided", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [row(missingFile)],
          disk,
        });
      }, /Applied migration file is missing on disk: 20260416099999_missing\.sql/);
    });

    it("rejects non-contiguous applied migration history", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [row(alterFile), row(createFile)],
          disk,
        });
      }, /Gap in applied migration history: "20260416090100_insert\.sql" is not applied, but migrations up to "20260416090200_alter\.sql" have been applied/);
    });
  });

  describe("validateUpPreconditions", (): void => {
    it("returns latest applied and target migrations for valid input", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [row(createFile)],
          disk,
          target: alterFile,
        }),
        {
          latestAppliedMigration: migrations[0],
          targetMigration: migrations[2],
        },
      );
    });

    it("uses nulls when no migration is applied and no target is provided", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [],
          disk,
        }),
        {
          latestAppliedMigration: null,
          targetMigration: null,
        },
      );
    });

    it("rejects target files that do not exist on disk", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [],
          disk,
          target: missingFile,
        });
      }, /No such target file "20260416099999_missing\.sql"/);
    });

    it("rejects applied files that are missing on disk", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(missingFile)],
          disk,
        });
      }, /Applied migration file is missing on disk: 20260416099999_missing\.sql/);
    });

    it("rejects gaps in applied migration history", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(alterFile)],
          disk,
        });
      }, /Gap in applied migration history: "20260416090000_create\.sql" is not applied, but migrations up to "20260416090200_alter\.sql" have been applied/);
    });

    it("rejects non-contiguous applied migrations", (): void => {
      const fourMigrations: DiskMigration[] = [
        ...migrations,
        { file: dropFile, path: `/migrations/${dropFile}` },
      ];
      const fourDisk: LoadedMigrations = {
        all: fourMigrations,
        byFile: new Map(
          fourMigrations.map((m): [string, DiskMigration] => [m.file, m]),
        ),
      };

      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(dropFile), row(insertFile)],
          disk: fourDisk,
        });
      }, /Gap in applied migration history: "20260416090000_create\.sql" is not applied, but migrations up to "20260416090300_drop\.sql" have been applied/);
    });

    it("rejects targets behind the latest applied migration", (): void => {
      const createMigration = disk.byFile.get(createFile);
      const insertMigration = disk.byFile.get(insertFile);
      assert.ok(createMigration);
      assert.ok(insertMigration);

      const diskWithoutGaps: LoadedMigrations = {
        all: [createMigration, insertMigration],
        byFile: new Map([
          [createMigration.file, createMigration],
          [insertMigration.file, insertMigration],
        ]),
      };

      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(insertFile), row(createFile)],
          disk: diskWithoutGaps,
          target: createFile,
        });
      }, /Target migration "20260416090000_create\.sql" is behind latest applied migration "20260416090100_insert\.sql"/);
    });

    it("allows target to equal the latest applied migration", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [row(alterFile), row(insertFile), row(createFile)],
          disk,
          target: alterFile,
        }),
        {
          latestAppliedMigration: migrations[2],
          targetMigration: migrations[2],
        },
      );
    });

    it("rejects gaps even when target equals the latest applied migration", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(alterFile)],
          disk,
          target: alterFile,
        });
      }, /Gap in applied migration history/);
    });

    it("rejects version mismatches between applied rows and disk files", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(createFile, "20260416090001")],
          disk,
        });
      }, /Applied migration version mismatch for file "20260416090000_create\.sql": expected "20260416090000", got "20260416090001"/);
    });
  });
});
