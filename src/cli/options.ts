import type { ClientConfig } from "../db/types.js";
import { readRuntimeEnv } from "../env.js";
import type { CreateMigrationOptions } from "../migrations/create.js";
import { booleanFlag, valueFlag, type ParsedTokens } from "./args.js";

const defaultConnectionTimeoutMillis = 10_000;

interface DatabaseRunOptions {
  clientConfig: ClientConfig;
  directory: string;
  table: string;
}

interface MigrationRunOptions extends DatabaseRunOptions {
  dryRun: boolean;
  target?: string;
}

function buildClientConfig(connectionString: string): ClientConfig {
  return {
    connectionString,
    connectionTimeoutMillis: defaultConnectionTimeoutMillis,
  };
}

function readCliRuntimeEnv(
  parsed: ParsedTokens,
): ReturnType<typeof readRuntimeEnv> {
  return readRuntimeEnv(process.env, {
    envFilePath: valueFlag(parsed, "--env-file"),
  });
}

/**
 * Builds validated options for the create command from parsed CLI tokens.
 */
export function buildCreateOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
): CreateMigrationOptions {
  if (extraPositional.length > 0) {
    throw new Error(`Unexpected argument: ${extraPositional[0]}`);
  }

  const runtimeEnv = readCliRuntimeEnv(parsed);

  return {
    directory:
      valueFlag(parsed, "--directory") ?? runtimeEnv.migrationDirectory,
    name: valueFlag(parsed, "--name")?.replace(/\.sql$/, ""),
  };
}

/**
 * Builds validated options for commands that need a database connection.
 */
export function buildDatabaseRunOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  command: "up" | "down" | "validate" | "status",
): DatabaseRunOptions {
  if (extraPositional.length > 1) {
    throw new Error(`Unexpected argument: ${extraPositional[1]}`);
  }

  const positionalUrl = extraPositional[0];
  const flagUrl = valueFlag(parsed, "--url");

  if (positionalUrl !== undefined && flagUrl !== undefined) {
    throw new Error(
      "Database URL provided multiple times; use either <database-url> or --url",
    );
  }

  const runtimeEnv = readCliRuntimeEnv(parsed);

  const clientConfig = positionalUrl ?? flagUrl ?? runtimeEnv.databaseUrl;
  if (!clientConfig) {
    throw new Error(
      `Database URL is required for ${command}; pass it as an argument, --url, set DATABASE_URL, or add DATABASE_URL to .env`,
    );
  }

  return {
    clientConfig: buildClientConfig(clientConfig),
    directory:
      valueFlag(parsed, "--directory") ?? runtimeEnv.migrationDirectory,
    table: valueFlag(parsed, "--table") ?? runtimeEnv.migrationHistoryTable,
  };
}

/**
 * Builds validated options for migration execution commands.
 */
export function buildMigrationRunOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  command: "up" | "down",
): MigrationRunOptions {
  const base = buildDatabaseRunOptions(parsed, extraPositional, command);

  return {
    ...base,
    dryRun: booleanFlag(parsed, "--dry-run"),
    target: valueFlag(parsed, "--target"),
  };
}
