import * as assert from "assert";
import {
  validateAppliedFilesExistOnDisk,
  validateAppliedHistory,
  validateDownPreconditions,
  validateUpPreconditions,
} from "./validation.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

const migrations: DiskMigration[] = [
  { file: "0-create.sql", path: "/migrations/0-create.sql" },
  { file: "1-insert.sql", path: "/migrations/1-insert.sql" },
  { file: "2-alter.sql", path: "/migrations/2-alter.sql" },
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
        validateAppliedHistory([
          { file: "create person's table.sql" },
          { file: "1-insert.sql" },
          { file: "0-create.sql" },
        ]);
      });
    });

    it("rejects invalid applied migration files", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([{ file: "" }]);
      }, /Invalid applied migration file:/);
    });

    it("rejects duplicate applied migration files", (): void => {
      assert.throws((): void => {
        validateAppliedHistory([
          { file: "1-insert.sql" },
          { file: "1-insert.sql" },
        ]);
      }, /Duplicate applied migration file: 1-insert\.sql/);
    });
  });

  describe("validateAppliedFilesExistOnDisk", (): void => {
    it("accepts applied files that exist on disk", (): void => {
      assert.doesNotThrow((): void => {
        validateAppliedFilesExistOnDisk([{ file: "0-create.sql" }], disk);
      });
    });

    it("rejects applied files that are missing on disk", (): void => {
      assert.throws((): void => {
        validateAppliedFilesExistOnDisk([{ file: "9-missing.sql" }], disk);
      }, /Applied migration file is missing on disk: 9-missing\.sql/);
    });
  });

  describe("validateDownPreconditions", (): void => {
    const appliedRows: AppliedRow[] = [
      { file: "2-alter.sql" },
      { file: "1-insert.sql" },
      { file: "0-create.sql" },
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
      }, /No such target file "3-missing\.sql"/);
    });

    it("rejects target files that are not applied", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [{ file: "2-alter.sql" }],
          disk,
          target: "1-insert.sql",
        });
      }, /Target migration is not applied: 1-insert\.sql/);
    });

    it("validates rollback files exist on disk", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [
            { file: "2-alter.sql" },
            { file: "1-missing.sql" },
            { file: "0-create.sql" },
          ],
          disk,
          target: "0-create.sql",
        });
      }, /Applied migration file is missing on disk: 1-missing\.sql/);
    });

    it("validates the latest applied file exists on disk when no target is provided", (): void => {
      assert.throws((): void => {
        validateDownPreconditions({
          appliedRows: [{ file: "9-missing.sql" }],
          disk,
        });
      }, /Applied migration file is missing on disk: 9-missing\.sql/);
    });
  });

  describe("validateUpPreconditions", (): void => {
    it("returns latest applied and target migrations for valid input", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [{ file: "0-create.sql" }],
          disk,
          target: "2-alter.sql",
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
          target: "9-missing.sql",
        });
      }, /No such target file "9-missing\.sql"/);
    });

    it("rejects applied files that are missing on disk", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [{ file: "9-missing.sql" }],
          disk,
        });
      }, /Applied migration file is missing on disk: 9-missing\.sql/);
    });

    it("rejects gaps in applied migration history", (): void => {
      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [{ file: "2-alter.sql" }],
          disk,
        });
      }, /Gap in applied migration history: "0-create\.sql" is not applied, but migrations up to "2-alter\.sql" have been applied/);
    });

    it("rejects non-contiguous applied migrations", (): void => {
      const fourMigrations: DiskMigration[] = [
        ...migrations,
        { file: "3-drop.sql", path: "/migrations/3-drop.sql" },
      ];
      const fourDisk: LoadedMigrations = {
        all: fourMigrations,
        byFile: new Map(
          fourMigrations.map((m): [string, DiskMigration] => [m.file, m]),
        ),
      };

      assert.throws((): void => {
        validateUpPreconditions({
          appliedRows: [{ file: "3-drop.sql" }, { file: "1-insert.sql" }],
          disk: fourDisk,
        });
      }, /Gap in applied migration history: "0-create\.sql" is not applied, but migrations up to "3-drop\.sql" have been applied/);
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
          appliedRows: [{ file: "1-insert.sql" }, { file: "0-create.sql" }],
          disk: diskWithoutGaps,
          target: "0-create.sql",
        });
      }, /Target migration "0-create\.sql" is behind latest applied migration "1-insert\.sql"/);
    });

    it("allows target to equal the latest applied migration", (): void => {
      assert.deepEqual(
        validateUpPreconditions({
          appliedRows: [
            { file: "2-alter.sql" },
            { file: "1-insert.sql" },
            { file: "0-create.sql" },
          ],
          disk,
          target: "2-alter.sql",
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
          appliedRows: [{ file: "2-alter.sql" }],
          disk,
          target: "2-alter.sql",
        });
      }, /Gap in applied migration history/);
    });
  });
});
