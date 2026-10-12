import * as assert from "node:assert/strict";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import type * as pg from "pg";
import { createDatabaseClient, withHistoryTable } from "./database.js";
import type { LogEvent } from "./model.js";

function noLog(): undefined {
  return undefined;
}

function createClient(
  names: { database?: string; user?: string } = {
    database: "app",
    user: "app_user",
  },
): { client: pg.Client; ended: () => boolean } {
  let ended = false;
  const client = {
    ...names,
    connect: async (): Promise<void> => {},
    end: async (): Promise<void> => {
      ended = true;
    },
    host: "localhost",
    port: 5432,
    query: async (): Promise<{ rows: unknown[] }> => ({
      rows: [{ schema: "public" }],
    }),
  } as unknown as pg.Client;
  return { client, ended: (): boolean => ended };
}

describe("database", (): void => {
  describe("createDatabaseClient", (): void => {
    it("rejects an empty or non-string database URL", (): void => {
      for (const [url, value] of [
        ["", ""],
        [" ", " "],
        [undefined, "undefined"],
        [42, "42"],
      ] as const) {
        assert.throws(
          () => createDatabaseClient(url as string),
          new Error(`Invalid value '${value}' for 'url'.`),
        );
      }
    });

    it("rejects a malformed database URL", (): void => {
      for (const url of [
        "postgres://user:secret@[localhost/app",
        // pg decodes percent-encoding itself, which throws a URIError.
        "postgres://user:%C3%28@localhost/app",
      ]) {
        assert.throws(
          () => createDatabaseClient(url),
          new Error("Database URL is not a valid URL."),
        );
      }
    });

    it("keeps the cause when pg cannot apply a database URL setting", async (): Promise<void> => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg_migrate-"));
      const certificate = path.join(tempDir, "missing.pem");

      try {
        assert.throws(
          () =>
            createDatabaseClient(
              `postgres://localhost/example?sslrootcert=${certificate}`,
            ),
          (error: unknown): boolean => {
            assert.ok(error instanceof Error);
            assert.equal(
              error.message,
              "Failed to apply database URL settings.",
            );
            assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
            return true;
          },
        );
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("withHistoryTable", (): void => {
    it("disconnects after the callback returns", async (): Promise<void> => {
      const { client, ended } = createClient();
      const events: LogEvent[] = [];
      const database = {
        database: "app",
        host: "localhost",
        port: 5432,
        user: "app_user",
      };

      const result = await withHistoryTable(
        client,
        "schema_migrations",
        (event): void => {
          events.push(event);
        },
        async (historyTable): Promise<string> => {
          assert.equal(ended(), false);
          return historyTable.qualifiedName;
        },
      );

      assert.equal(result, '"public"."schema_migrations"');
      assert.deepEqual(events, [
        { database, type: "database-connect-start" },
        { database, type: "database-connect-done" },
        { database, type: "database-disconnect-done" },
      ]);
    });

    it("reports fallback names when the client has none", async (): Promise<void> => {
      const { client } = createClient({});
      const events: LogEvent[] = [];

      await withHistoryTable(
        client,
        "schema_migrations",
        (event): void => {
          events.push(event);
        },
        async (): Promise<void> => {},
      );

      assert.deepEqual(events[0], {
        database: {
          database: "default database",
          host: "localhost",
          port: 5432,
          user: "default user",
        },
        type: "database-connect-start",
      });
    });

    it("disconnects when the callback fails", async (): Promise<void> => {
      const { client, ended } = createClient();
      const failure = new Error("Callback failure.");

      await assert.rejects(
        withHistoryTable(
          client,
          "schema_migrations",
          noLog,
          async (): Promise<never> => {
            throw failure;
          },
        ),
        failure,
      );
      assert.equal(ended(), true);
    });

    it("identifies the database in connection errors", async (): Promise<void> => {
      // Nothing listens on port 1, so the connection is refused at once.
      const client = createDatabaseClient("postgres://127.0.0.1:1/example");

      await assert.rejects(
        withHistoryTable(
          client,
          "schema_migrations",
          noLog,
          async (): Promise<void> => {},
        ),
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
      const client = createDatabaseClient(
        `postgres://user:secret@127.0.0.1:${port}/example`,
      );

      try {
        await assert.rejects(
          withHistoryTable(
            client,
            "schema_migrations",
            noLog,
            async (): Promise<void> => {},
          ),
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
  });
});
