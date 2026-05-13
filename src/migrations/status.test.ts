import * as assert from "node:assert";
import { buildMigrationStatus } from "./status.js";
import type {
  AppliedStatusRow,
  DiskMigration,
  LoadedMigrations,
} from "./types.js";

const createFile = "20260416090000_create_person.sql";
const insertFile = "20260416090100_insert_people.sql";

const migrations: DiskMigration[] = [
  { file: createFile, path: `/migrations/${createFile}` },
  { file: insertFile, path: `/migrations/${insertFile}` },
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

describe("status", (): void => {
  it("builds applied and pending migration status", (): void => {
    const appliedAt = new Date("2026-04-30T10:15:00.000Z");
    const appliedRows: AppliedStatusRow[] = [
      {
        appliedAt,
        version: "20260416090000",
      },
    ];

    const result = buildMigrationStatus({
      appliedRows,
      directory: "migrations",
      disk,
      initialized: true,
      table: "migration_history",
    });

    assert.deepEqual(result.summary, {
      applied: 1,
      pending: 1,
      total: 2,
    });
    assert.equal(result.current?.file, createFile);
    assert.equal(result.current?.appliedAt, "2026-04-30T10:15:00.000Z");
    assert.equal(result.next?.file, insertFile);
    assert.deepEqual(
      result.migrations.map(({ name, state, version }) => ({
        name,
        state,
        version,
      })),
      [
        {
          name: "create_person",
          state: "applied",
          version: "20260416090000",
        },
        {
          name: "insert_people",
          state: "pending",
          version: "20260416090100",
        },
      ],
    );
  });

  it("normalizes parseable string timestamps to ISO", (): void => {
    const result = buildMigrationStatus({
      appliedRows: [
        {
          appliedAt: "2026-04-30 10:15:00+00",
          version: "20260416090000",
        },
      ],
      directory: "migrations",
      disk,
      initialized: true,
      table: "migration_history",
    });

    assert.equal(result.current?.appliedAt, "2026-04-30T10:15:00.000Z");
  });

  it("rejects unparseable string timestamps", (): void => {
    assert.throws((): void => {
      buildMigrationStatus({
        appliedRows: [
          {
            appliedAt: "not a timestamp",
            version: "20260416090000",
          },
        ],
        directory: "migrations",
        disk,
        initialized: true,
        table: "migration_history",
      });
    }, /Invalid applied migration timestamp for file "20260416090000_create_person\.sql": not a timestamp/);
  });

  it("rejects invalid Date timestamps", (): void => {
    assert.throws((): void => {
      buildMigrationStatus({
        appliedRows: [
          {
            appliedAt: new Date("not a timestamp"),
            version: "20260416090000",
          },
        ],
        directory: "migrations",
        disk,
        initialized: true,
        table: "migration_history",
      });
    }, /Invalid applied migration timestamp for file "20260416090000_create_person\.sql": Invalid Date/);
  });

  it("reports uninitialized history as all pending", (): void => {
    const result = buildMigrationStatus({
      appliedRows: [],
      directory: "migrations",
      disk,
      initialized: false,
      table: "migration_history",
    });

    assert.equal(result.initialized, false);
    assert.deepEqual(result.summary, {
      applied: 0,
      pending: 2,
      total: 2,
    });
    assert.equal(result.current, null);
    assert.equal(result.next?.file, createFile);
  });
});
