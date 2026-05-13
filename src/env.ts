import * as fs from "fs/promises";
import * as path from "path";

interface RuntimeEnv {
  databaseUrl?: string;
  migrationsDirectory: string;
  migrationsTable: string;
}

interface ReadRuntimeEnvOptions {
  envFilePath?: string | false;
}

const defaultMigrationsDirectory = "migrations";
const defaultMigrationsTable = "schema_migrations";
const defaultEnvFilePath = ".env";

const databaseUrlEnvVar = "PGM_DATABASE_URL";
const migrationsDirectoryEnvVar = "PGM_MIGRATIONS_DIRECTORY";
const envFilePathEnvVar = "PGM_ENV_FILE";

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

async function readEnvFile(
  env: NodeJS.ProcessEnv,
  configuredPath: string | false | undefined,
): Promise<Record<string, string>> {
  const envFile = resolveEnvFile(env, configuredPath);
  if (!envFile) {
    return {};
  }

  const resolvedPath = path.resolve(envFile.path);

  try {
    return parseEnvFileContents(await fs.readFile(resolvedPath, "utf8"));
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
export async function readRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ReadRuntimeEnvOptions = {},
): Promise<RuntimeEnv> {
  const fileEnv = await readEnvFile(env, options.envFilePath);

  return {
    databaseUrl: runtimeValue(env, fileEnv, databaseUrlEnvVar),
    migrationsDirectory:
      runtimeValue(env, fileEnv, migrationsDirectoryEnvVar) ||
      defaultMigrationsDirectory,
    migrationsTable: defaultMigrationsTable,
  };
}
