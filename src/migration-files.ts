import * as fs from "fs";
import * as path from "path";
import type {
  DiskMigration,
  LoadedMigrations,
  MigrationStep,
} from "./types.js";

export const migrationFilePattern = /^(\d+)(?:-[A-Za-z0-9_.-]+)?\.sql$/;

const migrationMarkers = {
  up: "-- % up-migration % --",
  down: "-- % down-migration % --",
};

export function parseMigrationIndex(file: string): number {
  const match = file.match(migrationFilePattern);
  if (!match?.[1]) {
    throw new Error(`Invalid migration file name: ${file}`);
  }

  const index = Number.parseInt(match[1], 10);
  if (!Number.isInteger(index)) {
    throw new Error(`Invalid migration file name: ${file}`);
  }

  return index;
}

export function parseMigration(
  sql: string,
  direction: "up" | "down",
  file: string,
): string {
  const upMarker = migrationMarkers.up;
  const downMarker = migrationMarkers.down;
  const upMarkerIndex = sql.indexOf(upMarker);
  const downMarkerIndex = sql.indexOf(downMarker);

  if (upMarkerIndex === -1 || downMarkerIndex === -1) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (
    sql.indexOf(upMarker, upMarkerIndex + upMarker.length) !== -1 ||
    sql.indexOf(downMarker, downMarkerIndex + downMarker.length) !== -1
  ) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (upMarkerIndex > downMarkerIndex) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (sql.slice(0, upMarkerIndex).trim().length > 0) {
    throw new Error(`Unexpected content before up marker in: ${file}`);
  }

  const upSql = sql
    .slice(upMarkerIndex + upMarker.length, downMarkerIndex)
    .trim();
  const downSql = sql.slice(downMarkerIndex + downMarker.length).trim();

  if (!upSql) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  return direction === "up" ? upSql : downSql;
}

export function materializeSteps(
  migrations: DiskMigration[],
  direction: "up" | "down",
): MigrationStep[] {
  return migrations.map(({ file, index, path: filePath }) => ({
    file,
    index,
    sql: parseMigration(fs.readFileSync(filePath, "utf8"), direction, file),
  }));
}

export function loadDiskMigrations(directory: string): LoadedMigrations {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Migration directory does not exist: ${directory}`);
  }

  const files = fs.readdirSync(directory);
  const migrationFiles = files.filter((file): boolean => file.endsWith(".sql"));

  if (!migrationFiles.length) {
    throw new Error(`No migration files found in directory: ${directory}`);
  }

  const invalidMigrationFile = migrationFiles.find(
    (file): boolean => !file.match(migrationFilePattern),
  );

  if (invalidMigrationFile) {
    throw new Error(`Invalid migration file name: ${invalidMigrationFile}`);
  }

  const all = migrationFiles.map(
    (file): DiskMigration => ({
      file,
      index: parseMigrationIndex(file),
      path: path.join(directory, file),
    }),
  );
  const byFile = new Map<string, DiskMigration>();
  const seenIndices = new Map<number, string>();

  for (const migration of all) {
    const existingFile = seenIndices.get(migration.index);
    if (existingFile) {
      throw new Error(
        `Duplicate migration index ${migration.index}: ${existingFile} and ${migration.file}`,
      );
    }

    seenIndices.set(migration.index, migration.file);
    byFile.set(migration.file, migration);
  }

  all.sort((a, b): number => a.index - b.index);

  return { all, byFile };
}
