import * as assert from "assert";
import { getMigrationVersion } from "./naming.js";
import {
  resolveTargetMigration,
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

  describe("resolveTargetMigration", (): void => {
    it("resolves targets by migration version", (): void => {
      assert.equal(
        resolveTargetMigration("20260416090100", disk),
        migrations[1],
      );
    });

    it("resolves targets by migration filename", (): void => {
      assert.equal(resolveTargetMigration(insertFile, disk), migrations[1]);
    });

    it("rejects invalid target formats", (): void => {
      for (const target of [
        "",
        "insert",
        "20260416090100-insert.sql",
        "20260416090100_Insert.sql",
      ]) {
        assert.throws(
          (): void => {
            resolveTargetMigration(target, disk);
          },
          new RegExp(`Invalid target "${target}"`),
        );
      }
    });

    it("rejects missing target versions", (): void => {
      assert.throws((): void => {
        resolveTargetMigration("20260416099999", disk);
      }, /No migration found for target version "20260416099999"/);
    });

    it("rejects missing target files", (): void => {
      assert.throws((): void => {
        resolveTargetMigration(missingFile, disk);
      }, /No migration found for target file "20260416099999_missing\.sql"/);
    });
  });

  describe("validateDownPreconditions", (): void => {
    const appliedRows: AppliedRow[] = [
      row(alterFile),
      row(insertFile),
      row(createFile),
    ];

    it("accepts missing targets", (): void => {
      assert.doesNotThrow((): void => {
        validateDownPreconditions({
          appliedRows,
          disk,
        });
      });
    });

    it("accepts applied target migrations", (): void => {
      assert.doesNotThrow((): void => {
        validateDownPreconditions({
          appliedRows,
          disk,
          targetMigration: migrations[0],
        });
      });
    });

    it("rejects target migrations that are not applied", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [row(createFile)],
          disk,
          targetMigration: migrations[1],
        });
      }, /Target migration is not applied: 20260416090100_insert\.sql/);
    });

    it("rejects target migrations that are not loaded from disk", (): void => {
      const copiedInsertMigration: DiskMigration = {
        file: insertFile,
        path: `/migrations/${insertFile}`,
      };

      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows,
          disk,
          targetMigration: copiedInsertMigration,
        });
      }, /Target migration object does not belong to the loaded disk set: 20260416090100_insert\.sql/);
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
          targetMigration: migrations[0],
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
    it("returns latest applied migration for valid input", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [row(createFile)],
          disk,
          targetMigration: migrations[2],
        }),
        {
          latestAppliedMigration: migrations[0],
        },
      );
    });

    it("accepts target migrations resolved by version", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [row(createFile)],
          disk,
          targetMigration: resolveTargetMigration("20260416090200", disk),
        }),
        {
          latestAppliedMigration: migrations[0],
        },
      );
    });

    it("uses null when no migration is applied", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [],
          disk,
        }),
        {
          latestAppliedMigration: null,
        },
      );
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
          targetMigration: createMigration,
        });
      }, /Target migration "20260416090000_create\.sql" is behind latest applied migration "20260416090100_insert\.sql"/);
    });

    it("rejects target migrations that are not loaded from disk", (): void => {
      const copiedAlterMigration: DiskMigration = {
        file: alterFile,
        path: `/migrations/${alterFile}`,
      };

      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(createFile)],
          disk,
          targetMigration: copiedAlterMigration,
        });
      }, /Target migration object does not belong to the loaded disk set: 20260416090200_alter\.sql/);
    });

    it("allows target to equal the latest applied migration", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [row(alterFile), row(insertFile), row(createFile)],
          disk,
          targetMigration: migrations[2],
        }),
        {
          latestAppliedMigration: migrations[2],
        },
      );
    });

    it("rejects gaps even when target equals the latest applied migration", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [row(alterFile)],
          disk,
          targetMigration: migrations[2],
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
