import * as assert from "assert";
import { parseTableName, qualifyTableName } from "./table-name.js";

describe("table-name", (): void => {
  describe("parseTableName", (): void => {
    it("parses unqualified table names", (): void => {
      assert.deepEqual(parseTableName("migration_history"), {
        table: "migration_history",
      });
    });

    it("parses schema-qualified table names", (): void => {
      assert.deepEqual(parseTableName("pgmigrate.migration_history"), {
        schema: "pgmigrate",
        table: "migration_history",
      });
    });

    it("rejects unconventional table names", (): void => {
      for (const tableName of [
        "MigrationHistory",
        "1migration_history",
        "migration-history",
        "migration.history.extra",
        `custom "migration" history`,
      ]) {
        assert.throws(
          (): void => {
            parseTableName(tableName);
          },
          new RegExp(`Invalid migration table name: ${tableName}`),
        );
      }
    });
  });

  describe("qualifyTableName", (): void => {
    it("quotes unqualified table names", (): void => {
      assert.equal(
        qualifyTableName({ table: "migration_history" }),
        '"migration_history"',
      );
    });

    it("quotes and joins schema and table names", (): void => {
      assert.equal(
        qualifyTableName({
          schema: "pgmigrate",
          table: "migration_history",
        }),
        '"pgmigrate"."migration_history"',
      );
    });
  });
});
