import * as fs from "fs";
import * as path from "path";
import { createIo, type Io } from "./io.js";
import type { ColorMode } from "./logger.js";
import { down as runDown, up as runUp } from "./main.js";
import { assertValidMigrationName } from "./migration-naming.js";

const migrationDirectoryEnvVar = "MIGRATION_DIRECTORY";

const helpText = `Usage: migratorosaurus <command> [options]

Commands:
  up                Apply pending migrations
  down              Roll back applied migrations
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

interface CreateOptions {
  directory: string;
  name?: string;
}

interface GlobalOptions {
  color: ColorMode;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
}

interface MigrationRunOptions {
  clientConfig: string;
  directory: string;
  dryRun: boolean;
  table: string;
  target?: string;
}

function showHelp(io: Io, text: string): number {
  io.result(text);
  return 0;
}

function parseGlobalOptions(args: string[]): {
  argsWithoutGlobalFlags: string[];
  global: GlobalOptions;
} {
  const global: GlobalOptions = {
    color: "auto",
    json: false,
    quiet: false,
    verbose: false,
  };
  const argsWithoutGlobalFlags: string[] = [
    args[0] ?? "node",
    args[1] ?? "migratorosaurus",
  ];

  for (const arg of args.slice(2)) {
    switch (arg) {
      case "--json":
        global.json = true;
        break;
      case "--quiet":
        global.quiet = true;
        break;
      case "--verbose":
      case "-v":
        global.verbose = true;
        break;
      case "--no-color":
        global.color = false;
        break;
      default:
        argsWithoutGlobalFlags.push(arg);
        break;
    }
  }

  return {
    argsWithoutGlobalFlags,
    global,
  };
}

function getFlagValue(
  label: string,
  flags: string,
  args: readonly string[],
  index: number,
): string {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${label} flag (${flags}) requires a value`);
  }
  return value;
}

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes("-h") || args.includes("--help");
}

function getDefaultMigrationDirectory(): string {
  return process.env[migrationDirectoryEnvVar] || "migrations";
}

function parseCreateArgs(args: readonly string[]): CreateOptions {
  const opts: CreateOptions = {
    directory: getDefaultMigrationDirectory(),
  };

  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case "-d":
      case "--directory":
        opts.directory = getFlagValue("Directory", "--directory, -d", args, i);
        i += 2;
        break;
      case "-n":
      case "--name":
        opts.name = getFlagValue("Name", "--name, -n", args, i).replace(
          /\.sql$/,
          "",
        );
        i += 2;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function parseMigrationRunArgs(
  args: readonly string[],
  command: "up" | "down",
): MigrationRunOptions {
  const opts: Omit<MigrationRunOptions, "clientConfig"> = {
    directory: getDefaultMigrationDirectory(),
    dryRun: false,
    table: "migration_history",
  };

  let clientConfig = process.env.DATABASE_URL;
  let explicitClientConfig = false;
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      break;
    }

    if (!arg.startsWith("-")) {
      if (!explicitClientConfig) {
        clientConfig = arg;
        explicitClientConfig = true;
        i += 1;
        continue;
      }
      throw new Error(`Unexpected argument: ${arg}`);
    }

    switch (arg) {
      case "--url":
        if (explicitClientConfig) {
          throw new Error(
            "Database URL provided multiple times; use either <database-url> or --url",
          );
        }
        clientConfig = getFlagValue("Database URL", "--url", args, i);
        explicitClientConfig = true;
        i += 2;
        break;
      case "--dry-run":
        opts.dryRun = true;
        i += 1;
        break;
      case "-d":
      case "--directory":
        opts.directory = getFlagValue("Directory", "--directory, -d", args, i);
        i += 2;
        break;
      case "--table":
        opts.table = getFlagValue("Table", "--table", args, i);
        i += 2;
        break;
      case "-t":
      case "--target":
        opts.target = getFlagValue("Target", "--target, -t", args, i);
        i += 2;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!clientConfig) {
    throw new Error(
      `Database URL is required for ${command}; pass it as an argument, --url, or set DATABASE_URL`,
    );
  }

  return {
    clientConfig,
    ...opts,
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

async function executeCommand(
  args: readonly string[],
  io: Io,
  color: ColorMode,
): Promise<number> {
  const command = args[2];
  const commandArgs = args.slice(3);

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
      return showHelp(io, helpText);
    case "create": {
      if (hasHelpFlag(commandArgs)) {
        return showHelp(io, createHelpText);
      }

      const options = parseCreateArgs(commandArgs);
      io.debug(
        `command=create directory=${JSON.stringify(options.directory)} name=${JSON.stringify(options.name ?? "")}`,
      );
      const filePath = createMigration(options);

      if (io.json) {
        io.result({
          command: "create",
          file: filePath,
        });
      } else {
        io.result(filePath);
      }
      return 0;
    }
    case "up": {
      if (hasHelpFlag(commandArgs)) {
        return showHelp(io, upHelpText);
      }

      const options = parseMigrationRunArgs(commandArgs, "up");
      await runUp(options.clientConfig, {
        color,
        directory: options.directory,
        dryRun: options.dryRun,
        quiet: io.quiet,
        table: options.table,
        target: options.target,
        verbose: io.verbose,
      });

      if (io.json) {
        io.result({
          command: "up",
          dryRun: options.dryRun,
          ok: true,
          target: options.target ?? null,
        });
      }
      return 0;
    }
    case "down": {
      if (hasHelpFlag(commandArgs)) {
        return showHelp(io, downHelpText);
      }

      const options = parseMigrationRunArgs(commandArgs, "down");
      await runDown(options.clientConfig, {
        color,
        directory: options.directory,
        dryRun: options.dryRun,
        quiet: io.quiet,
        table: options.table,
        target: options.target,
        verbose: io.verbose,
      });

      if (io.json) {
        io.result({
          command: "down",
          dryRun: options.dryRun,
          ok: true,
          target: options.target ?? null,
        });
      }
      return 0;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

export async function cli(args = process.argv): Promise<number> {
  const { argsWithoutGlobalFlags, global } = parseGlobalOptions(args);
  const io = createIo(global);

  try {
    return await executeCommand(argsWithoutGlobalFlags, io, global.color);
  } catch (error) {
    io.error(formatErrorMessage(error));
    return 1;
  }
}
