import * as fs from "fs";
import * as path from "path";
import {
  assertValidTokens,
  booleanFlag,
  commandName,
  parseTokens,
  valueFlag,
  type CommandName,
  type ParsedTokens,
} from "./args.js";
import { createLogger, type Logger } from "./logger.js";
import { down, up, validate } from "./main.js";
import { assertValidMigrationName } from "./migration-naming.js";
import {
  createCliLogWriter,
  createCliResultWriter,
  type CliResultWriter,
} from "./cli-format.js";

const migrationDirectoryEnvVar = "MIGRATION_DIRECTORY";

const helpText = `Usage: migratorosaurus <command> [options]

Commands:
  up                Apply pending migrations
  down              Roll back applied migrations
  validate          Validate migration environment and state
  create            Create a new migration file

Global options:
  --json                    Emit structured command results to stdout
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs

Run "migratorosaurus <command> --help" for command-specific usage.
`;

const createHelpText = `Usage: migratorosaurus create --name <name> [options]

Options:
  -n, --name <name>         Migration name slug
  -d, --directory <dir>     Output directory, defaults to MIGRATION_DIRECTORY or migrations
  --json                    Emit structured command result
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Notes:
  - Creates <YYYYMMDDHHMMSS>_<name>.sql
  - File template includes:
      -- migrate:up
      -- migrate:down

Examples:
  migratorosaurus create --name create_users
  migratorosaurus create --directory sql/migrations --name add_user_index
`;

const upHelpText = `Usage: migratorosaurus up [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to MIGRATION_DIRECTORY or migrations
  -t, --target <filename>   Apply pending migrations up to and including target
  --table <table-name>      Migration history table, defaults to migration_history
  --dry-run                 Run planned SQL and history writes, then roll back
  --json                    Emit structured command result
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Behavior:
  - Without --target, applies all pending migrations.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  migratorosaurus up postgres://localhost:5432/app
  migratorosaurus up --url postgres://localhost:5432/app --target 20260416090000_create.sql
  migratorosaurus up --dry-run
`;

const downHelpText = `Usage: migratorosaurus down [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to MIGRATION_DIRECTORY or migrations
  -t, --target <filename>   Roll back newer migrations; target remains applied
  --table <table-name>      Migration history table, defaults to migration_history
  --dry-run                 Run planned SQL and history writes, then roll back
  --json                    Emit structured command result
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Behavior:
  - Without --target, rolls back exactly one migration (latest applied).
  - With --target, target migration is excluded from rollback and stays applied.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  migratorosaurus down postgres://localhost:5432/app
  migratorosaurus down --target 20260416090000_create.sql
  migratorosaurus down --dry-run
`;

const validateHelpText = `Usage: migratorosaurus validate [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to MIGRATION_DIRECTORY or migrations
  --table <table-name>      Migration history table, defaults to migration_history
  --json                    Emit structured command result
  --quiet                   Suppress non-error logs
  --verbose, -v             Show debug logs
  --no-color                Disable ANSI color in logs
  -h, --help                Show this help text

Behavior:
  - Validates migration files, order, and applied migration history consistency.
  - Checks database connectivity and migration history table state.
  - Does not create missing migration history tables.
  - Uses the same advisory lock as up/down; fails fast if another migratorosaurus process holds it.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.
  - --directory takes precedence over MIGRATION_DIRECTORY.

Examples:
  migratorosaurus validate postgres://localhost:5432/app
  migratorosaurus validate --url postgres://localhost:5432/app --table migration_history
`;

function getDefaultMigrationDirectory(): string {
  return process.env[migrationDirectoryEnvVar] || "migrations";
}

interface CreateOptions {
  directory: string;
  name?: string;
}

interface DatabaseRunOptions {
  clientConfig: string;
  directory: string;
  table: string;
}

interface MigrationRunOptions extends DatabaseRunOptions {
  dryRun: boolean;
  target?: string;
}

function buildCreateOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
): CreateOptions {
  if (extraPositional.length > 0) {
    throw new Error(`Unexpected argument: ${extraPositional[0]}`);
  }

  return {
    directory:
      valueFlag(parsed, "--directory") ?? getDefaultMigrationDirectory(),
    name: valueFlag(parsed, "--name")?.replace(/\.sql$/, ""),
  };
}

function buildDatabaseRunOptions(
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  command: "up" | "down" | "validate",
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

  const clientConfig = positionalUrl ?? flagUrl ?? process.env.DATABASE_URL;
  if (!clientConfig) {
    throw new Error(
      `Database URL is required for ${command}; pass it as an argument, --url, or set DATABASE_URL`,
    );
  }

  return {
    clientConfig,
    directory:
      valueFlag(parsed, "--directory") ?? getDefaultMigrationDirectory(),
    table: valueFlag(parsed, "--table") ?? "migration_history",
  };
}

