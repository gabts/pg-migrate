import * as assert from "assert";
import { planDownExecution, planUpExecution } from "./planning.js";
import type { AppliedRow, DiskMigration, LoadedMigrations } from "./types.js";

const migrations: DiskMigration[] = [
  { file: "0_create.sql", path: "/migrations/0_create.sql" },
  { file: "1_insert.sql", path: "/migrations/1_insert.sql" },
  { file: "2_alter.sql", path: "/migrations/2_alter.sql" },
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
          latestAppliedMigration: null,
          targetMigration: null,
        }),
        migrations,
      );
    });

    it("plans only migrations newer than the latest applied migration", (): void => {
      assert.deepEqual(
        planUpExecution({
          disk,
          latestAppliedMigration: migrations[0]!,
          targetMigration: null,
        }),
        migrations.slice(1),
      );
    });

    it("stops at the target migration", (): void => {
      assert.deepEqual(
        planUpExecution({
          disk,
          latestAppliedMigration: migrations[0]!,
          targetMigration: migrations[1]!,
        }),
        [migrations[1]],
      );
    });
  });

  describe("planDownExecution", (): void => {
    const appliedRows: AppliedRow[] = [
      { file: "2_alter.sql" },
      { file: "1_insert.sql" },
      { file: "0_create.sql" },
    ];

    it("plans the latest applied migration when no target is provided", (): void => {
      assert.deepEqual(
        planDownExecution({
          appliedRows,
          disk,
          targetMigration: null,
        }),
        [migrations[2]],
      );
    });

    it("plans nothing when no target is provided and nothing is applied", (): void => {
      assert.deepEqual(
        planDownExecution({
          appliedRows: [],
          disk,
          targetMigration: null,
        }),
        [],
      );
    });

    it("plans rollbacks before the target while leaving the target applied", (): void => {
      assert.deepEqual(
        planDownExecution({
          appliedRows,
          disk,
          targetMigration: migrations[0]!,
        }),
        [migrations[2], migrations[1]],
      );
    });

    it("plans nothing when the target migration is not applied", (): void => {
      const unappliedMigration: DiskMigration = {
        file: "3_drop.sql",
        path: "/migrations/3_drop.sql",
      };
      const diskWithUnappliedMigration: LoadedMigrations = {
        all: [...migrations, unappliedMigration],
        byFile: new Map([
          ...disk.byFile,
          [unappliedMigration.file, unappliedMigration],
        ]),
      };

      assert.deepEqual(
        planDownExecution({
          appliedRows,
          disk: diskWithUnappliedMigration,
          targetMigration: unappliedMigration,
        }),
        [],
      );
    });
  });
});
