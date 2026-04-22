import * as fs from "fs";
import * as path from "path";
import { down as runDown, up as runUp } from "./main.js";
import { assertValidMigrationName } from "./migration-naming.js";

const helpText = `Usage: migratorosaurus <command> [options]

Commands:
  up                Apply pending migrations
  down              Roll back applied migrations
  create            Create a new migration file

Run "migratorosaurus <command> --help" for command-specific usage.
`;

const createHelpText = `Usage: migratorosaurus create --name <name> [options]

Options:
  -n, --name <name>         Migration name slug
  -d, --directory <dir>     Output directory, defaults to migrations
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
  -d, --directory <dir>     Migrations directory, defaults to migrations
  -t, --target <filename>   Apply pending migrations up to and including target
  --table <table-name>      Migration history table, defaults to migration_history
  --dry-run                 Run planned SQL and history writes, then roll back
  -h, --help                Show this help text

Behavior:
  - Without --target, applies all pending migrations.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.

Examples:
  migratorosaurus up postgres://localhost:5432/app
  migratorosaurus up --url postgres://localhost:5432/app --target 20260416090000_create.sql
  migratorosaurus up --dry-run
`;

const downHelpText = `Usage: migratorosaurus down [options] [<database-url>]

Options:
  --url <database-url>      Database URL (alternative to positional URL)
  -d, --directory <dir>     Migrations directory, defaults to migrations
  -t, --target <filename>   Roll back newer migrations; target remains applied
  --table <table-name>      Migration history table, defaults to migration_history
  --dry-run                 Run planned SQL and history writes, then roll back
  -h, --help                Show this help text

Behavior:
  - Without --target, rolls back exactly one migration (latest applied).
  - With --target, target migration is excluded from rollback and stays applied.
  - Provide exactly one of positional <database-url> or --url; otherwise DATABASE_URL is used.

Examples:
  migratorosaurus down postgres://localhost:5432/app
  migratorosaurus down --target 20260416090000_create.sql
  migratorosaurus down --dry-run
`;

interface CreateOptions {
  directory: string;
  name?: string;
}

interface MigrationRunOptions {
  clientConfig: string;
  directory: string;
  dryRun: boolean;
  table: string;
  target?: string;
}

function showHelp(text: string): never {
  process.stdout.write(text);
  process.exit(0);
}

function getFlagValue(
  label: string,
  flags: string,
  args: string[],
  index: number,
): string {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${label} flag (${flags}) requires a value`);
  }
  return value;
}

function parseCreateArgs(args: string[]): CreateOptions {
  const opts: CreateOptions = {
    directory: "migrations",
  };

  if (args.slice(3).includes("-h") || args.slice(3).includes("--help")) {
    showHelp(createHelpText);
  }

  let i = 3;

  while (i < args.length) {
    switch (args[i]) {
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
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  return opts;
}

function parseMigrationRunArgs(
  args: string[],
  command: "up" | "down",
): MigrationRunOptions {
  const opts: Omit<MigrationRunOptions, "clientConfig"> = {
    directory: "migrations",
    dryRun: false,
    table: "migration_history",
  };

  if (args.slice(3).includes("-h") || args.slice(3).includes("--help")) {
    showHelp(command === "up" ? upHelpText : downHelpText);
  }

  let clientConfig = process.env.DATABASE_URL;
  let explicitClientConfig = false;
  let i = 3;

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

function createMigration(args: string[]): void {
  const opts = parseCreateArgs(args);

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
  process.stdout.write(`${filePath}\n`);
}

export async function cli(args = process.argv): Promise<void> {
  const command = args[2];

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
      showHelp(helpText);
      break;
    case "create":
      createMigration(args);
      break;
    case "up": {
      const options = parseMigrationRunArgs(args, "up");
      return runUp(options.clientConfig, options);
    }
    case "down": {
      const options = parseMigrationRunArgs(args, "down");
      return runDown(options.clientConfig, options);
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
