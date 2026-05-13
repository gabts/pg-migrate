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

type RuntimeEnv = Awaited<ReturnType<typeof readRuntimeEnv>>;

function buildClientConfig(connectionString: string): ClientConfig {
  return {
    connectionString,
    connectionTimeoutMillis: defaultConnectionTimeoutMillis,
  };
}

async function readCliRuntimeEnv(parsed: ParsedTokens): Promise<RuntimeEnv> {
  return readRuntimeEnv(process.env, {
    envFilePath: valueFlag(parsed, "--env-file"),
  });
}

/**
 * Builds validated options for the create command from parsed CLI tokens.
 */
export async function buildCreateOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
): Promise<CreateMigrationOptions> {
  if (extraPositional.length > 0) {
    throw new Error(`Unexpected argument: ${extraPositional[0]}`);
  }

  const runtimeEnv = await readCliRuntimeEnv(parsed);

  return {
    directory:
      valueFlag(parsed, "--directory") ?? runtimeEnv.migrationsDirectory,
    name: valueFlag(parsed, "--name")?.replace(/\.sql$/, ""),
  };
}

/**
 * Builds validated options for commands that need a database connection.
 */
export async function buildDatabaseRunOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  command: "up" | "down" | "validate" | "status",
): Promise<DatabaseRunOptions> {
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

  const runtimeEnv = await readCliRuntimeEnv(parsed);

  const clientConfig = positionalUrl ?? flagUrl ?? runtimeEnv.databaseUrl;
  if (!clientConfig) {
    throw new Error(
      `Database URL is required for ${command}; pass it as an argument, --url, set PGM_DATABASE_URL, or add PGM_DATABASE_URL to .env`,
    );
  }

  return {
    clientConfig: buildClientConfig(clientConfig),
    directory:
      valueFlag(parsed, "--directory") ?? runtimeEnv.migrationsDirectory,
    table: valueFlag(parsed, "--table") ?? runtimeEnv.migrationsTable,
  };
}

/**
 * Builds validated options for migration execution commands.
 */
export async function buildMigrationRunOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  command: "up" | "down",
): Promise<MigrationRunOptions> {
  const base = await buildDatabaseRunOptions(parsed, extraPositional, command);

  return {
    ...base,
    dryRun: booleanFlag(parsed, "--dry-run"),
    target: valueFlag(parsed, "--target"),
  };
}
