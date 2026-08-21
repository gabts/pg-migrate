import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMigrationConsistency } from "./consistency.js";
import type { DiskMigration, MigrationIndex } from "./files.js";
import type { AppliedMigration } from "./history.js";
import type { LogEvent } from "./model.js";

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

function applied(version: string): AppliedMigration {
  return { appliedAt, version };
}

describe("consistency", (): void => {
  it("emits validation events", (): void => {
    const events: LogEvent[] = [];

    validateMigrationConsistency(migrationIndex, [], (event) => {
      events.push(event);
    });

    assert.deepEqual(events, [
      { type: "consistency-validation-start" },
      { type: "consistency-validation-done" },
    ]);
  });

  it("accepts continuous applied history", (): void => {
    assert.doesNotThrow(() =>
      validateMigrationConsistency(migrationIndex, [
        applied(second.version),
        applied(first.version),
      ]),
    );
  });

  it("accepts empty applied history", (): void => {
    assert.doesNotThrow(() => validateMigrationConsistency(migrationIndex, []));
  });

  it("rejects a duplicate applied version", (): void => {
    assert.throws(
      () =>
        validateMigrationConsistency(migrationIndex, [
          applied(first.version),
          applied(first.version),
        ]),
      new Error(`Applied migration version '${first.version}' is duplicated.`),
    );
  });

  it("rejects an applied version that is missing on disk", (): void => {
    const version = "20260811150000";

    assert.throws(
      () => validateMigrationConsistency(migrationIndex, [applied(version)]),
      new Error(
        `Applied migration version '${version}' does not exist on disk.`,
      ),
    );
  });

  it("rejects a gap in applied history", (): void => {
    assert.throws(
      () =>
        validateMigrationConsistency(migrationIndex, [
          applied(first.version),
          applied(third.version),
        ]),
      new Error(
        `Migration history has a gap at '${second.file}' before ` +
          `'${third.file}'.`,
      ),
    );
  });
});
