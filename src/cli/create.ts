import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  getMigrationVersion,
  isMigrationFilename,
  validateMigrationName,
} from "../migration/files.js";
import type { CliLogEvent, CliLogSink } from "./model.js";

const TEMPLATE = "-- migrate:up\n\n-- migrate:down\n";

interface CreateOptions {
  directory: string;
  log?: CliLogSink;
  name: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatVersion(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function log(sink: CliLogSink | undefined, event: CliLogEvent): void {
  try {
    sink?.(event);
  } catch {
    // Progress output must not change command behavior.
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "EEXIST" || error.code === "ENOTDIR")
    ) {
      throw new Error(`Migration path '${directory}' is not a directory.`);
    }
    throw error;
  }
  if (!(await fs.stat(directory)).isDirectory()) {
    throw new Error(`Migration path '${directory}' is not a directory.`);
  }
}

// The lock file prevents two processes from using the same version.
async function acquireVersionLock(
  directory: string,
  version: string,
): Promise<string> {
  const lockPath = path.join(directory, `.${version}.lock`);
  try {
    await fs.writeFile(lockPath, "", { flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(`Migration version '${version}' already exists.`);
    }
    throw error;
  }
  return lockPath;
}

async function findLatestVersion(
  directory: string,
): Promise<string | undefined> {
  let latest: string | undefined;
  for (const file of await fs.readdir(directory)) {
    if (!isMigrationFilename(file)) {
      continue;
    }
    const version = getMigrationVersion(file);
    latest = latest === undefined || version > latest ? version : latest;
  }
  return latest;
}

function validateNewVersion(version: string, latest: string | undefined): void {
  if (version === latest) {
    throw new Error(`Migration version '${version}' already exists.`);
  }
  if (latest !== undefined && version < latest) {
    throw new Error(
      `Migration version '${version}' must be later than existing version ` +
        `'${latest}'.`,
    );
  }
}

/** Creates a timestamped migration file for the CLI. */
export async function create(options: CreateOptions): Promise<string> {
  validateMigrationName(options.name);
  const version = formatVersion(new Date());
  const filename = `${version}_${options.name}.sql`;

  log(options.log, {
    directory: options.directory,
    type: "file-create-start",
  });
  await ensureDirectory(options.directory);

  const lockPath = await acquireVersionLock(options.directory, version);

  try {
    validateNewVersion(version, await findLatestVersion(options.directory));

    const filePath = path.join(options.directory, filename);
    try {
      await fs.writeFile(filePath, TEMPLATE, { flag: "wx" });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error(`Migration file '${filePath}' already exists.`);
      }
      throw error;
    }

    log(options.log, { type: "file-created", path: filePath });
    return filePath;
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}
