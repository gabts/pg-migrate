import * as path from "node:path";
import type { Args, ResolvedInvocation, ValidatedInvocation } from "./model.js";

interface ResolvedValues extends Args {
  directory: string;
  table: string;
}

const ENV_KEY_DIRECTORY = "PGM_DIRECTORY";
const ENV_KEY_ENV_FILE = "PGM_ENV_FILE";
const ENV_KEY_TABLE = "PGM_TABLE";
const ENV_KEY_URL = "PGM_URL";

const DEFAULT_DIRECTORY = "migrations";
const DEFAULT_ENV_FILE = ".env";
const DEFAULT_TABLE = "schema_migrations";

function rejectEmptyValue(name: string, value: string | undefined): void {
  if (value === "") {
    throw new Error(`Invalid value '' for '${name}'.`);
  }
}

// Loads every variable of the file, as 'node --env-file' does, so that
// variables such as PGPASSWORD also reach the driver. Variables that are
// already set keep their values.
function loadEnvFile(values: Args): void {
  const explicitEnvFile = values["env-file"] ?? process.env[ENV_KEY_ENV_FILE];
  rejectEmptyValue("env-file", explicitEnvFile);
  const envFilePath = path.resolve(explicitEnvFile ?? DEFAULT_ENV_FILE);
  try {
    process.loadEnvFile(envFilePath);
  } catch (error) {
    // The default file is optional. Ignore any reason it cannot be read.
    if (explicitEnvFile === undefined) {
      return;
    }
    throw new Error(`Cannot read env file '${envFilePath}'.`, {
      cause: error,
    });
  }
}

function requireUrl(config: ResolvedValues): string {
  if (config.url === undefined) {
    throw new Error("Missing required argument 'url'.");
  }
  return config.url;
}

function resolveValues(values: Args): ResolvedValues {
  loadEnvFile(values);
  const env = process.env;

  const directory =
    values.directory ?? env[ENV_KEY_DIRECTORY] ?? DEFAULT_DIRECTORY;
  const table = values.table ?? env[ENV_KEY_TABLE] ?? DEFAULT_TABLE;
  const url = values.url ?? env[ENV_KEY_URL];

  rejectEmptyValue("directory", directory);

  return {
    ...values,
    directory,
    table,
    url,
  };
}

/** Resolves configuration into complete options. */
export function resolveInvocation(
  invocation: ValidatedInvocation,
): ResolvedInvocation {
  const config = resolveValues(invocation.values);

  if (invocation.command === "create") {
    return {
      command: invocation.command,
      options: { directory: config.directory, name: invocation.name },
    };
  }

  rejectEmptyValue("table", config.table);
  rejectEmptyValue("url", config.url);
  const url = requireUrl(config);

  switch (invocation.command) {
    case "status":
      return {
        command: invocation.command,
        failOnPending: invocation.values["fail-on-pending"] === true,
        options: {
          directory: config.directory,
          table: config.table,
          url,
        },
      };
    case "validate":
      return {
        command: invocation.command,
        options: {
          directory: config.directory,
          table: config.table,
          url,
        },
      };
    case "up":
    case "down":
      return {
        command: invocation.command,
        options: {
          directory: config.directory,
          table: config.table,
          target: config.target,
          url,
        },
      };
    case "repair":
      return {
        command: invocation.command,
        options: {
          directory: config.directory,
          table: config.table,
          target: invocation.target,
          url,
        },
      };
  }
}