function buildMigrationRunOptions(
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

function formatTimestamp(date = new Date()): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function createMigration(opts: CreateOptions): string {
  if (!opts.name) {
    throw new Error("Name flag (--name, -n) is required");
  }

  assertValidMigrationName(opts.name);

  if (
    !fs.existsSync(opts.directory) ||
    !fs.statSync(opts.directory).isDirectory()
  ) {
    throw new Error(`Migration directory does not exist: ${opts.directory}`);
  }

  const filePath = path.join(
    opts.directory,
    `${formatTimestamp()}_${opts.name}.sql`,
  );
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

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function errorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error: {
        message: error.message,
        name: error.name,
      },
    };
  }

  return {
    error: String(error),
  };
}

function helpTextFor(command: CommandName | undefined): string {
  switch (command) {
    case "create":
      return createHelpText;
    case "up":
      return upHelpText;
    case "down":
      return downHelpText;
    case "validate":
      return validateHelpText;
    case undefined:
      return helpText;
  }
}

function writeHelp(
  resultWriter: CliResultWriter,
  command: CommandName | undefined,
  json: boolean,
): void {
  const help = helpTextFor(command);

  if (json) {
    resultWriter.writeJson({
      command: command ?? null,
      help,
      ok: true,
    });
    return;
  }

  resultWriter.writeText(help);
}

async function runCommand(
  command: CommandName,
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  resultWriter: CliResultWriter,
  logger: Logger,
  runtime: {
    json: boolean;
    quiet: boolean;
    verbose: boolean;
  },
): Promise<number> {
  if (command === "create") {
    const options = buildCreateOptions(parsed, extraPositional);
    logger.debug(
      `command=create directory=${JSON.stringify(options.directory)} name=${JSON.stringify(options.name ?? "")}`,
    );
    const filePath = createMigration(options);

    if (runtime.json) {
      resultWriter.writeJson({
        command: "create",
        file: filePath,
      });
    } else {
      resultWriter.writeText(filePath);
    }
    return 0;
  }

  if (command === "validate") {
    const runOptions = buildDatabaseRunOptions(
      parsed,
      extraPositional,
      command,
    );
    await validate(runOptions.clientConfig, {
      directory: runOptions.directory,
      logger,
      quiet: runtime.quiet,
      table: runOptions.table,
      verbose: runtime.verbose,
    });
    if (runtime.json) {
      resultWriter.writeJson({
        command,
        ok: true,
      });
    }
    return 0;
  }

  const runOptions = buildMigrationRunOptions(parsed, extraPositional, command);
  const runFn = command === "up" ? up : down;
  await runFn(runOptions.clientConfig, {
    directory: runOptions.directory,
    dryRun: runOptions.dryRun,
    logger,
    quiet: runtime.quiet,
    table: runOptions.table,
    target: runOptions.target,
    verbose: runtime.verbose,
  });

  if (runtime.json) {
    resultWriter.writeJson({
      command,
      dryRun: runOptions.dryRun,
      ok: true,
      target: runOptions.target ?? null,
    });
  }
  return 0;
}

/**
 * Executes the CLI command and returns the process exit code.
 */
export async function cli(args = process.argv): Promise<number> {
  const tokens = args.slice(2);
  const parsed = parseTokens(tokens);

  const { globals } = parsed;

  const resultWriter = createCliResultWriter(process.stdout);
  const logWriter = createCliLogWriter(process.stderr, {
    color: globals.color,
  });

  const json = globals.json;
  let currentCommand: CommandName | null = null;
  let logger: Logger = createLogger({
    writer: logWriter,
  });

  try {
    logger = createLogger({
      quiet: globals.quiet,
      writer: logWriter,
      verbose: globals.verbose,
    });

    const command = commandName(parsed);
    if (
      parsed.validationIssues.length === 0 &&
      (parsed.command === undefined || command !== undefined)
    ) {
      currentCommand = command ?? null;
    }

    assertValidTokens(parsed);

    if (parsed.help) {
      writeHelp(resultWriter, command, globals.json);
      return 0;
    }

    if (command === undefined) {
      writeHelp(resultWriter, command, globals.json);
      return 0;
    }

    return await runCommand(
      command,
      parsed,
      parsed.extraPositional,
      resultWriter,
      logger,
      {
        json: globals.json,
        quiet: globals.quiet,
        verbose: globals.verbose,
      },
    );
  } catch (error) {
    logger.error(formatErrorMessage(error), errorLogFields(error));
    if (json) {
      resultWriter.writeJson({
        command: currentCommand,
        error: formatErrorMessage(error),
        ok: false,
      });
    }
    return 1;
  }
}
