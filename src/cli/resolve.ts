import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as util from "node:util";
import type { Args, ResolvedInvocation, ValidatedInvocation } from "./model.js";

interface ResolvedValues extends Args {
  directory: string;
  table: string;
}

const ENV_KEY_CONFIG_FILE = "PGM_CONFIG";
const ENV_KEY_DIRECTORY = "PGM_DIRECTORY";
const ENV_KEY_TABLE = "PGM_TABLE";
const ENV_KEY_URL = "PGM_URL";

const DEFAULT_CONFIG_FILE = ".env";
const DEFAULT_DIRECTORY = "migrations";
const DEFAULT_TABLE = "schema_migrations";

function rejectEmptyValue(name: string, value: string | undefined): void {
  if (value === "") {
    throw new Error(`Invalid value '' for '${name}'.`);
  }
}

async function readConfigFile(
  filePath: string,
  required: boolean,
): Promise<string | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    // The default file is optional. Ignore any reason it cannot be read.
    if (!required) {
      return undefined;
    }
    throw new Error(`Cannot read config file '${filePath}'.`, {
      cause: error,
    });
  }
  // TextDecoder removes a byte order mark, which readFile would keep in the
  // first variable name.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Config file '${filePath}' is not valid UTF-8.`);
  }
}

function requireUrl(config: ResolvedValues): string {
  if (config.url === undefined) {
    throw new Error("Missing required argument 'url'.");
  }
  return config.url;
}

async function resolveValues(
  values: Args,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedValues> {
  const explicitConfig = values.config ?? env[ENV_KEY_CONFIG_FILE];
  rejectEmptyValue("config", explicitConfig);
  const envFilePath = path.resolve(explicitConfig ?? DEFAULT_CONFIG_FILE);
  const envFileContent = await readConfigFile(
    envFilePath,
    explicitConfig !== undefined,
  );
  const envFile = envFileContent ? util.parseEnv(envFileContent) : {};

  const directory =
    values.directory ??
    env[ENV_KEY_DIRECTORY] ??
    envFile[ENV_KEY_DIRECTORY] ??
    DEFAULT_DIRECTORY;
  const table =
    values.table ??
    env[ENV_KEY_TABLE] ??
    envFile[ENV_KEY_TABLE] ??
    DEFAULT_TABLE;
  const url = values.url ?? env[ENV_KEY_URL] ?? envFile[ENV_KEY_URL];

  rejectEmptyValue("directory", directory);

  return {
    ...values,
    directory,
    table,
    url,
  };
}

/** Resolves configuration into complete options. */
export async function resolveInvocation(
  invocation: ValidatedInvocation,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedInvocation> {
  const config = await resolveValues(invocation.values, env);

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
