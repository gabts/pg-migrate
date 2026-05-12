import * as fs from "fs";
import * as path from "path";

interface RuntimeEnv {
  databaseUrl?: string;
  migrationDirectory: string;
  migrationHistoryTable: string;
}

interface ReadRuntimeEnvOptions {
  envFilePath?: string | false;
}

const defaultMigrationDirectory = "migrations";
const defaultMigrationHistoryTable = "migration_history";
const defaultEnvFilePath = ".env";

const databaseUrlEnvVar = "DATABASE_URL";
const migrationDirectoryEnvVar = "MIGRATION_DIRECTORY";
const envFilePathEnvVar = "PG_MIGRATE_ENV_FILE";

function parseEnvFileContents(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values[key] = trimmed.slice(separatorIndex + 1).trim();
  }

  return values;
}

function resolveEnvFile(
  env: NodeJS.ProcessEnv,
  configuredPath: string | false | undefined,
): { path: string; required: boolean } | null {
  if (configuredPath === false) {
    return null;
  }

  if (configuredPath !== undefined) {
    return { path: configuredPath, required: true };
  }

  const envPath = env[envFilePathEnvVar];
  if (envPath === "") {
    return null;
  }
  if (envPath !== undefined) {
    return { path: envPath, required: true };
  }

  return { path: defaultEnvFilePath, required: false };
}

function readEnvFile(
  env: NodeJS.ProcessEnv,
  configuredPath: string | false | undefined,
): Record<string, string> {
  const envFile = resolveEnvFile(env, configuredPath);
  if (!envFile) {
    return {};
  }

  const resolvedPath = path.resolve(envFile.path);

  try {
    return parseEnvFileContents(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (!envFile.required && code === "ENOENT") {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read env file ${resolvedPath}: ${message}`);
  }
}

function runtimeValue(
  env: NodeJS.ProcessEnv,
  fileEnv: Record<string, string>,
  key: string,
): string | undefined {
  return env[key] ?? fileEnv[key];
}

/**
 * Reads runtime configuration from environment variables and .env files.
 */
export function readRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ReadRuntimeEnvOptions = {},
): RuntimeEnv {
  const fileEnv = readEnvFile(env, options.envFilePath);

  return {
    databaseUrl: runtimeValue(env, fileEnv, databaseUrlEnvVar),
    migrationDirectory:
      runtimeValue(env, fileEnv, migrationDirectoryEnvVar) ||
      defaultMigrationDirectory,
    migrationHistoryTable: defaultMigrationHistoryTable,
  };
}
