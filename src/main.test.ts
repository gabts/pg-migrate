import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  migrate,
  repair,
  rollback,
  status,
  validate,
  type LogEvent,
} from "./main.js";

describe("main", (): void => {
  describe("database commands", (): void => {
    let tempDir: string;

    beforeEach(async (): Promise<void> => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
    });

    afterEach(async (): Promise<void> => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("starts filename validation before a duplicate error", async (): Promise<void> => {
      const version = "20260811120000";
      const first = `${version}_add_posts.sql`;
      const second = `${version}_add_users.sql`;
      await fs.writeFile(path.join(tempDir, first), "");
      await fs.writeFile(path.join(tempDir, second), "");
      const events: LogEvent[] = [];

      await assert.rejects(
        rollback({
          directory: tempDir,
          log(event): undefined {
            events.push(event);
          },
          table: "schema_migrations",
          url: "postgres://localhost/example",
        }),
        new Error(
          `Migration version '${version}' is used by '${first}' and ` +
            `'${second}'.`,
        ),
      );
      assert.deepEqual(events, [
        { type: "directory-read-start", directory: tempDir },
        { type: "directory-read-done", directory: tempDir },
        { type: "filenames-validation-start" },
      ]);
    });

    // This test checks the public command connection. The SQL tests check
    // SQL behavior.
    it("validates all migration SQL in validate", async (): Promise<void> => {
      const file = "20260811120000_add_users.sql";
      await fs.writeFile(path.join(tempDir, file), "SELECT 1;\n");
      const events: LogEvent[] = [];

      await assert.rejects(
        validate({
          directory: tempDir,
          log(event): undefined {
            events.push(event);
          },
          table: "schema_migrations",
          url: "postgres://localhost/example",
        }),
        new Error(`Missing 'migrate:up' marker in '${file}'.`),
      );
      assert.deepEqual(events, [
        { type: "directory-read-start", directory: tempDir },
        { type: "directory-read-done", directory: tempDir },
        { type: "filenames-validation-start" },
        { type: "filenames-validation-done", count: 1 },
        { type: "sql-read-start", count: 1 },
        { type: "sql-read-done", count: 1 },
        { type: "sql-validation-start", count: 1 },
      ]);
    });

    it("resolves migration targets before database work", async (): Promise<void> => {
      const file = "20260811120000_add_users.sql";
      await fs.writeFile(
        path.join(tempDir, file),
        "-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 2;\n",
      );
      const target = "20260811130000_missing.sql";
      const options = {
        directory: tempDir,
        table: "schema_migrations",
        target,
        url: "postgres://localhost/example",
      };

      for (const command of [migrate, rollback, repair]) {
        const events: LogEvent[] = [];
        await assert.rejects(
          command({
            ...options,
            log(event): undefined {
              events.push(event);
            },
          }),
          new Error(`Migration target '${target}' does not exist.`),
        );
        assert.deepEqual(events, [
          { type: "directory-read-start", directory: tempDir },
          { type: "directory-read-done", directory: tempDir },
          { type: "filenames-validation-start" },
          { type: "filenames-validation-done", count: 1 },
          { type: "target-resolve-start", target },
        ]);
      }
    });

    it("validates the history table before database work", async (): Promise<void> => {
      const file = "20260811120000_add_users.sql";
      await fs.writeFile(
        path.join(tempDir, file),
        "-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 2;\n",
      );
      const table = "Invalid-Table";
      const options = {
        directory: tempDir,
        table,
        target: "20260811120000",
        url: "postgres://localhost/example",
      };

      for (const command of [status, validate, migrate, rollback, repair]) {
        const events: LogEvent[] = [];
        await assert.rejects(
          command({
            ...options,
            log(event): undefined {
              events.push(event);
            },
          }),
          new Error(`Invalid migration table name '${table}'.`),
        );
        assert.deepEqual(events, []);
      }
    });

    it("rejects an invalid database URL before database work", async (): Promise<void> => {
      for (const command of [status, validate, migrate, rollback, repair]) {
        const events: LogEvent[] = [];

        await assert.rejects(
          command({
            directory: tempDir,
            log(event): undefined {
              events.push(event);
            },
            table: "schema_migrations",
            target: "20260811120000",
            url: "",
          }),
          new Error("Invalid value '' for 'url'."),
        );
        assert.deepEqual(events, []);
      }
    });
  });
});
