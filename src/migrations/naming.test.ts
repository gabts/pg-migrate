import * as assert from "assert";
import {
  assertValidMigrationFilename,
  assertValidMigrationName,
  getMigrationName,
  getMigrationVersion,
  isMigrationFilename,
  isMigrationVersion,
} from "./naming.js";

describe("naming", (): void => {
  describe("assertValidMigrationName", (): void => {
    it("accepts lowercase migration slugs", (): void => {
      assert.doesNotThrow((): void => {
        assertValidMigrationName("create_users_2");
      });
    });

    it("rejects invalid migration slugs", (): void => {
      for (const name of ["", "_create_users", "CreateUsers", "create-users"]) {
        assert.throws((): void => {
          assertValidMigrationName(name);
        }, /Invalid migration name:/);
      }
    });
  });

  describe("assertValidMigrationFilename", (): void => {
    it("accepts canonical migration filenames", (): void => {
      assert.doesNotThrow((): void => {
        assertValidMigrationFilename("20260416090000_create_users_2.sql");
      });
    });

    it("rejects invalid migration filenames", (): void => {
      for (const file of [
        "2026041609000_create_users.sql",
        "20260416090000_create-users.sql",
        "20260416090000_CreateUsers.sql",
        "20260416090000_create_users",
      ]) {
        assert.throws((): void => {
          assertValidMigrationFilename(file);
        }, /Invalid migration filename:/);
      }
    });
  });

  describe("getMigrationVersion", (): void => {
    it("extracts the timestamp version from a migration filename", (): void => {
      assert.equal(
        getMigrationVersion("20260416090000_create_users.sql"),
        "20260416090000",
      );
    });

    it("rejects invalid migration filenames", (): void => {
      assert.throws((): void => {
        getMigrationVersion("create_users.sql");
      }, /Invalid migration filename:/);
    });
  });

  describe("getMigrationName", (): void => {
    it("extracts the slug from a migration filename", (): void => {
      assert.equal(
        getMigrationName("20260416090000_create_users.sql"),
        "create_users",
      );
    });

    it("rejects invalid migration filenames", (): void => {
      assert.throws((): void => {
        getMigrationName("create_users.sql");
      }, /Invalid migration filename:/);
    });
  });

  describe("target format helpers", (): void => {
    it("matches bare migration versions", (): void => {
      assert.equal(isMigrationVersion("20260416090000"), true);
      assert.equal(isMigrationVersion("2026041609000"), false);
      assert.equal(isMigrationVersion("20260416090000_create.sql"), false);
    });

    it("matches canonical migration filenames", (): void => {
      assert.equal(
        isMigrationFilename("20260416090000_create_users.sql"),
        true,
      );
      assert.equal(isMigrationFilename("20260416090000"), false);
      assert.equal(
        isMigrationFilename("20260416090000_create-users.sql"),
        false,
      );
    });
  });
});
