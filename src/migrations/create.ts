import * as fs from "fs";
import * as path from "path";
import {
  assertValidMigrationName,
  getMigrationVersion,
  isMigrationFilename,
} from "./naming.js";

/**
 * Options for creating a timestamped migration file.
 */
export interface CreateMigrationOptions {
  clock?: () => Date;
  directory: string;
  name?: string;
}

function formatTimestamp(date = new Date()): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function readExistingMigrationVersions(directory: string): Set<string> {
  const versions = new Set<string>();

  for (const file of fs.readdirSync(directory)) {
    if (isMigrationFilename(file)) {
      versions.add(getMigrationVersion(file));
    }
  }

  return versions;
}

/**
 * Creates a timestamped migration file from a migration name slug.
 */
export function createMigration(opts: CreateMigrationOptions): string {
  if (!opts.name) {
    throw new Error("Name flag (--name, -n) is required");
  }

  assertValidMigrationName(opts.name);

  try {
    fs.mkdirSync(opts.directory, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTDIR") {
      throw new Error(`Migration path is not a directory: ${opts.directory}`);
    }
    throw error;
  }

  if (!fs.statSync(opts.directory).isDirectory()) {
    throw new Error(`Migration path is not a directory: ${opts.directory}`);
  }

  const existingVersions = readExistingMigrationVersions(opts.directory);
  const version = formatTimestamp(opts.clock?.());

  if (existingVersions.has(version)) {
    throw new Error(`Migration version already exists: ${version}`);
  }

  const filePath = path.join(opts.directory, `${version}_${opts.name}.sql`);
  const fileContent = "-- migrate:up\n\n-- migrate:down\n";

  try {
    fs.writeFileSync(filePath, fileContent, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Migration file already exists: ${filePath}. Another create may have run concurrently.`,
      );
    }
    throw error;
  }

  return filePath;
}
