import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertValidMigrationFilename, getMigrationVersion } from "./naming.js";
import type {
  DiskMigration,
  LoadedMigrations,
  MigrationStep,
} from "./types.js";

type MigrationDirection = "up" | "down";
type MigrationMarkerType = MigrationDirection | "irreversible";

interface ParsedMigrationSql {
  down: string;
  up: string;
}

interface MigrationMarker {
  end: number;
  start: number;
  type: MigrationMarkerType;
}

const ignoredSqlPattern =
  /(?<![A-Za-z0-9_$])[eE]'(?:''|\\[\s\S]|[^'\\])*'|\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\1\$|\$\$[\s\S]*?\$\$|'(?:''|[^'])*'|\/\*[\s\S]*?\*\//g;
const migrationMarkerLinePattern =
  /^[^\S\r\n]*--[^\S\r\n]*migrate:(up|down|irreversible)[^\S\r\n]*(?:\r\n|\r|\n|$)/gm;
const forwardOnlyMigrationHint =
  "Use migrate:irreversible for forward-only migrations.";

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
    /^(?:\s|--[^\r\n]*(?:\r\n|\r|\n|$)|\/\*[\s\S]*?\*\/)*$/;
  return commentOrWhitespacePattern.test(sql);
}

function assertSectionHasSql(
  section: MigrationMarkerType,
  sql: string,
  file: string,
): void {
  if (hasOnlyCommentsAndWhitespace(sql)) {
    const hint = section === "down" ? ` ${forwardOnlyMigrationHint}` : "";
    throw new Error(
      `Empty migrate:${section} section in migration file: ${file}.${hint}`,
    );
  }
}

function maskIgnoredSql(sql: string): string {
  return sql.replace(ignoredSqlPattern, (match): string => {
    return match.replace(/[^\r\n]/g, " ");
  });
}

function findMigrationMarkers(sql: string): MigrationMarker[] {
  const maskedSql = maskIgnoredSql(sql);
  const markers: MigrationMarker[] = [];
  const matches = maskedSql.matchAll(migrationMarkerLinePattern);

  for (const markerMatch of matches) {
    const type = markerMatch[1] as MigrationMarkerType;
    const start = markerMatch.index;
    const text = markerMatch[0];

    if (start === undefined) {
      continue;
    }

    markers.push({
      end: start + text.length,
      start,
      type,
    });
  }

  return markers;
}

function markersOfType(
  markers: MigrationMarker[],
  type: MigrationMarkerType,
): MigrationMarker[] {
  return markers.filter((marker): boolean => marker.type === type);
}

function assertOnlyCommentsBeforeInitialMarker(
  markers: MigrationMarker[],
  sql: string,
  file: string,
): void {
  const initialMarker = markers[0];
  if (!initialMarker) {
    return;
  }

  if (!hasOnlyCommentsAndWhitespace(sql.slice(0, initialMarker.start))) {
    throw new Error(`Unexpected content before migration marker in: ${file}`);
  }
}

function parseMigrationSections(sql: string, file: string): ParsedMigrationSql {
  const markers = findMigrationMarkers(sql);
  assertOnlyCommentsBeforeInitialMarker(markers, sql, file);

  const upMarkers = markersOfType(markers, "up");
  const downMarkers = markersOfType(markers, "down");
  const irreversibleMarkers = markersOfType(markers, "irreversible");

  if (upMarkers.length > 1) {
    throw new Error(`Duplicate migrate:up marker in migration file: ${file}`);
  }

  if (downMarkers.length > 1) {
    throw new Error(`Duplicate migrate:down marker in migration file: ${file}`);
  }

  if (irreversibleMarkers.length > 1) {
    throw new Error(
      `Duplicate migrate:irreversible marker in migration file: ${file}`,
    );
  }

  const irreversibleMarker = irreversibleMarkers[0];
  if (irreversibleMarker) {
    if (upMarkers.length || downMarkers.length) {
      throw new Error(
        `migrate:irreversible marker cannot be combined with migrate:up or migrate:down markers in migration file: ${file}`,
      );
    }

    const irreversibleSql = sql.slice(irreversibleMarker.end).trim();

    assertSectionHasSql("irreversible", irreversibleSql, file);

    return { down: "", up: irreversibleSql };
  }

  const upMarker = upMarkers[0];
  if (!upMarker) {
    throw new Error(
      `Missing migrate:up or migrate:irreversible marker in migration file: ${file}`,
    );
  }

  const downMarker = downMarkers[0];
  if (!downMarker) {
    throw new Error(
      `Missing migrate:down marker in migration file: ${file}. ${forwardOnlyMigrationHint}`,
    );
  }

  if (downMarker.start < upMarker.start) {
    throw new Error(
      `migrate:up marker must appear before migrate:down marker in migration file: ${file}`,
    );
  }

  const upSql = sql.slice(upMarker.end, downMarker.start).trim();
  const downSql = sql.slice(downMarker.end).trim();

  assertSectionHasSql("up", upSql, file);
  assertSectionHasSql("down", downSql, file);

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
