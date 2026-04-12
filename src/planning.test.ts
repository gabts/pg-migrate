import * as assert from "assert";
import { planDownExecution, planUpExecution } from "./planning.js";
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

describe("planning", (): void => {
  describe("planUpExecution", (): void => {
    it("plans every disk migration when nothing is applied", (): void => {
      assert.deepEqual(
        planUpExecution({
          disk,
          latestApplied: null,
          targetMigration: null,
        }),
        migrations,
      );
    });

    it("plans only migrations newer than the latest applied migration", (): void => {
      assert.deepEqual(
        planUpExecution({
          disk,
          latestApplied: { file: "0-create.sql", index: 0 },
          targetMigration: null,
        }),
        migrations.slice(1),
      );
    });

    it("stops at the target migration", (): void => {
      assert.deepEqual(
        planUpExecution({
          disk,
          latestApplied: { file: "0-create.sql", index: 0 },
          targetMigration: migrations[1]!,
        }),
        [migrations[1]],
      );
    });
  });

  describe("planDownExecution", (): void => {
    const appliedRows: AppliedRow[] = [
      { file: "2-alter.sql", index: 2 },
      { file: "1-insert.sql", index: 1 },
      { file: "0-create.sql", index: 0 },
    ];

    it("plans the latest applied migration when no target is provided", (): void => {
      assert.deepEqual(
        planDownExecution({
          appliedRows,
          disk,
        }),
        [migrations[2]],
      );
    });

    it("plans nothing when no target is provided and nothing is applied", (): void => {
      assert.deepEqual(
        planDownExecution({
          appliedRows: [],
          disk,
        }),
        [],
      );
    });

    it("plans rollbacks before the target while leaving the target applied", (): void => {
      assert.deepEqual(
        planDownExecution({
          appliedRows,
          disk,
          target: "0-create.sql",
        }),
        [migrations[2], migrations[1]],
      );
    });

    it("rejects target files that do not exist on disk", (): void => {
      assert.throws((): void => {
        planDownExecution({
          appliedRows,
          disk,
          target: "3-missing.sql",
        });
      }, /migratorosaurus: no such target file "3-missing\.sql"/);
    });

    it("rejects target files that are not applied", (): void => {
      assert.throws((): void => {
        planDownExecution({
          appliedRows: [{ file: "2-alter.sql", index: 2 }],
          disk,
          target: "1-insert.sql",
        });
      }, /Target migration is not applied: 1-insert\.sql/);
    });

    it("validates rollback files exist on disk before planning", (): void => {
      assert.throws((): void => {
        planDownExecution({
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
  });
});
