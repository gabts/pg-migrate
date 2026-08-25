import * as fs from "node:fs/promises";
import { calculateMigrationChecksum } from "./checksum.js";
import type { DiskMigration } from "./files.js";
import type { LogSink } from "./model.js";

const markerLinePattern = /^[ \t]*--[ \t]*migrate:(up|down)[ \t]*\r?$/gm;

/** Raw migration SQL and the checksum of its exact file bytes. */
export interface MigrationSource {
  checksum: string;
  sql: string;
}

/** Executable SQL parsed from one migration file. */
export interface MigrationSql {
  checksum: string;
  down: string;
  up: string;
}

function findMarkers(sql: string): RegExpMatchArray[] {
  return [...sql.matchAll(markerLinePattern)];
}

function validateSql(sql: string, file: string): void {
  const markers = findMarkers(sql);
  const upMarkers = markers.filter((marker) => marker[1] === "up");
  const downMarkers = markers.filter((marker) => marker[1] === "down");

  if (upMarkers.length > 1) {
    throw new Error(`Marker 'migrate:up' is duplicated in '${file}'.`);
  }
  if (downMarkers.length > 1) {
    throw new Error(`Marker 'migrate:down' is duplicated in '${file}'.`);
  }

  const upMarker = upMarkers[0];
  if (!upMarker) {
    throw new Error(`Missing 'migrate:up' marker in '${file}'.`);
  }
  const downMarker = downMarkers[0];
  if (!downMarker) {
    throw new Error(`Missing 'migrate:down' marker in '${file}'.`);
  }
  if (downMarker.index! < upMarker.index!) {
    throw new Error(
      `Marker 'migrate:up' must come before 'migrate:down' in '${file}'.`,
    );
  }
  if (sql.slice(0, upMarker.index!).trim() !== "") {
    throw new Error(
      `Unexpected content before the first migration marker in '${file}'.`,
    );
  }

  const upSql = sql
    .slice(upMarker.index! + upMarker[0].length, downMarker.index!)
    .trim();
  if (upSql === "") {
    throw new Error(`Section 'migrate:up' is empty in '${file}'.`);
  }
}

function parseSql(source: MigrationSource): MigrationSql {
  const { sql } = source;
  const markers = findMarkers(sql);
  const upMarker = markers.find((marker) => marker[1] === "up")!;
  const downMarker = markers.find((marker) => marker[1] === "down")!;
  return {
    checksum: source.checksum,
    down: sql.slice(downMarker.index! + downMarker[0].length).trim(),
    up: sql
      .slice(upMarker.index! + upMarker[0].length, downMarker.index!)
      .trim(),
  };
}

function decodeUtf8(bytes: Uint8Array, file: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Migration file '${file}' is not valid UTF-8.`);
  }
}

/** Reads raw SQL text from migration files. */
export async function readMigrationSql(
  migrations: DiskMigration[],
): Promise<Map<string, MigrationSource>> {
  const sourceByFile = new Map<string, MigrationSource>();
  for (const migration of migrations) {
    const contents = await fs.readFile(migration.path);
    sourceByFile.set(migration.file, {
      checksum: calculateMigrationChecksum(contents),
      sql: decodeUtf8(contents, migration.file),
    });
  }
  return sourceByFile;
}

/** Checks the structure of raw migration SQL. */
export function validateMigrationSql(
  sourceByFile: Map<string, MigrationSource>,
): void {
  for (const [file, source] of sourceByFile) {
    validateSql(source.sql, file);
  }
}

/** Reads and validates SQL text from migration files. */
export async function readValidatedMigrationSql(
  migrations: DiskMigration[],
  log: LogSink,
): Promise<Map<string, MigrationSource>> {
  const count = migrations.length;
  log({ count, type: "sql-read-start" });
  const sourceByFile = await readMigrationSql(migrations);
  log({ count, type: "sql-read-done" });

  log({ count, type: "sql-validation-start" });
  validateMigrationSql(sourceByFile);
  log({ count, type: "sql-validation-done" });
  return sourceByFile;
}

/** Parses validated migration SQL into up and down sections. */
export function parseMigrationSql(
  sourceByFile: Map<string, MigrationSource>,
): Map<string, MigrationSql> {
  return new Map(
    [...sourceByFile].map(
      ([file, source]) => [file, parseSql(source)] as const,
    ),
  );
}
