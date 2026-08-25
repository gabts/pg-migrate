import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiskMigration, MigrationIndex } from "./files.js";
import type { AppliedMigration } from "./history.js";
import { findMigrationTarget, planDown, planUp } from "./plan.js";

const first: DiskMigration = {
  file: "20260811120000_add_users.sql",
  name: "add_users",
  path: "migrations/20260811120000_add_users.sql",
  version: "20260811120000",
};
const second: DiskMigration = {
  file: "20260811130000_add_posts.sql",
  name: "add_posts",
  path: "migrations/20260811130000_add_posts.sql",
  version: "20260811130000",
};
const third: DiskMigration = {
  file: "20260811140000_add_comments.sql",
  name: "add_comments",
  path: "migrations/20260811140000_add_comments.sql",
  version: "20260811140000",
};
const migrationIndex: MigrationIndex = {
  all: [first, second, third],
  byFile: new Map([
    [first.file, first],
    [second.file, second],
    [third.file, third],
  ]),
  byVersion: new Map([
    [first.version, first],
    [second.version, second],
    [third.version, third],
  ]),
};
const appliedAt = "2026-08-11T12:00:00.000Z";

function applied(...migrations: DiskMigration[]): AppliedMigration[] {
  return migrations.map((migration) => ({
    appliedAt,
    checksum: `${migration.name}-checksum`,
    file: migration.file,
    version: migration.version,
  }));
}

describe("plan", (): void => {
  describe("target", (): void => {
    it("resolves a target by version", (): void => {
      assert.equal(findMigrationTarget(second.version, migrationIndex), second);
    });

    it("resolves a target by filename", (): void => {
      assert.equal(findMigrationTarget(first.file, migrationIndex), first);
    });

    it("rejects an invalid target", (): void => {
      for (const target of ["", "latest", "20260811", "add_users.sql"]) {
        assert.throws(
          () => findMigrationTarget(target, migrationIndex),
          new Error(
            `Invalid migration target '${target}', expected a version or ` +
              "filename.",
          ),
        );
      }
    });

    it("rejects a target that does not exist", (): void => {
      for (const target of ["20260811150000", "20260811150000_add_tags.sql"]) {
        assert.throws(
          () => findMigrationTarget(target, migrationIndex),
          new Error(`Migration target '${target}' does not exist.`),
        );
      }
    });
  });

  describe("up", (): void => {
    it("plans every migration when none are applied", (): void => {
      assert.deepEqual(
        planUp(migrationIndex, applied(), null),
        migrationIndex.all,
      );
    });

    it("plans migrations after the latest applied migration", (): void => {
      assert.deepEqual(planUp(migrationIndex, applied(first), null), [
        second,
        third,
      ]);
    });

    it("includes the target migration", (): void => {
      assert.deepEqual(planUp(migrationIndex, applied(first), second), [
        second,
      ]);
    });

    it("plans nothing when the target is the latest applied", (): void => {
      assert.deepEqual(
        planUp(migrationIndex, applied(first, second), second),
        [],
      );
    });

    it("rejects a target behind the latest applied migration", (): void => {
      assert.throws(
        () => planUp(migrationIndex, applied(first, second), first),
        new Error(
          `Migration target '${first.file}' is behind the latest applied ` +
            `migration '${second.file}'.`,
        ),
      );
    });
  });

  describe("down", (): void => {
    it("plans the latest applied migration without a target", (): void => {
      assert.deepEqual(planDown(migrationIndex, applied(first, second), null), [
        second,
      ]);
    });

    it("plans nothing when no migrations are applied", (): void => {
      assert.deepEqual(planDown(migrationIndex, applied(), null), []);
    });

    it("reverts newer migrations and keeps the target applied", (): void => {
      assert.deepEqual(
        planDown(migrationIndex, applied(first, second, third), first),
        [third, second],
      );
    });

    it("plans nothing when the target is the latest applied", (): void => {
      assert.deepEqual(
        planDown(migrationIndex, applied(first, second), second),
        [],
      );
    });

    it("rejects a target that is not applied", (): void => {
      assert.throws(
        () => planDown(migrationIndex, applied(first), second),
        new Error(`Migration target '${second.file}' is not applied.`),
      );
    });
  });
});
