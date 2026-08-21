import * as fs from "node:fs/promises";
import type { DiskMigration } from "./files.js";
import type { LogSink } from "./model.js";

const markerLinePattern = /^[ \t]*--[ \t]*migrate:(up|down)[ \t]*\r?$/gm;

/** Executable SQL parsed from one migration file. */
export interface MigrationSql {
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

function parseSql(sql: string): MigrationSql {
  const markers = findMarkers(sql);
  const upMarker = markers.find((marker) => marker[1] === "up")!;
  const downMarker = markers.find((marker) => marker[1] === "down")!;
  return {
    down: sql.slice(downMarker.index! + downMarker[0].length).trim(),
    up: sql
      .slice(upMarker.index! + upMarker[0].length, downMarker.index!)
      .trim(),
  };
}

async function readUtf8(filePath: string, file: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Migration file '${file}' is not valid UTF-8.`);
  }
}

/** Reads raw SQL text from migration files. */
export async function readMigrationSql(
  migrations: DiskMigration[],
): Promise<Map<string, string>> {
  const sqlByFile = new Map<string, string>();
  for (const migration of migrations) {
    sqlByFile.set(
      migration.file,
      await readUtf8(migration.path, migration.file),
    );
  }
  return sqlByFile;
}

/** Checks the structure of raw migration SQL. */
export function validateMigrationSql(sqlByFile: Map<string, string>): void {
  for (const [file, sql] of sqlByFile) {
    validateSql(sql, file);
  }
}

/** Reads and validates SQL text from migration files. */
export async function readValidatedMigrationSql(
  migrations: DiskMigration[],
  log: LogSink,
): Promise<Map<string, string>> {
  const count = migrations.length;
  log({ count, type: "sql-read-start" });
  const sqlByFile = await readMigrationSql(migrations);
  log({ count, type: "sql-read-done" });

  log({ count, type: "sql-validation-start" });
  validateMigrationSql(sqlByFile);
  log({ count, type: "sql-validation-done" });
  return sqlByFile;
}

/** Parses validated migration SQL into up and down sections. */
export function parseMigrationSql(
  sqlByFile: Map<string, string>,
): Map<string, MigrationSql> {
  return new Map(
    [...sqlByFile].map(([file, sql]) => [file, parseSql(sql)] as const),
  );
}
