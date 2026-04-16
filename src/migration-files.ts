import * as fs from "fs";
import * as path from "path";
import type {
  DiskMigration,
  LoadedMigrations,
  MigrationStep,
} from "./types.js";

const migrationMarkers = {
  up: "-- migrate:up",
  down: "-- migrate:down",
};

export function parseMigration(
  sql: string,
  direction: "up" | "down",
  file: string,
): string {
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

  if (downMarkerIndex !== -1 && upMarkerIndex > downMarkerIndex) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  if (sql.slice(0, upMarkerIndex).trim().length > 0) {
    throw new Error(`Unexpected content before up marker in: ${file}`);
  }

  const upSectionEnd = downMarkerIndex === -1 ? sql.length : downMarkerIndex;
  const upSql = sql.slice(upMarkerIndex + upMarker.length, upSectionEnd).trim();
  const downSql =
    downMarkerIndex === -1
      ? ""
      : sql.slice(downMarkerIndex + downMarker.length).trim();

  if (!upSql) {
    throw new Error(`Invalid migration file contents: ${file}`);
  }

  return direction === "up" ? upSql : downSql;
}

export function materializeSteps(
  migrations: DiskMigration[],
  direction: "up" | "down",
): MigrationStep[] {
  return migrations.map(({ file, path: filePath }) => ({
    file,
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

  const all = migrationFiles.sort().map(
    (file): DiskMigration => ({
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
