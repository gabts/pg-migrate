interface RuntimeEnv {
  databaseUrl?: string;
  migrationDirectory: string;
  migrationHistoryTable: string;
}

const defaultMigrationDirectory = "migrations";
const defaultMigrationHistoryTable = "migration_history";

const databaseUrlEnvVar = "DATABASE_URL";
const migrationDirectoryEnvVar = "MIGRATION_DIRECTORY";

/**
 * Reads runtime configuration from environment variables with built-in defaults.
 */
export function readRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  return {
    databaseUrl: env[databaseUrlEnvVar],
    migrationDirectory:
      env[migrationDirectoryEnvVar] || defaultMigrationDirectory,
    migrationHistoryTable: defaultMigrationHistoryTable,
  };
}
