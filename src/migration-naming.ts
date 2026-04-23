const migrationSlugPattern = /^[a-z0-9][a-z0-9_]*$/;
const migrationFilePattern = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/;

/**
 * Validates a migration slug used for new migration file creation.
 */
export function assertValidMigrationName(name: string): void {
  if (!migrationSlugPattern.test(name)) {
    throw new Error(
      `Invalid migration name: ${name}. Expected lowercase slug format: <slug> with letters, numbers, and underscores`,
    );
  }
}

/**
 * Validates a migration filename against the canonical file pattern.
 */
export function assertValidMigrationFilename(file: string): void {
  if (!migrationFilePattern.test(file)) {
    throw new Error(
      `Invalid migration filename: ${file}. Expected format: <YYYYMMDDHHMMSS>_<slug>.sql`,
    );
  }
}

/**
 * Extracts the sortable timestamp/version prefix from a migration file.
 */
export function getMigrationVersion(file: string): string {
  const match = file.match(migrationFilePattern);
  const version = match?.[1];
  if (!version) {
    throw new Error(
      `Invalid migration filename: ${file}. Expected format: <YYYYMMDDHHMMSS>_<slug>.sql`,
    );
  }
  return version;
}
