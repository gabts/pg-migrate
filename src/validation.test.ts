import * as assert from "assert";
import {
  validateAppliedFilesExistOnDisk,
  validateAppliedHistory,
  validateDownPreconditions,
  validateUpPreconditions,
} from "./validation.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

const migrations: DiskMigration[] = [
  { file: "0-create.sql", index: 0, path: "/migrations/0-create.sql" },
  { file: "1-insert.sql", index: 1, path: "/migrations/1-insert.sql" },
  { file: "2-alter.sql", index: 2, path: "/migrations/2-alter.sql" },
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
    it("accepts a strictly descending applied migration history", (): void => {
      assert.doesNotThrow((): void => {
        validateAppliedHistory([
          { file: "2-alter.sql", index: 2 },
          { file: "1-insert.sql", index: 1 },
          { file: "0-create.sql", index: 0 },
        ]);
      });
    });

    it("rejects invalid applied migration indices", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([{ file: "1-insert.sql", index: 1.5 }]);
      }, /Invalid applied migration index for 1-insert\.sql: 1\.5/);
    });

    it("rejects invalid applied migration file names", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([{ file: "1-insert person's.sql", index: 1 }]);
      }, /Invalid applied migration file name: 1-insert person's\.sql/);
    });

    it("rejects applied migration index mismatches", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([{ file: "2-alter.sql", index: 1 }]);
      }, /Applied migration index mismatch for 2-alter\.sql: expected 2, found 1/);
    });

    it("rejects duplicate applied migration files and indices", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([
          { file: "1-insert.sql", index: 1 },
          { file: "1-insert.sql", index: 1 },
        ]);
      }, /Duplicate applied migration file: 1-insert\.sql/);
      assert.throws((): void => {
        validateAppliedHistory([
          { file: "001-create.sql", index: 1 },
          { file: "1-insert.sql", index: 1 },
        ]);
      }, /Duplicate applied migration index: 1/);
    });

    it("rejects histories that are not strictly descending", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([
          { file: "0-create.sql", index: 0 },
          { file: "1-insert.sql", index: 1 },
        ]);
      }, /Applied migration history is not strictly descending/);
    });
  });

  describe("validateAppliedFilesExistOnDisk", (): void => {
    it("accepts applied files that exist on disk", (): void => {
      assert.doesNotThrow((): void => {
        validateAppliedFilesExistOnDisk(
          [{ file: "0-create.sql", index: 0 }],
          disk,
        );
      });
    });

    it("rejects applied files that are missing on disk", (): void => {
      assert.throws((): void => {
        validateAppliedFilesExistOnDisk(
          [{ file: "9-missing.sql", index: 9 }],
          disk,
        );
      }, /Applied migration file is missing on disk: 9-missing\.sql/);
    });
  });

  describe("validateDownPreconditions", (): void => {
    const appliedRows: AppliedRow[] = [
      { file: "2-alter.sql", index: 2 },
      { file: "1-insert.sql", index: 1 },
      { file: "0-create.sql", index: 0 },
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
          target: "0-create.sql",
        }),
        { targetMigration: migrations[0] },
      );
    });

    it("rejects target files that do not exist on disk", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows,
          disk,
          target: "3-missing.sql",
        });
      }, /migratorosaurus: no such target file "3-missing\.sql"/);
    });

    it("rejects target files that are not applied", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [{ file: "2-alter.sql", index: 2 }],
          disk,
          target: "1-insert.sql",
        });
      }, /Target migration is not applied: 1-insert\.sql/);
    });

    it("validates rollback files exist on disk", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [
            { file: "2-alter.sql", index: 2 },
            { file: "1-missing.sql", index: 1 },
            { file: "0-create.sql", index: 0 },
          ],
          disk,
          target: "0-create.sql",
        });
      }, /Applied migration file is missing on disk: 1-missing\.sql/);
    });

    it("validates the latest applied file exists on disk when no target is provided", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [{ file: "9-missing.sql", index: 9 }],
          disk,
        });
      }, /Applied migration file is missing on disk: 9-missing\.sql/);
    });
  });

  describe("validateUpPreconditions", (): void => {
    it("returns latest applied and target migrations for valid input", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [{ file: "0-create.sql", index: 0 }],
          disk,
          target: "2-alter.sql",
        }),
        {
          latestApplied: { file: "0-create.sql", index: 0 },
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
          latestApplied: null,
          targetMigration: null,
        },
      );
    });

    it("rejects target files that do not exist on disk", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [],
          disk,
          target: "9-missing.sql",
        });
      }, /migratorosaurus: no such target file "9-missing\.sql"/);
    });

    it("rejects applied files that are missing on disk", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [{ file: "9-missing.sql", index: 9 }],
          disk,
        });
      }, /Applied migration file is missing on disk: 9-missing\.sql/);
    });

    it("rejects unapplied disk migrations at or below the latest applied index", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [{ file: "2-alter.sql", index: 2 }],
          disk,
        });
      }, /Out-of-order migration file "0-create\.sql" has index 0, which is not above latest applied index 2/);
    });

    it("rejects targets behind the latest applied migration", (): void => {
      const createMigration = disk.byFile.get("0-create.sql");
      const insertMigration = disk.byFile.get("1-insert.sql");
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
          appliedRows: [
            { file: "1-insert.sql", index: 1 },
            { file: "0-create.sql", index: 0 },
          ],
          disk: diskWithoutGaps,
          target: "0-create.sql",
        });
      }, /Target migration "0-create\.sql" is behind latest applied migration "1-insert\.sql"/);
    });

    it("allows target to equal the latest applied migration", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [{ file: "2-alter.sql", index: 2 }],
          disk,
          target: "2-alter.sql",
        }),
        {
          latestApplied: { file: "2-alter.sql", index: 2 },
          targetMigration: migrations[2],
        },
      );
    });
  });
});
