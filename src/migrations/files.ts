import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertValidMigrationFilename, getMigrationVersion } from "./naming.js";
import type {
  DiskMigration,
  LoadedMigrations,
  MigrationStep,
} from "./types.js";

type MigrationDirection = "up" | "down";

interface ParsedMigrationSql {
  down: string;
  up: string;
}

const migrationMarkers = {
  up: "-- migrate:up",
  down: "-- migrate:down",
};

async function readFileUtf8Strict(
  filePath: string,
  file: string,
): Promise<string> {
  const bytes = await fs.readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Migration file is not valid UTF-8: ${file}`);
  }
}

function hasOnlyCommentsAndWhitespace(sql: string): boolean {
  const commentOrWhitespacePattern =
    /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/;
  return commentOrWhitespacePattern.test(sql);
}

function parseMigrationSections(sql: string, file: string): ParsedMigrationSql {
  const upMarker = migrationMarkers.up;
  const downMarker = migrationMarkers.down;
  const upMarkerIndex = sql.indexOf(upMarker);
  const downMarkerIndex = sql.indexOf(downMarker);

  if (upMarkerIndex === -1) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (
    sql.indexOf(upMarker, upMarkerIndex + upMarker.length) !== -1 ||
    (downMarkerIndex !== -1 &&
      sql.indexOf(downMarker, downMarkerIndex + downMarker.length) !== -1)
  ) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  const firstMarkerIndex =
    downMarkerIndex === -1
      ? upMarkerIndex
      : Math.min(upMarkerIndex, downMarkerIndex);

  if (!hasOnlyCommentsAndWhitespace(sql.slice(0, firstMarkerIndex))) {
    throw new Error(`Unexpected content before up marker in: ${file}`);
  }

  const upSectionEnd =
    downMarkerIndex !== -1 && downMarkerIndex > upMarkerIndex
      ? downMarkerIndex
      : sql.length;
  const upSql = sql.slice(upMarkerIndex + upMarker.length, upSectionEnd).trim();
  const downSql =
    downMarkerIndex === -1
      ? ""
      : sql
          .slice(
            downMarkerIndex + downMarker.length,
            upMarkerIndex > downMarkerIndex ? upMarkerIndex : sql.length,
          )
          .trim();

  if (!upSql) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  return { down: downSql, up: upSql };
}

/**
 * Extracts a migration section (`up` or `down`) from raw migration SQL text.
 */
export function parseMigration(
  sql: string,
  direction: MigrationDirection,
  file: string,
): string {
  const sections = parseMigrationSections(sql, file);
  return direction === "up" ? sections.up : sections.down;
}

/**
 * Reads and parses SQL sections for each disk migration by file name.
 */
export async function readMigrationSqlByFile(
  migrations: DiskMigration[],
): Promise<Map<string, ParsedMigrationSql>> {
  const sqlByFile = new Map<string, ParsedMigrationSql>();

  for (const { file, path: filePath } of migrations) {
    const sql = await readFileUtf8Strict(filePath, file);
    sqlByFile.set(file, parseMigrationSections(sql, file));
  }

  return sqlByFile;
}

/**
 * Builds executable migration steps from pre-parsed SQL sections.
 */
export function materializeStepsFromSql(
  migrations: DiskMigration[],
  direction: MigrationDirection,
  sqlByFile: Map<string, ParsedMigrationSql>,
): MigrationStep[] {
  return migrations.map(({ file }): MigrationStep => {
    const parsedSql = sqlByFile.get(file);
    if (!parsedSql) {
      throw new Error(`Missing parsed migration SQL for file: ${file}`);
    }
    return {
      file,
      sql: direction === "up" ? parsedSql.up : parsedSql.down,
    };
  });
}

/**
 * Reads and materializes executable steps from migration files on disk.
 */
export async function materializeSteps(
  migrations: DiskMigration[],
  direction: MigrationDirection,
): Promise<MigrationStep[]> {
  return materializeStepsFromSql(
    migrations,
    direction,
    await readMigrationSqlByFile(migrations),
  );
}

/**
 * Loads, validates, and orders migration files from a directory.
 */
export async function loadDiskMigrations(
  directory: string,
): Promise<LoadedMigrations> {
  const directoryStats = await fs.stat(directory).catch((): null => null);
  if (!directoryStats?.isDirectory()) {
    throw new Error(`Migrations directory does not exist: ${directory}`);
  }

  const files = await fs.readdir(directory);
  const migrationFiles = files.filter((file): boolean => file.endsWith(".sql"));

  if (!migrationFiles.length) {
    throw new Error(`No migration files found in directory: ${directory}`);
  }

  const filesWithVersions = migrationFiles.map(
    (file): { file: string; version: string } => {
      assertValidMigrationFilename(file);
      return { file, version: getMigrationVersion(file) };
    },
  );

  filesWithVersions.sort((a, b): number => {
    if (a.version < b.version) return -1;
    if (a.version > b.version) return 1;
    return 0;
  });

  const seenVersions = new Map<string, string>();
  for (const { file, version } of filesWithVersions) {
    const existingFile = seenVersions.get(version);
    if (existingFile) {
      throw new Error(
        `Duplicate migration version: ${version} in files ${existingFile} and ${file}`,
      );
    }
    seenVersions.set(version, file);
  }

  const all = filesWithVersions.map(
    ({ file }): DiskMigration => ({
      file,
      path: path.join(directory, file),
    }),
  );
  const byFile = new Map<string, DiskMigration>();

  for (const migration of all) {
    byFile.set(migration.file, migration);
  }

  return { all, byFile };
}
