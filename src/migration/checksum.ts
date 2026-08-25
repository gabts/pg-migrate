import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import type { DiskMigration } from "./files.js";
import type { LogSink } from "./model.js";

/** Calculates the SHA-256 checksum of exact migration file bytes. */
export function calculateMigrationChecksum(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** Reads migration files and returns their SHA-256 checksums. */
export async function readMigrationChecksums(
  migrations: DiskMigration[],
  log: LogSink = (): undefined => undefined,
): Promise<Map<string, string>> {
  log({ count: migrations.length, type: "checksum-calculation-start" });
  const checksums = new Map<string, string>();
  for (const migration of migrations) {
    const contents = await fs.readFile(migration.path);
    checksums.set(migration.file, calculateMigrationChecksum(contents));
  }
  log({ count: migrations.length, type: "checksum-calculation-done" });
  return checksums;
}
