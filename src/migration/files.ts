import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LogSink } from "./model.js";

const slug = "[a-z0-9][a-z0-9_]*";
const version = "\\d{14}";
const namePattern = new RegExp(`^${slug}$`);
const versionPattern = new RegExp(`^${version}$`);
const filenamePattern = new RegExp(`^(${version})_(${slug})\\.sql$`);

interface MigrationDirectoryEntry {
  name: string;
  isFile: boolean;
}

/** A validated migration file on disk. */
export interface DiskMigration {
  file: string;
  name: string;
  path: string;
  version: string;
}

/** Migration files in ordered and indexed forms. */
export interface MigrationIndex {
  all: DiskMigration[];
  byFile: Map<string, DiskMigration>;
  byVersion: Map<string, DiskMigration>;
}

/** Validates that a migration name is a lowercase slug. */
export function validateMigrationName(name: string): void {
  if (!namePattern.test(name)) {
    throw new Error(
      `Invalid migration name '${name}', expected lowercase letters, ` +
        `numbers, and underscores.`,
    );
  }
}

/** Returns whether a value is a canonical migration version. */
export function isMigrationVersion(value: string): boolean {
  return versionPattern.test(value);
}

/** Returns whether a value is a canonical migration filename. */
export function isMigrationFilename(value: string): boolean {
  return filenamePattern.test(value);
}

/** Extracts the version from a validated migration filename. */
export function getMigrationVersion(filename: string): string {
  return filename.slice(0, 14);
}

function getMigrationName(filename: string): string {
  return filename.slice(15, -4);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function migrationEntries(
  entries: MigrationDirectoryEntry[],
): MigrationDirectoryEntry[] {
  return entries
    .filter((entry) => entry.name.endsWith(".sql"))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/** Reads raw entries from a migration directory. */
export async function readMigrationDirectory(
  directory: string,
): Promise<MigrationDirectoryEntry[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.map((entry) => ({
      isFile: entry.isFile(),
      name: entry.name,
    }));
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new Error(`Migration path '${directory}' is not a directory.`);
    }
    throw error;
  }
}

/** Checks migration filenames, file types, and version uniqueness. */
export function validateMigrationFilenames(
  directory: string,
  entries: MigrationDirectoryEntry[],
): void {
  const migrations = migrationEntries(entries);
  if (migrations.length === 0) {
    throw new Error(`No migration files found in '${directory}'.`);
  }

  const fileByVersion = new Map<string, string>();
  for (const entry of migrations) {
    if (!entry.isFile) {
      throw new Error(
        `Migration path '${path.join(directory, entry.name)}' is not a file.`,
      );
    }
    if (!isMigrationFilename(entry.name)) {
      throw new Error(`Invalid migration filename '${entry.name}'.`);
    }
    const version = getMigrationVersion(entry.name);
    const duplicate = fileByVersion.get(version);
    if (duplicate) {
      throw new Error(
        `Migration version '${version}' is used by ` +
          `'${duplicate}' and '${entry.name}'.`,
      );
    }
    fileByVersion.set(version, entry.name);
  }
}

/** Builds ordered and indexed migrations from validated directory entries. */
export function buildMigrationIndex(
  directory: string,
  entries: MigrationDirectoryEntry[],
): MigrationIndex {
  const all = migrationEntries(entries).map(
    (entry): DiskMigration => ({
      file: entry.name,
      name: getMigrationName(entry.name),
      path: path.join(directory, entry.name),
      version: getMigrationVersion(entry.name),
    }),
  );
  return {
    all,
    byFile: new Map(all.map((migration) => [migration.file, migration])),
    byVersion: new Map(all.map((migration) => [migration.version, migration])),
  };
}

/** Reads, validates, and indexes one migration directory. */
export async function readMigrationIndex(
  directory: string,
  log: LogSink,
): Promise<MigrationIndex> {
  log({ directory, type: "directory-read-start" });
  const entries = await readMigrationDirectory(directory);
  log({ directory, type: "directory-read-done" });

  log({ type: "filenames-validation-start" });
  validateMigrationFilenames(directory, entries);
  const migrationIndex = buildMigrationIndex(directory, entries);
  log({
    count: migrationIndex.all.length,
    type: "filenames-validation-done",
  });
  return migrationIndex;
}
