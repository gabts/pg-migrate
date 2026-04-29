import type * as pg from "pg";

/**
 * Runs a callback inside a transaction with rollback-on-error semantics.
 */
export async function runInTransaction<T>(
  client: pg.Client,
  fn: () => Promise<T>,
): Promise<T> {
  let committed = false;
  await client.query("BEGIN;");
  try {
    const result = await fn();
    await client.query("COMMIT;");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Ignore rollback errors and surface the original failure.
      }
    }
  }
}
