import * as pg from "pg";
import { resolveHistoryTable, type ResolvedHistoryTable } from "./history.js";
import type { DatabaseDetails, LogSink } from "./model.js";

function validateDatabaseUrl(url: string): void {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error(`Invalid value '${String(url)}' for 'url'.`);
  }
}

function getDatabaseDetails(client: pg.Client): DatabaseDetails {
  return {
    database: client.database ?? "default database",
    host: client.host,
    port: client.port,
    user: client.user ?? "default user",
  };
}

/** Creates an unconnected database client from a database URL. */
export function createDatabaseClient(url: string): pg.Client {
  validateDatabaseUrl(url);
  let client: pg.Client;
  // pg parses the URL here and reads files that its SSL settings name. The
  // 'Invalid URL' TypeError holds the URL, which can contain a password, so
  // it is not kept as the cause. Bad percent-encoding throws a URIError.
  try {
    client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: 10_000,
    });
  } catch (error) {
    if (
      error instanceof URIError ||
      (error instanceof TypeError &&
        "code" in error &&
        error.code === "ERR_INVALID_URL")
    ) {
      throw new Error("Database URL is not a valid URL.");
    }
    throw new Error("Failed to apply database URL settings.", {
      cause: error,
    });
  }
  // A dropped connection also rejects the query. Without a listener, the
  // 'error' event would crash the process.
  client.on("error", (): undefined => undefined);
  return client;
}

async function connectDatabase(client: pg.Client, log: LogSink): Promise<void> {
  const database = getDatabaseDetails(client);
  log({ database, type: "database-connect-start" });
  try {
    await client.connect();
  } catch (error) {
    // pg leaves the socket open after a client-side failure
    await client.end();
    const address = database.host.startsWith("/")
      ? database.host
      : `${database.host}:${database.port}`;
    throw new Error(
      `Failed to connect to database '${database.database}' at ` +
        `'${address}'.`,
      { cause: error },
    );
  }
  log({ database, type: "database-connect-done" });
}

async function disconnectDatabase(
  client: pg.Client,
  log: LogSink,
): Promise<void> {
  await client.end();
  log({
    database: getDatabaseDetails(client),
    type: "database-disconnect-done",
  });
}

/** Connects, resolves the history table, and disconnects after `fn`. */
export async function withHistoryTable<T>(
  client: pg.Client,
  table: string,
  log: LogSink,
  fn: (historyTable: ResolvedHistoryTable) => Promise<T>,
): Promise<T> {
  await connectDatabase(client, log);
  try {
    const historyTable = await resolveHistoryTable(client, table);
    // Await so that the client stays connected until the callback is done.
    return await fn(historyTable);
  } finally {
    await disconnectDatabase(client, log);
  }
}
