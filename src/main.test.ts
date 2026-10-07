import * as assert from "node:assert/strict";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { migrate, rollback, status, validate, type LogEvent } from "./main.js";

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

      for (const command of [migrate, rollback]) {
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
        url: "postgres://localhost/example",
      };

      for (const command of [status, validate, migrate, rollback]) {
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

    it("rejects an empty database URL before database work", async (): Promise<void> => {
      for (const command of [status, validate, migrate, rollback]) {
        const events: LogEvent[] = [];

        await assert.rejects(
          command({
            directory: tempDir,
            log(event): undefined {
              events.push(event);
            },
            table: "schema_migrations",
            url: "",
          }),
          new Error("Invalid value '' for 'url'."),
        );
        assert.deepEqual(events, []);
      }
    });

    it("rejects an omitted database URL before database work", async (): Promise<void> => {
      for (const command of [status, validate, migrate, rollback]) {
        const events: LogEvent[] = [];
        const options = {
          directory: tempDir,
          log(event: LogEvent): undefined {
            events.push(event);
          },
          table: "schema_migrations",
        } as Parameters<typeof command>[0];

        await assert.rejects(
          command(options),
          new Error("Invalid value 'undefined' for 'url'."),
        );
        assert.deepEqual(events, []);
      }
    });

    it("rejects invalid database URL types before database work", async (): Promise<void> => {
      for (const command of [status, validate, migrate, rollback]) {
        const events: LogEvent[] = [];
        const options = {
          directory: tempDir,
          log(event: LogEvent): undefined {
            events.push(event);
          },
          table: "schema_migrations",
          url: 42,
        } as unknown as Parameters<typeof command>[0];

        await assert.rejects(
          command(options),
          new Error("Invalid value '42' for 'url'."),
        );
        assert.deepEqual(events, []);
      }
    });

    it("rejects a white-space database URL before database work", async (): Promise<void> => {
      for (const command of [status, validate, migrate, rollback]) {
        const events: LogEvent[] = [];

        await assert.rejects(
          command({
            directory: tempDir,
            log(event): undefined {
              events.push(event);
            },
            table: "schema_migrations",
            url: " ",
          }),
          new Error("Invalid value ' ' for 'url'."),
        );
        assert.deepEqual(events, []);
      }
    });

    it("rejects a malformed database URL before database work", async (): Promise<void> => {
      for (const command of [status, validate, migrate, rollback]) {
        const events: LogEvent[] = [];

        await assert.rejects(
          command({
            directory: tempDir,
            log(event): undefined {
              events.push(event);
            },
            table: "schema_migrations",
            url: "postgres://user:secret@[localhost/app",
          }),
          new Error("Database URL is not a valid URL."),
        );
        assert.deepEqual(events, []);
      }
      // pg decodes percent-encoding itself, which throws a URIError.
      await assert.rejects(
        status({
          directory: tempDir,
          table: "schema_migrations",
          url: "postgres://user:%C3%28@localhost/app",
        }),
        new Error("Database URL is not a valid URL."),
      );
    });

    it("keeps the cause when pg cannot apply a database URL setting", async (): Promise<void> => {
      const certificate = path.join(tempDir, "missing.pem");

      await assert.rejects(
        status({
          directory: tempDir,
          table: "schema_migrations",
          url: `postgres://localhost/example?sslrootcert=${certificate}`,
        }),
        (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Failed to apply database URL settings.");
          assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
          return true;
        },
      );
    });

    it("identifies the database in connection errors", async (): Promise<void> => {
      // Nothing listens on port 1, so the connection is refused at once.
      await assert.rejects(
        status({
          directory: tempDir,
          table: "schema_migrations",
          url: "postgres://127.0.0.1:1/example",
        }),
        (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            "Failed to connect to database 'example' at '127.0.0.1:1'.",
          );
          assert.equal(
            (error.cause as NodeJS.ErrnoException).code,
            "ECONNREFUSED",
          );
          return true;
        },
      );
    });

    it("closes the connection when authentication fails in the client", async (): Promise<void> => {
      let socketClosed: Promise<unknown> | undefined;
      let keptOpen = false;
      // The server offers only an unknown SASL mechanism. pg rejects it on
      // the client side, which leaves the socket open unless it is ended.
      const server = net.createServer((socket): void => {
        socketClosed = once(socket, "close");
        // Close the socket from this side if the client keeps it open, so
        // the test fails instead of hanging.
        const timer = setTimeout((): void => {
          keptOpen = true;
          socket.destroy();
        }, 1000);
        socket.once("close", (): void => clearTimeout(timer));
        socket.once("data", (): void => {
          const mechanisms = Buffer.from("UNKNOWN\0\0");
          const header = Buffer.alloc(9);
          header.write("R");
          header.writeInt32BE(8 + mechanisms.length, 1);
          header.writeInt32BE(10, 5);
          socket.write(Buffer.concat([header, mechanisms]));
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as net.AddressInfo;

      try {
        await assert.rejects(
          status({
            directory: tempDir,
            table: "schema_migrations",
            url: `postgres://user:secret@127.0.0.1:${port}/example`,
          }),
          {
            message: `Failed to connect to database 'example' at '127.0.0.1:${port}'.`,
          },
        );
        assert.ok(socketClosed);
        await socketClosed;
        assert.equal(keptOpen, false);
      } finally {
        server.close();
      }
    });

    // Invalid SQL fails after several events and before database work.
    it("calls the log sink as a method of the options", async (): Promise<void> => {
      const file = "20260811120000_add_users.sql";
      await fs.writeFile(path.join(tempDir, file), "SELECT 1;\n");
      const options = {
        directory: tempDir,
        events: [] as LogEvent[],
        log(event: LogEvent): undefined {
          this.events.push(event);
        },
        table: "schema_migrations",
        url: "postgres://localhost/example",
      };

      await assert.rejects(
        validate(options),
        new Error(`Missing 'migrate:up' marker in '${file}'.`),
      );
      assert.ok(options.events.length > 0);
    });

    it("ignores log sink failures", async (): Promise<void> => {
      const file = "20260811120000_add_users.sql";
      await fs.writeFile(path.join(tempDir, file), "SELECT 1;\n");
      let calls = 0;

      await assert.rejects(
        validate({
          directory: tempDir,
          log(): undefined {
            calls++;
            throw new Error("Log failure.");
          },
          table: "schema_migrations",
          url: "postgres://localhost/example",
        }),
        new Error(`Missing 'migrate:up' marker in '${file}'.`),
      );
      assert.ok(calls > 0);
    });

    it("ignores async log sink failures", async (): Promise<void> => {
      const file = "20260811120000_add_users.sql";
      await fs.writeFile(path.join(tempDir, file), "SELECT 1;\n");
      let calls = 0;
      let unhandled: unknown;

      function captureUnhandled(error: unknown): void {
        unhandled = error;
      }

      process.on("unhandledRejection", captureUnhandled);
      try {
        await assert.rejects(
          validate({
            directory: tempDir,
            async log(): Promise<void> {
              calls++;
              throw new Error("Async log failure.");
            },
            table: "schema_migrations",
            url: "postgres://localhost/example",
          }),
          new Error(`Missing 'migrate:up' marker in '${file}'.`),
        );
        // Node reports unhandled rejections after the promise job is complete.
        await setImmediate();
        assert.ok(calls > 0);
        assert.equal(unhandled, undefined);
      } finally {
        process.off("unhandledRejection", captureUnhandled);
      }
    });
  });
});
